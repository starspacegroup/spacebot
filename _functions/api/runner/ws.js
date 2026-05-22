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
const JOB_POLL_MIN_INTERVAL_MS = 500;
const JOB_POLL_MAX_INTERVAL_MS = 4_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const RUNNER_ONLINE_WINDOW_SECONDS = 90;
const DEFAULT_MAX_ATTEMPTS = 5;
const MIN_MAX_ATTEMPTS = 1;
const MAX_MAX_ATTEMPTS = 20;
const RETRY_BACKOFF_SECONDS = 5;
const TOKEN_HEARTBEAT_WRITE_WINDOW_SECONDS = 15;
const INSTANCE_HEARTBEAT_WRITE_WINDOW_SECONDS = 15;
const TIMEOUT_SWEEP_INTERVAL_MS = 15_000;
const lastTimeoutSweepByToken = new Map();

// ---------------------------------------------------------------------------
// Helpers (inlined — can't import from $lib in Pages Functions)
// ---------------------------------------------------------------------------

async function sha256hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

function parseJson(value) {
  if (!value) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function clampInteger(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const rounded = Math.trunc(numeric);
  return Math.max(min, Math.min(max, rounded));
}

function normalizeBoolean(value) {
  if (value === true || value === 1 || value === "1") return true;
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === "true" || trimmed === "yes" || trimmed === "on") return true;
    if (trimmed === "false" || trimmed === "no" || trimmed === "off") return false;
  }
  return Boolean(value);
}

function jobMeetsCapabilityRequirements(job, runnerMetadata) {
  const requirements = parseJson(job?.capability_requirements_json);
  if (!requirements || typeof requirements !== "object") return true;

  const capabilities = runnerMetadata?.capabilities;
  if (!capabilities || typeof capabilities !== "object") return false;

  for (const [key, requiredValue] of Object.entries(requirements)) {
    if (normalizeBoolean(capabilities[key]) !== normalizeBoolean(requiredValue)) {
      return false;
    }
  }

  return true;
}

function shouldSweepTimeouts(tokenId) {
  const now = Date.now();
  const lastSweep = lastTimeoutSweepByToken.get(tokenId) ?? 0;
  if (now - lastSweep < TIMEOUT_SWEEP_INTERVAL_MS) {
    return false;
  }
  lastTimeoutSweepByToken.set(tokenId, now);
  return true;
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
    "UPDATE local_runner_tokens SET last_seen_at = datetime('now'), last_seen_ip = ?, updated_at = datetime('now') WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < datetime('now', ?))"
  ).bind(clientIp ?? null, row.id, `-${TOKEN_HEARTBEAT_WRITE_WINDOW_SECONDS} seconds`).run().catch(() => {});

  return { valid: true, tokenId: row.id, userId: row.user_id };
}

