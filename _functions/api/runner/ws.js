/**
 * Cloudflare Pages Function – Local Runner WebSocket endpoint
 *
 * GET /api/runner/ws?token=sbr_...
 *
 * The local runner script connects here instead of polling /api/runner/poll.
 * Jobs are pushed over the WebSocket as soon as they appear in D1 (~200 ms).
 * The runner sends results back over the same connection.
 *
 * Message protocol (JSON):
 *   Server → Runner:
 *     { type: "connected", runnerId: <tokenId>, instanceId: <id>, instanceName: <displayName> }
 *     { type: "job", job: { id, command, working_dir, label } }
 *     { type: "ack", jobId: <number> }        — result confirmed stored
 *     { type: "heartbeat" }
 *   Runner → Server:
 *     { type: "hello", instance: { instanceKey, displayName, hostname, ... } }
 *     { type: "pong" }
 *     { type: "event", eventType, message, level?, details?, jobId? }
 *     { type: "result", jobId, status, output, exitCode, truncated? }
 *
 * Auth: pass the runner token via ?token=sbr_... query parameter
 * (standard WebSocket clients cannot set custom HTTP headers).
 */

const MAX_OUTPUT_BYTES = 65_536;
const MAX_EVENT_MESSAGE_CHARS = 2_000;
const JOB_POLL_INTERVAL_MS = 200;
const HEARTBEAT_INTERVAL_MS = 30_000;
const RUNNER_ONLINE_WINDOW_SECONDS = 90;

// ---------------------------------------------------------------------------
// Helpers (inlined — can't import from $lib in Pages Functions)
// ---------------------------------------------------------------------------

async function sha256hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Validate a runner token against D1 and update last_seen heartbeat.
 * @param {D1Database} db
 * @param {string} rawToken
 * @param {string|null} clientIp
 */
