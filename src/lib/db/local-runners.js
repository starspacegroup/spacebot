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
const RUNNER_ONLINE_WINDOW_SECONDS = 90;
const DEFAULT_JOB_PRIORITY = 0;
const MIN_JOB_PRIORITY = -100;
const MAX_JOB_PRIORITY = 100;
const DEFAULT_MAX_ATTEMPTS = 5;
const MIN_MAX_ATTEMPTS = 1;
const MAX_MAX_ATTEMPTS = 20;
const DEFAULT_TIMEOUT_SECONDS = 300;
const MIN_TIMEOUT_SECONDS = 30;
const MAX_TIMEOUT_SECONDS = 3600;
const RETRY_BACKOFF_SECONDS = 5;
const TOKEN_HEARTBEAT_WRITE_WINDOW_SECONDS = 15;
const INSTANCE_HEARTBEAT_WRITE_WINDOW_SECONDS = 15;
const TIMEOUT_SWEEP_INTERVAL_MS = 15_000;
const lastTimeoutSweepByToken = new Map();

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

function normalizeRunnerInstance(row) {
  if (!row) return null;
  return {
    ...row,
    is_online: Boolean(row.is_online),
    metadata: parseJson(row.metadata),
  };
}

function normalizeRunnerEvent(row) {
  if (!row) return null;
  return {
    ...row,
    details: parseJson(row.details),
  };
}

