/**
 * Local Runner Database Module
 *
 * Handles CRUD for local runner tokens and jobs.
 * Runner tokens are user-scoped (not guild-scoped) and allow a Bun/Node
 * process running on the user's machine to poll for queued jobs and report results.
 *
 * Security: Raw tokens are never stored — only a SHA-256 hash and a short prefix.
 */

import { log } from "./logger.js";

/** Maximum output stored per job (64 KB) */
const MAX_OUTPUT_BYTES = 65536;

/** Token format: sbr_<64 hex chars> */
export function generateRunnerToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `sbr_${hex}`;
}

/** SHA-256 hex of a raw token string */
export async function hashRunnerToken(token) {
  const encoded = new TextEncoder().encode(token);
  const buf = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Token CRUD
// ---------------------------------------------------------------------------

/**
 * List all runner tokens for a user (hashes omitted).
 * @param {D1Database} db
 * @param {string} userId
 */
export async function getRunnerTokens(db, userId) {
  if (!db || !userId) return [];
  try {
    const result = await db
      .prepare(
        `SELECT id, user_id, name, token_prefix, last_seen_at, last_seen_ip,
                revoked, created_at, updated_at
         FROM local_runner_tokens
         WHERE user_id = ?
         ORDER BY created_at DESC`
      )
      .bind(userId)
      .all();
    return (result.results || []).map((r) => ({
      ...r,
      revoked: Boolean(r.revoked),
    }));
  } catch (err) {
    log.error("[LocalRunners] getRunnerTokens error:", err);
    return [];
  }
}

/**
 * Create a new runner token for a user.
 * Returns the token record plus the raw token (shown once only).
 * @param {D1Database} db
 * @param {string} userId
 * @param {string} name - Human-readable label
 * @returns {Promise<{success: boolean, rawToken?: string, record?: object, error?: string}>}
 */
export async function createRunnerToken(db, userId, name) {
  if (!db || !userId) return { success: false, error: "Missing database or user ID" };
  if (!name?.trim()) return { success: false, error: "Name is required" };

  const rawToken = generateRunnerToken();
  const tokenHash = await hashRunnerToken(rawToken);
  const tokenPrefix = rawToken.slice(0, 12); // "sbr_" + 8 chars

  try {
    const result = await db
      .prepare(
        `INSERT INTO local_runner_tokens (user_id, name, token_prefix, token_hash)
         VALUES (?, ?, ?, ?)
         RETURNING id, user_id, name, token_prefix, last_seen_at, revoked, created_at`
      )
      .bind(userId, name.trim(), tokenPrefix, tokenHash)
      .first();

    return {
      success: true,
      rawToken,
      record: { ...result, revoked: Boolean(result?.revoked) },
    };
  } catch (err) {
    log.error("[LocalRunners] createRunnerToken error:", err);
    return { success: false, error: "Failed to create runner token" };
  }
}

/**
 * Soft-revoke a runner token.
 * @param {D1Database} db
 * @param {string} userId - Must own the token
 * @param {number} tokenId
 */
export async function revokeRunnerToken(db, userId, tokenId) {
  if (!db || !userId || !tokenId) return { success: false, error: "Invalid parameters" };
  try {
    const result = await db
      .prepare(
        `UPDATE local_runner_tokens
         SET revoked = 1, updated_at = datetime('now')
         WHERE id = ? AND user_id = ?`
      )
      .bind(tokenId, userId)
      .run();
    const changed = result?.meta?.changes ?? result?.changes ?? 0;
    if (!changed) return { success: false, error: "Token not found or already revoked" };
    return { success: true };
  } catch (err) {
    log.error("[LocalRunners] revokeRunnerToken error:", err);
    return { success: false, error: "Failed to revoke token" };
  }
}

/**
 * Authenticate a runner token from an Authorization header value (the raw token).
 * Updates last_seen_at / last_seen_ip on success.
 * @param {D1Database} db
 * @param {string} rawToken
 * @param {string} [clientIp]
 * @returns {Promise<{valid: boolean, tokenId?: number, userId?: string, error?: string}>}
 */
export async function validateRunnerToken(db, rawToken, clientIp) {
  if (!rawToken?.startsWith("sbr_")) {
    return { valid: false, error: "Invalid token format" };
  }

  const tokenHash = await hashRunnerToken(rawToken);
  const tokenPrefix = rawToken.slice(0, 12);

  try {
    const row = await db
      .prepare(
        `SELECT id, user_id, revoked
         FROM local_runner_tokens
         WHERE token_prefix = ? AND token_hash = ?`
      )
      .bind(tokenPrefix, tokenHash)
      .first();

    if (!row) return { valid: false, error: "Token not found" };
    if (row.revoked) return { valid: false, error: "Token revoked" };

    // Fire-and-forget heartbeat update
    db.prepare(
      `UPDATE local_runner_tokens
       SET last_seen_at = datetime('now'), last_seen_ip = ?, updated_at = datetime('now')
       WHERE id = ?`
    )
      .bind(clientIp ?? null, row.id)
      .run()
      .catch(() => {});

    return { valid: true, tokenId: row.id, userId: row.user_id };
  } catch (err) {
    log.error("[LocalRunners] validateRunnerToken error:", err);
    return { valid: false, error: "Database error" };
  }
}

// ---------------------------------------------------------------------------
// Job CRUD
// ---------------------------------------------------------------------------

/**
 * List recent jobs for a runner token (or all tokens owned by a user).
 * @param {D1Database} db
 * @param {string} userId
 * @param {number|null} [tokenId] - Limit to a specific runner; null = all for user
 * @param {number} [limit]
 */
export async function getRunnerJobs(db, userId, tokenId = null, limit = 50) {
  if (!db || !userId) return [];
  try {
    const query = tokenId
      ? `SELECT j.id, j.runner_token_id, t.name AS runner_name, j.command, j.working_dir,
                j.status, j.output, j.exit_code, j.label,
                j.created_at, j.updated_at, j.completed_at
         FROM local_runner_jobs j
         JOIN local_runner_tokens t ON t.id = j.runner_token_id
         WHERE j.user_id = ? AND j.runner_token_id = ?
         ORDER BY j.created_at DESC LIMIT ?`
      : `SELECT j.id, j.runner_token_id, t.name AS runner_name, j.command, j.working_dir,
                j.status, j.output, j.exit_code, j.label,
                j.created_at, j.updated_at, j.completed_at
         FROM local_runner_jobs j
         JOIN local_runner_tokens t ON t.id = j.runner_token_id
         WHERE j.user_id = ?
         ORDER BY j.created_at DESC LIMIT ?`;

    const stmt = tokenId
      ? db.prepare(query).bind(userId, tokenId, limit)
      : db.prepare(query).bind(userId, limit);

    const result = await stmt.all();
    return result.results || [];
  } catch (err) {
    log.error("[LocalRunners] getRunnerJobs error:", err);
    return [];
  }
}

/**
 * Queue a new job for a runner token.
 * @param {D1Database} db
 * @param {string} userId
 * @param {number} tokenId
 * @param {object} jobData
 * @param {string} jobData.command
 * @param {string} [jobData.working_dir]
 * @param {string} [jobData.label]
 * @returns {Promise<{success: boolean, jobId?: number, error?: string}>}
 */
export async function createRunnerJob(db, userId, tokenId, jobData) {
  if (!db || !userId || !tokenId) return { success: false, error: "Invalid parameters" };
  if (!jobData?.command?.trim()) return { success: false, error: "Command is required" };

  // Verify the token belongs to this user
  const token = await db
    .prepare("SELECT id FROM local_runner_tokens WHERE id = ? AND user_id = ? AND revoked = 0")
    .bind(tokenId, userId)
    .first();
  if (!token) return { success: false, error: "Runner not found or revoked" };

  try {
    const result = await db
      .prepare(
        `INSERT INTO local_runner_jobs (runner_token_id, user_id, command, working_dir, label, status)
         VALUES (?, ?, ?, ?, ?, 'pending')
         RETURNING id`
      )
      .bind(tokenId, userId, jobData.command.trim(), jobData.working_dir ?? null, jobData.label ?? null)
      .first();

    return { success: true, jobId: result?.id };
  } catch (err) {
    log.error("[LocalRunners] createRunnerJob error:", err);
    return { success: false, error: "Failed to create job" };
  }
}

/**
 * Fetch pending jobs for a runner and transition them to 'running'.
 * @param {D1Database} db
 * @param {number} tokenId - Already validated token ID
 * @returns {Promise<object[]>}
 */
export async function claimPendingJobs(db, tokenId) {
  if (!db || !tokenId) return [];
  try {
    // Fetch pending jobs for this runner
    const pending = await db
      .prepare(
        `SELECT id, command, working_dir, label
         FROM local_runner_jobs
         WHERE runner_token_id = ? AND status = 'pending'
         ORDER BY created_at ASC
         LIMIT 10`
      )
      .bind(tokenId)
      .all();

    const jobs = pending.results || [];
    if (jobs.length === 0) return [];

    const ids = jobs.map((j) => j.id);
    const placeholders = ids.map(() => "?").join(", ");
    await db
      .prepare(
        `UPDATE local_runner_jobs
         SET status = 'running', updated_at = datetime('now')
         WHERE id IN (${placeholders})`
      )
      .bind(...ids)
      .run();

    return jobs;
  } catch (err) {
    log.error("[LocalRunners] claimPendingJobs error:", err);
    return [];
  }
}

/**
 * Record the result of a completed job.
 * @param {D1Database} db
 * @param {number} tokenId - Validated token ID (ownership check)
 * @param {number} jobId
 * @param {object} result
 * @param {'completed'|'failed'} result.status
 * @param {string} result.output
 * @param {number} result.exitCode
 */
export async function reportJobResult(db, tokenId, jobId, result) {
  if (!db || !tokenId || !jobId) return { success: false, error: "Invalid parameters" };

  const output = typeof result.output === "string"
    ? result.output.slice(-MAX_OUTPUT_BYTES)
    : null;

  const status = result.status === "failed" ? "failed" : "completed";

  try {
    const update = await db
      .prepare(
        `UPDATE local_runner_jobs
         SET status = ?, output = ?, exit_code = ?,
             updated_at = datetime('now'), completed_at = datetime('now')
         WHERE id = ? AND runner_token_id = ? AND status = 'running'`
      )
      .bind(status, output, result.exitCode ?? null, jobId, tokenId)
      .run();

    const changed = update?.meta?.changes ?? update?.changes ?? 0;
    if (!changed) return { success: false, error: "Job not found or not in running state" };
    return { success: true };
  } catch (err) {
    log.error("[LocalRunners] reportJobResult error:", err);
    return { success: false, error: "Database error" };
  }
}