async function touchRunnerToken(db, tokenId, clientIp) {
  if (!tokenId) return;
  await db.prepare(
    "UPDATE local_runner_tokens SET last_seen_at = datetime('now'), last_seen_ip = ?, updated_at = datetime('now') WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < datetime('now', ?))"
  ).bind(clientIp ?? null, tokenId, `-${TOKEN_HEARTBEAT_WRITE_WINDOW_SECONDS} seconds`).run();
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
         WHERE id = ?
           AND (last_seen_at IS NULL OR last_seen_at < datetime('now', ?))`
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
        `-${INSTANCE_HEARTBEAT_WRITE_WINDOW_SECONDS} seconds`,
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
async function requeueTimedOutRunnerJobs(db, tokenId) {
  if (!shouldSweepTimeouts(tokenId)) return;

  await db
    .prepare(
      `UPDATE local_runner_jobs
       SET status = 'pending',
           claimed_by_instance_id = NULL,
           started_at = NULL,
           next_retry_at = datetime('now', ?),
           updated_at = datetime('now'),
           terminal_error = 'Execution timed out before completion'
       WHERE runner_token_id = ?
         AND status = 'running'
         AND started_at IS NOT NULL
         AND datetime(started_at, '+' || timeout_seconds || ' seconds') <= datetime('now')
         AND attempt_count < max_attempts`
    )
    .bind(`+${RETRY_BACKOFF_SECONDS} seconds`, tokenId)
    .run();

  await db
    .prepare(
      `UPDATE local_runner_jobs
       SET status = 'failed',
           completed_at = datetime('now'),
           started_at = NULL,
           updated_at = datetime('now'),
           terminal_error = 'Execution timed out and retry budget exhausted'
       WHERE runner_token_id = ?
         AND status = 'running'
         AND started_at IS NOT NULL
         AND datetime(started_at, '+' || timeout_seconds || ' seconds') <= datetime('now')
         AND attempt_count >= max_attempts`
    )
    .bind(tokenId)
    .run();
}

async function claimPendingJobs(db, tokenId, instanceId) {
  await requeueTimedOutRunnerJobs(db, tokenId);

  let runnerMetadata = null;
  if (instanceId) {
    const instance = await db
      .prepare("SELECT metadata FROM local_runner_instances WHERE id = ? AND runner_token_id = ?")
      .bind(instanceId, tokenId)
      .first();
    runnerMetadata = parseJson(instance?.metadata);
  }

  const result = await db
    .prepare(
      `SELECT id, command, working_dir, label, target_instance_id, job_type, payload_json,
              capability_requirements_json, priority, max_attempts, attempt_count,
              timeout_seconds, next_retry_at
       FROM local_runner_jobs
       WHERE runner_token_id = ?
         AND status = 'pending'
         AND (next_retry_at IS NULL OR next_retry_at <= datetime('now'))
         AND (target_instance_id IS NULL OR target_instance_id = ?)
       ORDER BY priority DESC, created_at ASC
       LIMIT 25`
    )
    .bind(tokenId, instanceId)
    .all();

  const jobs = result.results ?? [];
  if (jobs.length === 0) return [];

  const claimed = [];
  for (const job of jobs) {
    if (!jobMeetsCapabilityRequirements(job, runnerMetadata)) {
      continue;
    }

    try {
      const update = await db
        .prepare(
          `UPDATE local_runner_jobs
           SET status = 'running',
               claimed_by_instance_id = ?,
               started_at = datetime('now'),
               attempt_count = attempt_count + 1,
               next_retry_at = NULL,
               updated_at = datetime('now')
           WHERE id = ?
             AND status = 'pending'
             AND attempt_count < max_attempts
             AND (next_retry_at IS NULL OR next_retry_at <= datetime('now'))
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
async function storeResult(db, tokenId, instanceId, jobId, {
  status,
  output,
  exitCode,
  resultJson,
  artifactRefs,
}) {
  let out = typeof output === "string" ? output : "";
  if (out.length > MAX_OUTPUT_BYTES) {
    out = out.slice(0, MAX_OUTPUT_BYTES) + "\n--- output truncated ---";
  }

  let resultJsonStr = null;
  if (resultJson !== undefined && resultJson !== null) {
    try {
      resultJsonStr = JSON.stringify(resultJson);
    } catch {
      resultJsonStr = null;
    }
  }

  let artifactRefsJsonStr = null;
  if (artifactRefs !== undefined && artifactRefs !== null) {
    try {
      artifactRefsJsonStr = JSON.stringify(artifactRefs);
    } catch {
      artifactRefsJsonStr = null;
    }
  }

  if (status === "failed") {
    const job = await db
      .prepare(
        `SELECT attempt_count, max_attempts
         FROM local_runner_jobs
         WHERE id = ?
           AND runner_token_id = ?
           AND status = 'running'
           AND (claimed_by_instance_id IS NULL OR claimed_by_instance_id = ?)`
      )
      .bind(jobId, tokenId, instanceId)
      .first();

    if (job) {
      const attemptCount = clampInteger(job.attempt_count, 0, 0, Number.MAX_SAFE_INTEGER);
      const maxAttempts = clampInteger(
        job.max_attempts,
        DEFAULT_MAX_ATTEMPTS,
        MIN_MAX_ATTEMPTS,
        MAX_MAX_ATTEMPTS
      );

      if (attemptCount < maxAttempts) {
        return db
          .prepare(
            `UPDATE local_runner_jobs
             SET status = 'pending',
                 output = ?,
                 exit_code = ?,
                 result_json = ?,
                 artifact_refs_json = ?,
                 claimed_by_instance_id = NULL,
                 started_at = NULL,
                 next_retry_at = datetime('now', ?),
                 terminal_error = NULL,
                 completed_at = NULL,
                 updated_at = datetime('now')
             WHERE id = ?
               AND runner_token_id = ?
               AND status = 'running'
               AND (claimed_by_instance_id IS NULL OR claimed_by_instance_id = ?)`
          )
          .bind(
            out,
            exitCode ?? null,
            resultJsonStr,
            artifactRefsJsonStr,
            `+${RETRY_BACKOFF_SECONDS} seconds`,
            jobId,
            tokenId,
            instanceId
          )
          .run();
      }
    }
  }

  return db
    .prepare(
      `UPDATE local_runner_jobs
       SET status = ?, output = ?, exit_code = ?, result_json = ?, artifact_refs_json = ?,
           started_at = NULL,
           next_retry_at = NULL,
           terminal_error = CASE WHEN ? = 'failed' THEN 'Retry budget exhausted' ELSE NULL END,
           completed_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?
         AND runner_token_id = ?
         AND status = 'running'
         AND (claimed_by_instance_id IS NULL OR claimed_by_instance_id = ?)`
    )
    .bind(status, out, exitCode ?? null, resultJsonStr, artifactRefsJsonStr, status, jobId, tokenId, instanceId)
    .run();
}

async function persistArtifacts(db, auth, state, jobId, artifactRefs) {
  if (!Array.isArray(artifactRefs) || artifactRefs.length === 0) return [];

  const saved = [];

  for (let i = 0; i < artifactRefs.length; i++) {
    const ref = artifactRefs[i] ?? {};
    const artifactType = typeof ref.artifactType === "string" ? ref.artifactType : "unknown";
    const mimeType = typeof ref.mimeType === "string" ? ref.mimeType : null;
    const storageMode = typeof ref.storageMode === "string" ? ref.storageMode : "inline_base64";
    const blobBase64 = typeof ref.blobBase64 === "string" ? ref.blobBase64 : null;
    const byteSize = typeof ref.byteSize === "number"
      ? ref.byteSize
      : (blobBase64 ? Math.floor((blobBase64.length * 3) / 4) : null);

    let metadataJson = null;
    if (ref && typeof ref === "object") {
      const metadata = {
        ...ref,
      };
      delete metadata.blobBase64;
      try {
        metadataJson = JSON.stringify(metadata);
      } catch {
        metadataJson = null;
      }
    }

    const inserted = await db
      .prepare(
        `INSERT INTO local_runner_artifacts (
           user_id, runner_token_id, runner_instance_id, job_id,
           artifact_type, mime_type, byte_size, width, height,
           capture_source, capture_index, storage_mode,
           blob_base64, external_url, metadata_json
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id`
      )
      .bind(
        auth.userId,
        auth.tokenId,
        state.instanceId ?? null,
        jobId,
        artifactType,
        mimeType,
        byteSize,
        typeof ref.width === "number" ? ref.width : null,
        typeof ref.height === "number" ? ref.height : null,
        typeof ref.captureSource === "string" ? ref.captureSource : null,
        typeof ref.captureIndex === "number" ? ref.captureIndex : i,
        storageMode,
        blobBase64,
        typeof ref.externalUrl === "string" ? ref.externalUrl : null,
        metadataJson,
      )
      .first();

    saved.push({
      id: inserted?.id ?? null,
      artifactType,
      mimeType,
      byteSize,
      captureIndex: typeof ref.captureIndex === "number" ? ref.captureIndex : i,
      storageMode,
      externalUrl: typeof ref.externalUrl === "string" ? ref.externalUrl : null,
    });
  }

  return saved;
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

export async function onRequestGet(context) {
  const { request, env } = context;

  // Only handle WebSocket upgrades
  const upgradeHeader = (request.headers.get("Upgrade") ?? request.headers.get("upgrade") ?? "").toLowerCase();
  if (!upgradeHeader.includes("websocket")) {
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
        touchRunnerToken(db, auth.tokenId, clientIp).catch(() => {});

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
      touchRunnerToken(db, auth.tokenId, clientIp).catch(() => {});
      if (state.instanceId) {
        if (msg.instance?.instanceKey && msg.instance?.displayName) {
          registerRunnerInstance(db, auth, msg.instance, clientIp)
            .then((instance) => {
              if (!instance) return;
              state.instanceId = instance.id ?? state.instanceId;
              state.instanceName = instance.display_name ?? state.instanceName;
              state.instanceKey = instance.instance_key ?? state.instanceKey;
            })
            .catch(() => {});
        }
        touchRunnerInstance(db, state.instanceId, clientIp).catch(() => {});
      }
      return;
    }

    if (msg.type === "disconnect") {
      closed = true;
      try {
        if (msg.instance?.instanceKey && msg.instance?.displayName) {
          const refreshed = await registerRunnerInstance(db, auth, msg.instance, clientIp);
          if (refreshed?.id) {
            state.instanceId = refreshed.id;
            state.instanceName = refreshed.display_name ?? state.instanceName;
            state.instanceKey = refreshed.instance_key ?? state.instanceKey;
          }
        }
      } catch {
        // Ignore best-effort metadata refresh failures on disconnect.
      }

      if (state.instanceId) {
        context.waitUntil(
          Promise.allSettled([
            disconnectRunnerInstance(db, state.instanceId),
            recordRunnerEvent(db, auth, state, {
              eventType: "runner.disconnected",
              message: `${state.instanceName ?? "Runner"} disconnected`,
              details: {
                instanceKey: state.instanceKey ?? null,
                reason: typeof msg.reason === "string" ? msg.reason : null,
                graceful: true,
              },
            }),
          ])
        );
      }

      try {
        server.close(1000, "Runner disconnected");
      } catch {
        closed = true;
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
      const { jobId, status, output, exitCode, result, artifactRefs } = msg;
      if (typeof jobId !== "number" || (status !== "completed" && status !== "failed")) {
        return; // ignore invalid
      }
      try {
        const persistedArtifactRefs = await persistArtifacts(db, auth, state, jobId, artifactRefs);

        const update = await storeResult(db, auth.tokenId, state.instanceId, jobId, {
          status,
          output,
          exitCode,
          resultJson: result ?? null,
          artifactRefs: persistedArtifactRefs,
        });
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
            hasStructuredResult: Boolean(result),
            artifactCount: persistedArtifactRefs.length,
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
      let idlePollDelay = JOB_POLL_MIN_INTERVAL_MS;

    while (!closed) {
      try {
        if (!state.instanceId) {
            await new Promise((resolve) => setTimeout(resolve, JOB_POLL_MIN_INTERVAL_MS));
          continue;
        }

        const jobs = await claimPendingJobs(db, auth.tokenId, state.instanceId);
        for (const job of jobs) {
          if (closed) break;
          server.send(JSON.stringify({ type: "job", job }));
        }

          if (jobs.length > 0) {
            idlePollDelay = JOB_POLL_MIN_INTERVAL_MS;
          } else {
            idlePollDelay = Math.min(Math.round(idlePollDelay * 1.5), JOB_POLL_MAX_INTERVAL_MS);
          }
      } catch {
        // D1 hiccup — keep looping
          idlePollDelay = Math.min(Math.round(idlePollDelay * 1.5), JOB_POLL_MAX_INTERVAL_MS);
      }
      // Wait between polls
        await new Promise((resolve) => setTimeout(resolve, idlePollDelay));
    }
    clearInterval(heartbeatTimer);
  }

  // Keep the Worker alive for the duration of the WebSocket connection
  context.waitUntil(jobPushLoop());

  return new Response(null, { status: 101, webSocket: client });
}