async function validateToken(db, rawToken, clientIp) {
  if (!rawToken?.startsWith("sbr_")) {
    return { valid: false, error: "Invalid token format" };
  }

  const tokenHash = await sha256hex(rawToken);
  const tokenPrefix = rawToken.slice(0, 12); // "sbr_" + 8 hex chars

  let row;
  try {
    row = await db
      .prepare("SELECT id, user_id, revoked FROM local_runner_tokens WHERE token_prefix = ? AND token_hash = ?")
      .bind(tokenPrefix, tokenHash)
      .first();
  } catch (e) {
    return { valid: false, error: "Database error" };
  }

  if (!row) return { valid: false, error: "Token not found" };
  if (row.revoked) return { valid: false, error: "Token revoked" };

  // Fire-and-forget heartbeat
  db.prepare(
    "UPDATE local_runner_tokens SET last_seen_at = datetime('now'), last_seen_ip = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(clientIp ?? null, row.id).run().catch(() => {});

  return { valid: true, tokenId: row.id, userId: row.user_id };
}

async function registerRunnerInstance(db, auth, instance, clientIp) {
  if (!instance?.instanceKey || !instance?.displayName) {
    throw new Error("Missing runner instance identity");
  }

  const metadataJson = instance.metadata ? JSON.stringify(instance.metadata) : null;

  const existing = await db
    .prepare(
      `SELECT id
       FROM local_runner_instances
       WHERE runner_token_id = ? AND instance_key = ?`
    )
    .bind(auth.tokenId, instance.instanceKey)
    .first();

  if (existing?.id) {
    await db
      .prepare(
        `UPDATE local_runner_instances
         SET display_name = ?, hostname = ?, platform = ?, platform_release = ?, arch = ?,
             runner_version = ?, default_workdir = ?, metadata = ?,
             last_seen_at = datetime('now'), last_seen_ip = ?, updated_at = datetime('now')
         WHERE id = ?`
      )
      .bind(
        instance.displayName,
        instance.hostname ?? null,
        instance.platform ?? null,
        instance.platformRelease ?? null,
        instance.arch ?? null,
        instance.runnerVersion ?? null,
        instance.defaultWorkdir ?? null,
        metadataJson,
        clientIp ?? null,
        existing.id,
      )
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO local_runner_instances (
           runner_token_id, user_id, instance_key, display_name, hostname,
           platform, platform_release, arch, runner_version, default_workdir,
           metadata, last_seen_at, last_seen_ip
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`
      )
      .bind(
        auth.tokenId,
        auth.userId,
        instance.instanceKey,
        instance.displayName,
        instance.hostname ?? null,
        instance.platform ?? null,
        instance.platformRelease ?? null,
        instance.arch ?? null,
        instance.runnerVersion ?? null,
        instance.defaultWorkdir ?? null,
        metadataJson,
        clientIp ?? null,
      )
      .run();
  }

  return db
    .prepare(
      `SELECT i.*, t.name AS token_name,
              CASE
                WHEN i.last_seen_at IS NOT NULL
                 AND i.last_seen_at >= datetime('now', ?)
                 AND t.revoked = 0
                THEN 1 ELSE 0
              END AS is_online
       FROM local_runner_instances i
       JOIN local_runner_tokens t ON t.id = i.runner_token_id
       WHERE i.runner_token_id = ? AND i.instance_key = ?`
    )
    .bind(`-${RUNNER_ONLINE_WINDOW_SECONDS} seconds`, auth.tokenId, instance.instanceKey)
    .first();
}

async function touchRunnerInstance(db, instanceId, clientIp) {
  if (!instanceId) return;
  await db
    .prepare(
      `UPDATE local_runner_instances
       SET last_seen_at = datetime('now'), last_seen_ip = ?, updated_at = datetime('now')
       WHERE id = ?`
    )
    .bind(clientIp ?? null, instanceId)
    .run();
}

async function disconnectRunnerInstance(db, instanceId) {
  if (!instanceId) return;
  await db
    .prepare(
      `UPDATE local_runner_instances
       SET last_disconnect_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`
    )
    .bind(instanceId)
    .run();
}

async function recordRunnerEvent(db, auth, state, event) {
  if (!event?.eventType || !event?.message) return;

  let message = String(event.message);
  if (message.length > MAX_EVENT_MESSAGE_CHARS) {
    message = `${message.slice(0, MAX_EVENT_MESSAGE_CHARS)}…`;
  }

  await db
    .prepare(
      `INSERT INTO local_runner_events (
         user_id, runner_token_id, runner_instance_id, job_id,
         event_type, level, message, details
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      auth.userId,
      auth.tokenId,
      state.instanceId ?? null,
      event.jobId ?? null,
      event.eventType,
      event.level === "error" ? "error" : event.level === "warn" ? "warn" : "info",
      message,
      event.details ? JSON.stringify(event.details) : null,
    )
    .run();
}

/**
 * Atomically claim pending jobs for a runner token (marks them 'running').
 * @param {D1Database} db
 * @param {number} tokenId
 * @returns {Promise<Array>}
 */
async function claimPendingJobs(db, tokenId, instanceId) {
  const result = await db
    .prepare(
      `SELECT id, command, working_dir, label, target_instance_id
       FROM local_runner_jobs
       WHERE runner_token_id = ?
         AND status = 'pending'
         AND (target_instance_id IS NULL OR target_instance_id = ?)
       ORDER BY id ASC
       LIMIT 10`
    )
    .bind(tokenId, instanceId)
    .all();

  const jobs = result.results ?? [];
  if (jobs.length === 0) return [];

  const claimed = [];
  for (const job of jobs) {
    try {
      const update = await db
        .prepare(
          `UPDATE local_runner_jobs
           SET status = 'running', claimed_by_instance_id = ?, updated_at = datetime('now')
           WHERE id = ?
             AND status = 'pending'
             AND (target_instance_id IS NULL OR target_instance_id = ?)`
        )
        .bind(instanceId, job.id, instanceId)
        .run();

      const changed = update?.meta?.changes ?? update?.changes ?? 0;
      if (changed) {
        claimed.push(job);
      }
    } catch {
      // Skip this claim and keep polling.
    }
  }

  return claimed;
}

/**
 * Persist a job result reported by the runner.
 * @param {D1Database} db
 * @param {number} tokenId
 * @param {number} jobId
 * @param {{ status: string, output: string, exitCode: number|null }} result
 */
async function storeResult(db, tokenId, instanceId, jobId, { status, output, exitCode }) {
  let out = typeof output === "string" ? output : "";
  if (out.length > MAX_OUTPUT_BYTES) {
    out = out.slice(0, MAX_OUTPUT_BYTES) + "\n--- output truncated ---";
  }

  return db
    .prepare(
      `UPDATE local_runner_jobs
       SET status = ?, output = ?, exit_code = ?,
           completed_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?
         AND runner_token_id = ?
         AND status = 'running'
         AND (claimed_by_instance_id IS NULL OR claimed_by_instance_id = ?)`
    )
    .bind(status, out, exitCode ?? null, jobId, tokenId, instanceId)
    .run();
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

export async function onRequestGet(context) {
  const { request, env } = context;

  // Only handle WebSocket upgrades
  const upgradeHeader = request.headers.get("Upgrade");
  if (upgradeHeader !== "websocket") {
    return new Response("Expected WebSocket upgrade (Upgrade: websocket)", { status: 426 });
  }

  const db = env.DB;
  if (!db) {
    return new Response("Database unavailable", { status: 503 });
  }

  // Auth via query param (standard WebSocket API can't set headers)
  const url = new URL(request.url);
  const rawToken = url.searchParams.get("token") ?? "";
  if (!rawToken) {
    return new Response("Missing ?token=sbr_... query parameter", { status: 401 });
  }

  const clientIp =
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
    null;

  const auth = await validateToken(db, rawToken, clientIp);
  if (!auth.valid) {
    return new Response(auth.error ?? "Unauthorized", { status: 401 });
  }

  // Upgrade to WebSocket
  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();

  let closed = false;
  const state = {
    instanceId: null,
    instanceName: null,
    instanceKey: null,
  };

  server.addEventListener("close", () => {
    closed = true;
    if (state.instanceId) {
      context.waitUntil(
        Promise.allSettled([
          disconnectRunnerInstance(db, state.instanceId),
          recordRunnerEvent(db, auth, state, {
            eventType: "runner.disconnected",
            message: `${state.instanceName ?? "Runner"} disconnected`,
            details: { instanceKey: state.instanceKey ?? null },
          }),
        ])
      );
    }
  });
  server.addEventListener("error", () => {
    closed = true;
    if (state.instanceId) {
      context.waitUntil(disconnectRunnerInstance(db, state.instanceId));
    }
  });

  // Handle messages from the runner
  server.addEventListener("message", async (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return; // ignore malformed
    }

    if (msg.type === "hello") {
      try {
        const instance = await registerRunnerInstance(db, auth, msg.instance ?? {}, clientIp);
        state.instanceId = instance?.id ?? null;
        state.instanceName = instance?.display_name ?? msg.instance?.displayName ?? null;
        state.instanceKey = msg.instance?.instanceKey ?? null;

        await recordRunnerEvent(db, auth, state, {
          eventType: "runner.connected",
          message: `${state.instanceName ?? "Runner"} connected`,
          details: {
            instanceKey: state.instanceKey,
            hostname: msg.instance?.hostname ?? null,
            platform: msg.instance?.platform ?? null,
            arch: msg.instance?.arch ?? null,
          },
        });

        server.send(JSON.stringify({
          type: "connected",
          runnerId: auth.tokenId,
          instanceId: state.instanceId,
          instanceName: state.instanceName,
        }));
      } catch (e) {
        console.error("[Runner WS] Failed to register runner instance", e);
        try {
          server.close(1011, "Runner registration failed");
        } catch {
          closed = true;
        }
      }
      return;
    }

    if (msg.type === "pong") {
      if (state.instanceId) {
        touchRunnerInstance(db, state.instanceId, clientIp).catch(() => {});
      }
      return;
    }

    if (msg.type === "event") {
      if (!state.instanceId) return;
      try {
        await recordRunnerEvent(db, auth, state, {
          eventType: msg.eventType,
          level: msg.level,
          message: msg.message,
          details: msg.details,
          jobId: typeof msg.jobId === "number" ? msg.jobId : null,
        });
      } catch (e) {
        console.error("[Runner WS] Failed to store runner event", e);
      }
      return;
    }

    if (msg.type === "result") {
      if (!state.instanceId) return;
      const { jobId, status, output, exitCode } = msg;
      if (typeof jobId !== "number" || (status !== "completed" && status !== "failed")) {
        return; // ignore invalid
      }
      try {
        const update = await storeResult(db, auth.tokenId, state.instanceId, jobId, { status, output, exitCode });
        const changed = update?.meta?.changes ?? update?.changes ?? 0;
        if (!changed) return;

        await recordRunnerEvent(db, auth, state, {
          eventType: status === "completed" ? "job.completed" : "job.failed",
          level: status === "completed" ? "info" : "error",
          jobId,
          message: `Job #${jobId} ${status === "completed" ? "completed" : "failed"} on ${state.instanceName ?? "runner"}`,
          details: {
            exitCode: exitCode ?? null,
            truncated: Boolean(msg.truncated),
            outputBytes: typeof output === "string" ? output.length : 0,
          },
        });

        server.send(JSON.stringify({ type: "ack", jobId }));
      } catch (e) {
        console.error("[Runner WS] Failed to store result for job", jobId, e);
      }
    }
  });

  // Heartbeat interval
  const heartbeatTimer = setInterval(() => {
    if (closed) {
      clearInterval(heartbeatTimer);
      return;
    }
    try {
      server.send(JSON.stringify({ type: "heartbeat" }));
    } catch {
      closed = true;
      clearInterval(heartbeatTimer);
    }
  }, HEARTBEAT_INTERVAL_MS);

  // Job push loop — polls D1 at 200 ms, pushes new jobs immediately
  async function jobPushLoop() {
    while (!closed) {
      try {
        if (!state.instanceId) {
          await new Promise((resolve) => setTimeout(resolve, JOB_POLL_INTERVAL_MS));
          continue;
        }

        const jobs = await claimPendingJobs(db, auth.tokenId, state.instanceId);
        for (const job of jobs) {
          if (closed) break;
          server.send(JSON.stringify({ type: "job", job }));
        }
      } catch {
        // D1 hiccup — keep looping
      }
      // Wait between polls
      await new Promise((resolve) => setTimeout(resolve, JOB_POLL_INTERVAL_MS));
    }
    clearInterval(heartbeatTimer);
  }

  // Keep the Worker alive for the duration of the WebSocket connection
  context.waitUntil(jobPushLoop());

  return new Response(null, { status: 101, webSocket: client });
}
