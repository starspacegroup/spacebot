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
 *     { type: "connected", runnerId: <tokenId> }
 *     { type: "job", job: { id, command, working_dir, label } }
 *     { type: "ack", jobId: <number> }        — result confirmed stored
 *     { type: "heartbeat" }
 *   Runner → Server:
 *     { type: "result", jobId, status, output, exitCode }
 *
 * Auth: pass the runner token via ?token=sbr_... query parameter
 * (standard WebSocket clients cannot set custom HTTP headers).
 */

const MAX_OUTPUT_BYTES = 65_536;
const JOB_POLL_INTERVAL_MS = 200;
const HEARTBEAT_INTERVAL_MS = 30_000;

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

/**
 * Atomically claim pending jobs for a runner token (marks them 'running').
 * @param {D1Database} db
 * @param {number} tokenId
 * @returns {Promise<Array>}
 */
async function claimPendingJobs(db, tokenId) {
  const result = await db
    .prepare(
      `SELECT id, command, working_dir, label
       FROM local_runner_jobs
       WHERE runner_token_id = ? AND status = 'pending'
       ORDER BY id ASC
       LIMIT 10`
    )
    .bind(tokenId)
    .all();

  const jobs = result.results ?? [];
  if (jobs.length === 0) return [];

  // Mark each as 'running'
  await Promise.all(
    jobs.map((j) =>
      db
        .prepare(
          "UPDATE local_runner_jobs SET status = 'running', updated_at = datetime('now') WHERE id = ? AND status = 'pending'"
        )
        .bind(j.id)
        .run()
        .catch(() => {})
    )
  );

  return jobs;
}

/**
 * Persist a job result reported by the runner.
 * @param {D1Database} db
 * @param {number} tokenId
 * @param {number} jobId
 * @param {{ status: string, output: string, exitCode: number|null }} result
 */
async function storeResult(db, tokenId, jobId, { status, output, exitCode }) {
  let out = typeof output === "string" ? output : "";
  if (out.length > MAX_OUTPUT_BYTES) {
    out = out.slice(0, MAX_OUTPUT_BYTES) + "\n--- output truncated ---";
  }

  await db
    .prepare(
      `UPDATE local_runner_jobs
       SET status = ?, output = ?, exit_code = ?,
           completed_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ? AND runner_token_id = ?`
    )
    .bind(status, out, exitCode ?? null, jobId, tokenId)
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

  server.addEventListener("close", () => {
    closed = true;
  });
  server.addEventListener("error", () => {
    closed = true;
  });

  // Handle messages from the runner
  server.addEventListener("message", async (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return; // ignore malformed
    }

    if (msg.type === "result") {
      const { jobId, status, output, exitCode } = msg;
      if (typeof jobId !== "number" || (status !== "completed" && status !== "failed")) {
        return; // ignore invalid
      }
      try {
        await storeResult(db, auth.tokenId, jobId, { status, output, exitCode });
        server.send(JSON.stringify({ type: "ack", jobId }));
      } catch (e) {
        console.error("[Runner WS] Failed to store result for job", jobId, e);
      }
    }
  });

  // Send initial connected message
  server.send(JSON.stringify({ type: "connected", runnerId: auth.tokenId }));

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
        const jobs = await claimPendingJobs(db, auth.tokenId);
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