function normalizeRunnerJob(row) {
  if (!row) return null;
  return {
    ...row,
    payload_json: parseJson(row.payload_json),
    result_json: parseJson(row.result_json),
    artifact_refs_json: parseJson(row.artifact_refs_json),
    capability_requirements_json: parseJson(row.capability_requirements_json),
  };
}

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
       WHERE id = ?
         AND (last_seen_at IS NULL OR last_seen_at < datetime('now', ?))`
    )
      .bind(clientIp ?? null, row.id, `-${TOKEN_HEARTBEAT_WRITE_WINDOW_SECONDS} seconds`)
      .run()
      .catch(() => {});

    return { valid: true, tokenId: row.id, userId: row.user_id };
  } catch (err) {
    log.error("[LocalRunners] validateRunnerToken error:", err);
    return { valid: false, error: "Database error" };
  }
}

/**
 * Register or refresh a concrete runner instance behind a token.
 * @param {D1Database} db
 * @param {object} runner
 * @param {number} runner.tokenId
 * @param {string} runner.userId
 * @param {string} runner.instanceKey
 * @param {string} runner.displayName
 * @param {string} [runner.hostname]
 * @param {string} [runner.platform]
 * @param {string} [runner.platformRelease]
 * @param {string} [runner.arch]
 * @param {string} [runner.runnerVersion]
 * @param {string} [runner.defaultWorkdir]
 * @param {object} [runner.metadata]
 * @param {string} [clientIp]
 */
export async function registerRunnerInstance(db, runner, clientIp) {
  if (!db || !runner?.tokenId || !runner?.userId || !runner?.instanceKey || !runner?.displayName) {
    return { success: false, error: "Invalid runner instance payload" };
  }

  const metadataJson = runner.metadata ? JSON.stringify(runner.metadata) : null;

  try {
    const existing = await db
      .prepare(
        `SELECT id
         FROM local_runner_instances
         WHERE runner_token_id = ? AND instance_key = ?`
      )
      .bind(runner.tokenId, runner.instanceKey)
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
          runner.displayName,
          runner.hostname ?? null,
          runner.platform ?? null,
          runner.platformRelease ?? null,
          runner.arch ?? null,
          runner.runnerVersion ?? null,
          runner.defaultWorkdir ?? null,
          metadataJson,
          clientIp ?? null,
          existing.id,
          `-${INSTANCE_HEARTBEAT_WRITE_WINDOW_SECONDS} seconds`
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
          runner.tokenId,
          runner.userId,
          runner.instanceKey,
          runner.displayName,
          runner.hostname ?? null,
          runner.platform ?? null,
          runner.platformRelease ?? null,
          runner.arch ?? null,
          runner.runnerVersion ?? null,
          runner.defaultWorkdir ?? null,
          metadataJson,
          clientIp ?? null
        )
        .run();
    }

    const instance = await db
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
      .bind(`-${RUNNER_ONLINE_WINDOW_SECONDS} seconds`, runner.tokenId, runner.instanceKey)
      .first();

    return { success: true, instance: normalizeRunnerInstance(instance) };
  } catch (err) {
    log.error("[LocalRunners] registerRunnerInstance error:", err);
    return { success: false, error: "Failed to register runner instance" };
  }
}

/**
 * Refresh a runner instance heartbeat.
 * @param {D1Database} db
 * @param {number} instanceId
 * @param {string} [clientIp]
 */
export async function touchRunnerInstance(db, instanceId, clientIp) {
  if (!db || !instanceId) return { success: false, error: "Invalid parameters" };
  try {
    await db
      .prepare(
        `UPDATE local_runner_instances
         SET last_seen_at = datetime('now'), last_seen_ip = ?, updated_at = datetime('now')
         WHERE id = ?`
      )
      .bind(clientIp ?? null, instanceId)
      .run();
    return { success: true };
  } catch (err) {
    log.error("[LocalRunners] touchRunnerInstance error:", err);
    return { success: false, error: "Failed to update runner heartbeat" };
  }
}

/**
 * Mark a runner instance as disconnected.
 * @param {D1Database} db
 * @param {number} instanceId
 */
export async function disconnectRunnerInstance(db, instanceId) {
  if (!db || !instanceId) return { success: false, error: "Invalid parameters" };
  try {
    await db
      .prepare(
        `UPDATE local_runner_instances
         SET last_disconnect_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?`
      )
      .bind(instanceId)
      .run();
    return { success: true };
  } catch (err) {
    log.error("[LocalRunners] disconnectRunnerInstance error:", err);
    return { success: false, error: "Failed to mark runner disconnected" };
  }
}

/**
 * Store a runner activity event.
 * @param {D1Database} db
 * @param {object} event
 */
export async function recordRunnerEvent(db, event) {
  if (!db || !event?.userId || !event?.tokenId || !event?.eventType || !event?.message) {
    return { success: false, error: "Invalid runner event payload" };
  }

  try {
    const detailsJson = event.details ? JSON.stringify(event.details) : null;
    const inserted = await db
      .prepare(
        `INSERT INTO local_runner_events (
           user_id, runner_token_id, runner_instance_id, job_id, event_type, level, message, details
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id, user_id, runner_token_id, runner_instance_id, job_id,
                   event_type, level, message, details, created_at`
      )
      .bind(
        event.userId,
        event.tokenId,
        event.instanceId ?? null,
        event.jobId ?? null,
        event.eventType,
        event.level ?? "info",
        event.message,
        detailsJson
      )
      .first();

    return { success: true, event: normalizeRunnerEvent(inserted) };
  } catch (err) {
    log.error("[LocalRunners] recordRunnerEvent error:", err);
    return { success: false, error: "Failed to record runner event" };
  }
}

/**
 * List concrete runner instances for a user.
 * @param {D1Database} db
 * @param {string} userId
 * @param {object} [options]
 */
export async function getRunnerInstances(db, userId, options = {}) {
  if (!db || !userId) return [];

  const { tokenId = null, limit = 100 } = options;

  try {
    const sql = tokenId
      ? `SELECT i.*, t.name AS token_name,
                CASE
                  WHEN i.last_seen_at IS NOT NULL
                   AND i.last_seen_at >= datetime('now', ?)
                   AND t.revoked = 0
                  THEN 1 ELSE 0
                END AS is_online
         FROM local_runner_instances i
         JOIN local_runner_tokens t ON t.id = i.runner_token_id
         WHERE i.user_id = ? AND i.runner_token_id = ?
         ORDER BY i.last_seen_at DESC, i.created_at DESC
         LIMIT ?`
      : `SELECT i.*, t.name AS token_name,
                CASE
                  WHEN i.last_seen_at IS NOT NULL
                   AND i.last_seen_at >= datetime('now', ?)
                   AND t.revoked = 0
                  THEN 1 ELSE 0
                END AS is_online
         FROM local_runner_instances i
         JOIN local_runner_tokens t ON t.id = i.runner_token_id
         WHERE i.user_id = ?
         ORDER BY i.last_seen_at DESC, i.created_at DESC
         LIMIT ?`;

    const result = tokenId
      ? await db.prepare(sql).bind(`-${RUNNER_ONLINE_WINDOW_SECONDS} seconds`, userId, tokenId, limit).all()
      : await db.prepare(sql).bind(`-${RUNNER_ONLINE_WINDOW_SECONDS} seconds`, userId, limit).all();

    return (result.results || []).map(normalizeRunnerInstance);
  } catch (err) {
    log.error("[LocalRunners] getRunnerInstances error:", err);
    return [];
  }
}

/**
 * List recent runner activity for a user.
 * @param {D1Database} db
 * @param {string} userId
 * @param {object} [options]
 */
export async function getRunnerEvents(db, userId, options = {}) {
  if (!db || !userId) return [];

  const {
    tokenId = null,
    instanceId = null,
    jobId = null,
    limit = 50,
  } = options;

  try {
    let sql = `SELECT e.*, i.display_name AS instance_name, t.name AS token_name
               FROM local_runner_events e
               LEFT JOIN local_runner_instances i ON i.id = e.runner_instance_id
               JOIN local_runner_tokens t ON t.id = e.runner_token_id
               WHERE e.user_id = ?`;
    const params = [userId];

    if (tokenId) {
      sql += " AND e.runner_token_id = ?";
      params.push(tokenId);
    }

    if (instanceId) {
      sql += " AND e.runner_instance_id = ?";
      params.push(instanceId);
    }

    if (jobId) {
      sql += " AND e.job_id = ?";
      params.push(jobId);
    }

    sql += " ORDER BY e.created_at DESC, e.id DESC LIMIT ?";
    params.push(limit);

    const result = await db.prepare(sql).bind(...params).all();
    return (result.results || []).map(normalizeRunnerEvent);
  } catch (err) {
    log.error("[LocalRunners] getRunnerEvents error:", err);
    return [];
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
    const options = typeof limit === "object" && limit !== null
      ? limit
      : { limit };

    const {
      status = null,
      instanceId = null,
      offset = 0,
    } = options;

    const boundedLimit = clampInteger(options.limit, 50, 1, 200);
    const boundedOffset = clampInteger(offset, 0, 0, 10_000);
    const normalizedStatus = typeof status === "string" && status.trim()
      ? status.trim().toLowerCase()
      : null;

    let query = `SELECT j.id, j.runner_token_id, t.name AS runner_name, j.command, j.working_dir,
      j.status, j.output, j.exit_code, j.label, j.job_type, j.payload_json, j.result_json, j.artifact_refs_json,
      j.priority, j.max_attempts, j.attempt_count, j.timeout_seconds, j.started_at, j.next_retry_at,
      j.capability_requirements_json, j.canceled_at, j.cancel_reason, j.terminal_error,
      j.target_instance_id, j.claimed_by_instance_id,
      target.display_name AS target_instance_name,
      claimed.display_name AS claimed_by_instance_name,
      (SELECT COUNT(*) FROM local_runner_artifacts a WHERE a.job_id = j.id) AS artifact_count,
                j.created_at, j.updated_at, j.completed_at
         FROM local_runner_jobs j
         JOIN local_runner_tokens t ON t.id = j.runner_token_id
    LEFT JOIN local_runner_instances target ON target.id = j.target_instance_id
    LEFT JOIN local_runner_instances claimed ON claimed.id = j.claimed_by_instance_id
         WHERE j.user_id = ?`;
    const params = [userId];

    if (tokenId) {
      query += ` AND j.runner_token_id = ?`;
      params.push(tokenId);
    }

    if (normalizedStatus) {
      query += ` AND j.status = ?`;
      params.push(normalizedStatus);
    }

    if (instanceId) {
      query += ` AND (j.target_instance_id = ? OR j.claimed_by_instance_id = ?)`;
      params.push(instanceId, instanceId);
    }

    query += ` ORDER BY j.created_at DESC LIMIT ? OFFSET ?`;
    params.push(boundedLimit, boundedOffset);

    const stmt = db.prepare(query).bind(...params);

    const result = await stmt.all();
    return (result.results || []).map(normalizeRunnerJob);
  } catch (err) {
    log.error("[LocalRunners] getRunnerJobs error:", err);
    return [];
  }
}

/**
 * List artifacts for a specific job owned by a user.
 * @param {D1Database} db
 * @param {string} userId
 * @param {number} jobId
 */
export async function getRunnerArtifactsByJob(db, userId, jobId) {
  if (!db || !userId || !jobId) return [];
  try {
    const result = await db
      .prepare(
        `SELECT id, job_id, artifact_type, mime_type, byte_size, width, height,
                capture_source, capture_index, storage_mode, external_url, metadata_json,
                created_at, expires_at
         FROM local_runner_artifacts
         WHERE user_id = ? AND job_id = ?
         ORDER BY capture_index ASC, id ASC`
      )
      .bind(userId, jobId)
      .all();

    return (result.results || []).map((row) => ({
      ...row,
      metadata_json: parseJson(row.metadata_json),
    }));
  } catch (err) {
    log.error("[LocalRunners] getRunnerArtifactsByJob error:", err);
    return [];
  }
}

/**
 * Fetch a single artifact, optionally including the inline base64 blob.
 * @param {D1Database} db
 * @param {string} userId
 * @param {number} artifactId
 * @param {boolean} includeBlob
 */
export async function getRunnerArtifact(db, userId, artifactId, includeBlob = false) {
  if (!db || !userId || !artifactId) return null;

  const fields = includeBlob
    ? "id, user_id, job_id, artifact_type, mime_type, byte_size, width, height, storage_mode, blob_base64, external_url, metadata_json"
    : "id, user_id, job_id, artifact_type, mime_type, byte_size, width, height, storage_mode, external_url, metadata_json";

  try {
    const row = await db
      .prepare(
        `SELECT ${fields}
         FROM local_runner_artifacts
         WHERE id = ? AND user_id = ?`
      )
      .bind(artifactId, userId)
      .first();

    if (!row) return null;

    return {
      ...row,
      metadata_json: parseJson(row.metadata_json),
    };
  } catch (err) {
    log.error("[LocalRunners] getRunnerArtifact error:", err);
    return null;
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
  const jobType = typeof jobData?.job_type === "string" && jobData.job_type.trim()
    ? jobData.job_type.trim()
    : "shell_command";

  const rawCommand = typeof jobData?.command === "string" ? jobData.command.trim() : "";
  if (jobType === "shell_command" && !rawCommand) {
    return { success: false, error: "Command is required for shell_command jobs" };
  }

  let payloadJson = null;
  if (jobData?.payload_json !== undefined && jobData.payload_json !== null) {
    try {
      payloadJson = JSON.stringify(jobData.payload_json);
    } catch {
      return { success: false, error: "payload_json must be serializable JSON" };
    }
  }

  let capabilityRequirementsJson = null;
  if (jobData?.capability_requirements_json !== undefined && jobData.capability_requirements_json !== null) {
    if (typeof jobData.capability_requirements_json !== "object" || Array.isArray(jobData.capability_requirements_json)) {
      return { success: false, error: "capability_requirements_json must be a JSON object" };
    }
    try {
      capabilityRequirementsJson = JSON.stringify(jobData.capability_requirements_json);
    } catch {
      return { success: false, error: "capability_requirements_json must be serializable JSON" };
    }
  }

  const priority = clampInteger(
    jobData?.priority,
    DEFAULT_JOB_PRIORITY,
    MIN_JOB_PRIORITY,
    MAX_JOB_PRIORITY
  );
  const maxAttempts = clampInteger(
    jobData?.max_attempts,
    DEFAULT_MAX_ATTEMPTS,
    MIN_MAX_ATTEMPTS,
    MAX_MAX_ATTEMPTS
  );
  const timeoutSeconds = clampInteger(
    jobData?.timeout_seconds,
    DEFAULT_TIMEOUT_SECONDS,
    MIN_TIMEOUT_SECONDS,
    MAX_TIMEOUT_SECONDS
  );

  // Verify the token belongs to this user
  const token = await db
    .prepare("SELECT id FROM local_runner_tokens WHERE id = ? AND user_id = ? AND revoked = 0")
    .bind(tokenId, userId)
    .first();
  if (!token) return { success: false, error: "Runner not found or revoked" };

  let targetInstanceId = jobData.target_instance_id ?? null;
  if (targetInstanceId) {
    const instance = await db
      .prepare(
        `SELECT id
         FROM local_runner_instances
         WHERE id = ? AND runner_token_id = ? AND user_id = ?`
      )
      .bind(targetInstanceId, tokenId, userId)
      .first();

    if (!instance) {
      return { success: false, error: "Target runner instance not found" };
    }
  }

  try {
    const result = await db
      .prepare(
        `INSERT INTO local_runner_jobs (
           runner_token_id, user_id, command, working_dir, label, status, target_instance_id,
           job_type, payload_json, capability_requirements_json, priority,
           max_attempts, timeout_seconds
         )
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)
         RETURNING id`
      )
      .bind(
        tokenId,
        userId,
        rawCommand || `[${jobType}]`,
        jobData.working_dir ?? null,
        jobData.label ?? null,
        targetInstanceId,
        jobType,
        payloadJson,
        capabilityRequirementsJson,
        priority,
        maxAttempts,
        timeoutSeconds
      )
      .first();

    return { success: true, jobId: result?.id };
  } catch (err) {
    log.error("[LocalRunners] createRunnerJob error:", err);
    return { success: false, error: "Failed to create job" };
  }
}

async function requeueTimedOutRunnerJobs(db, tokenId) {
  if (!db || !tokenId) return;
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

/**
 * Fetch pending jobs for a runner and transition them to 'running'.
 * @param {D1Database} db
 * @param {number} tokenId - Already validated token ID
 * @returns {Promise<object[]>}
 */
export async function claimPendingJobs(db, tokenId, instanceId = null) {
  if (!db || !tokenId) return [];
  try {
    await requeueTimedOutRunnerJobs(db, tokenId);

    let instanceMetadata = null;
    if (instanceId) {
      const instance = await db
        .prepare("SELECT metadata FROM local_runner_instances WHERE id = ? AND runner_token_id = ?")
        .bind(instanceId, tokenId)
        .first();
      instanceMetadata = parseJson(instance?.metadata);
    }

    const pending = await db
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

    const jobs = pending.results || [];
    if (jobs.length === 0) return [];

    const claimedJobs = [];
    for (const job of jobs) {
      if (!instanceId) {
        // Polling without a concrete instance cannot reliably match capabilities.
        if (job.capability_requirements_json) continue;
      } else if (!jobMeetsCapabilityRequirements(job, instanceMetadata)) {
        continue;
      }

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
        claimedJobs.push(job);
      }
    }

    return claimedJobs.map(normalizeRunnerJob);
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

  let resultJson = null;
  if (result.result_json !== undefined && result.result_json !== null) {
    try {
      resultJson = JSON.stringify(result.result_json);
    } catch {
      return { success: false, error: "result_json must be serializable JSON" };
    }
  }

  let artifactRefsJson = null;
  if (result.artifact_refs_json !== undefined && result.artifact_refs_json !== null) {
    try {
      artifactRefsJson = JSON.stringify(result.artifact_refs_json);
    } catch {
      return { success: false, error: "artifact_refs_json must be serializable JSON" };
    }
  }

  const status = result.status === "failed" ? "failed" : "completed";

  try {
    if (status === "failed") {
      const job = await db
        .prepare(
          `SELECT attempt_count, max_attempts
           FROM local_runner_jobs
           WHERE id = ? AND runner_token_id = ? AND status = 'running'`
        )
        .bind(jobId, tokenId)
        .first();

      if (!job) {
        return { success: false, error: "Job not found or not in running state" };
      }

      const attemptCount = clampInteger(job.attempt_count, 0, 0, Number.MAX_SAFE_INTEGER);
      const maxAttempts = clampInteger(
        job.max_attempts,
        DEFAULT_MAX_ATTEMPTS,
        MIN_MAX_ATTEMPTS,
        MAX_MAX_ATTEMPTS
      );

      if (attemptCount < maxAttempts) {
        const retryUpdate = await db
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
             WHERE id = ? AND runner_token_id = ? AND status = 'running'`
          )
          .bind(
            output,
            result.exitCode ?? null,
            resultJson,
            artifactRefsJson,
            `+${RETRY_BACKOFF_SECONDS} seconds`,
            jobId,
            tokenId
          )
          .run();

        const changed = retryUpdate?.meta?.changes ?? retryUpdate?.changes ?? 0;
        if (!changed) return { success: false, error: "Job not found or not in running state" };
        return { success: true, retried: true };
      }
    }

    const update = await db
      .prepare(
        `UPDATE local_runner_jobs
         SET status = ?, output = ?, exit_code = ?, result_json = ?, artifact_refs_json = ?,
             started_at = NULL,
             next_retry_at = NULL,
             terminal_error = CASE WHEN ? = 'failed' THEN 'Retry budget exhausted' ELSE NULL END,
             updated_at = datetime('now'), completed_at = datetime('now')
         WHERE id = ? AND runner_token_id = ? AND status = 'running'`
      )
      .bind(status, output, result.exitCode ?? null, resultJson, artifactRefsJson, status, jobId, tokenId)
      .run();

    const changed = update?.meta?.changes ?? update?.changes ?? 0;
    if (!changed) return { success: false, error: "Job not found or not in running state" };
    return { success: true };
  } catch (err) {
    log.error("[LocalRunners] reportJobResult error:", err);
    return { success: false, error: "Database error" };
  }
}

export async function cancelRunnerJob(db, userId, jobId, reason = null) {
  if (!db || !userId || !jobId) return { success: false, error: "Invalid parameters" };

  try {
    const update = await db
      .prepare(
        `UPDATE local_runner_jobs
         SET status = 'canceled',
             canceled_at = datetime('now'),
             cancel_reason = ?,
             terminal_error = COALESCE(?, terminal_error),
             completed_at = datetime('now'),
             started_at = NULL,
             next_retry_at = NULL,
             updated_at = datetime('now')
         WHERE id = ?
           AND user_id = ?
           AND status IN ('pending', 'running')`
      )
      .bind(reason ?? null, reason ?? null, jobId, userId)
      .run();

    const changed = update?.meta?.changes ?? update?.changes ?? 0;
    if (!changed) return { success: false, error: "Job not found or cannot be canceled" };
    return { success: true };
  } catch (err) {
    log.error("[LocalRunners] cancelRunnerJob error:", err);
    return { success: false, error: "Failed to cancel job" };
  }
}

export async function retryRunnerJob(db, userId, jobId) {
  if (!db || !userId || !jobId) return { success: false, error: "Invalid parameters" };

  try {
    const update = await db
      .prepare(
        `UPDATE local_runner_jobs
         SET status = 'pending',
             output = NULL,
             exit_code = NULL,
             result_json = NULL,
             artifact_refs_json = NULL,
             claimed_by_instance_id = NULL,
             attempt_count = 0,
             started_at = NULL,
             next_retry_at = NULL,
             canceled_at = NULL,
             cancel_reason = NULL,
             terminal_error = NULL,
             completed_at = NULL,
             updated_at = datetime('now')
         WHERE id = ?
           AND user_id = ?
           AND status IN ('failed', 'canceled')`
      )
      .bind(jobId, userId)
      .run();

    const changed = update?.meta?.changes ?? update?.changes ?? 0;
    if (!changed) return { success: false, error: "Job not found or cannot be retried" };
    return { success: true };
  } catch (err) {
    log.error("[LocalRunners] retryRunnerJob error:", err);
    return { success: false, error: "Failed to retry job" };
  }
}
