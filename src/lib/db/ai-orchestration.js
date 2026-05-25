import { log } from "$lib/db/logger.js";

const DEFAULT_TIMEOUT_SECONDS = 300;
const MIN_TIMEOUT_SECONDS = 30;
const MAX_TIMEOUT_SECONDS = 3600;
const DEFAULT_MAX_ATTEMPTS = 6;
const MIN_MAX_ATTEMPTS = 1;
const MAX_MAX_ATTEMPTS = 20;

function parseJson(value) {
  if (!value) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  return Math.max(min, Math.min(max, i));
}

function stringifyNullableJson(value) {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

function normalizeJob(row) {
  if (!row) return null;
  return {
    ...row,
    history_json: parseJson(row.history_json),
    managed_guilds_json: parseJson(row.managed_guilds_json),
    selected_guild_json: parseJson(row.selected_guild_json),
    response_target_json: parseJson(row.response_target_json),
    provider_chain_json: parseJson(row.provider_chain_json),
    metadata_json: parseJson(row.metadata_json),
    last_retry_decision_json: parseJson(row.last_retry_decision_json),
  };
}

export function generateCorrelationId() {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `aij_${Date.now().toString(36)}_${hex}`;
}

export async function appendAIJobEvent(db, jobId, event) {
  if (!db || !jobId || !event?.eventType) return;

  try {
    await db
      .prepare(
        `INSERT INTO ai_job_events (job_id, event_type, source, step, message, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(
        jobId,
        event.eventType,
        event.source || "unknown",
        event.step || null,
        event.message || null,
        event.metadata ? JSON.stringify(event.metadata) : null,
      )
      .run();
  } catch (err) {
    log.warn("[AI Autopilot] Failed to append job event:", err?.message || err);
  }
}

export async function createAIJob(db, data) {
  if (!db) return { success: false, error: "Database not available" };

  const correlationId = data.correlationId || generateCorrelationId();
  const timeoutSeconds = clampInt(
    data.timeoutSeconds,
    DEFAULT_TIMEOUT_SECONDS,
    MIN_TIMEOUT_SECONDS,
    MAX_TIMEOUT_SECONDS,
  );
  const maxAttempts = clampInt(
    data.maxAttempts,
    DEFAULT_MAX_ATTEMPTS,
    MIN_MAX_ATTEMPTS,
    MAX_MAX_ATTEMPTS,
  );

  try {
    const result = await db
      .prepare(
        `INSERT INTO ai_jobs (
           correlation_id, source, status,
           user_id, user_name, guild_id,
           request_text, history_json, managed_guilds_json, selected_guild_json,
           response_target_json, provider_chain_json, metadata_json,
           timeout_seconds, max_attempts, attempt_count, next_retry_at
         ) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))
         RETURNING id, correlation_id, status, created_at`
      )
      .bind(
        correlationId,
        data.source || "unknown",
        data.userId,
        data.userName || null,
        data.guildId || null,
        data.requestText,
        stringifyNullableJson(data.history || []),
        stringifyNullableJson(data.managedGuilds || []),
        stringifyNullableJson(data.selectedGuild || null),
        stringifyNullableJson(data.responseTarget || null),
        stringifyNullableJson(data.providerChain || []),
        stringifyNullableJson(data.metadata || null),
        timeoutSeconds,
        maxAttempts,
      )
      .first();

    await appendAIJobEvent(db, result?.id, {
      eventType: "job.queued",
      source: data.source || "unknown",
      step: "queued",
      message: "AI job queued",
      metadata: {
        correlationId,
        maxAttempts,
        timeoutSeconds,
      },
    });

    return {
      success: true,
      jobId: result?.id,
      correlationId: result?.correlation_id,
      status: result?.status,
      createdAt: result?.created_at,
    };
  } catch (err) {
    log.error("[AI Autopilot] createAIJob error:", err);
    return { success: false, error: "Failed to create AI job" };
  }
}

export async function getAIJobById(db, jobId) {
  if (!db || !jobId) return null;
  const row = await db
    .prepare(`SELECT * FROM ai_jobs WHERE id = ?`)
    .bind(jobId)
    .first();
  return normalizeJob(row);
}

export async function getAIJobByCorrelationId(db, correlationId) {
  if (!db || !correlationId) return null;
  const row = await db
    .prepare(`SELECT * FROM ai_jobs WHERE correlation_id = ?`)
    .bind(correlationId)
    .first();
  return normalizeJob(row);
}

export async function listAIJobsForUser(db, userId, options = {}) {
  if (!db || !userId) return [];

  const limit = clampInt(options.limit, 25, 1, 200);
  const offset = Math.max(0, Number(options.offset) || 0);
  const status = typeof options.status === "string" && options.status.trim()
    ? options.status.trim()
    : null;

  const statusSql = status ? "AND status = ?" : "";
  const binds = status ? [userId, status, limit, offset] : [userId, limit, offset];

  const result = await db
    .prepare(
      `SELECT *
       FROM ai_jobs
       WHERE user_id = ?
         ${statusSql}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`
    )
    .bind(...binds)
    .all();

  return (result.results || []).map(normalizeJob);
}

export async function claimAIJobForExecution(db, jobId) {
  if (!db || !jobId) return { success: false, error: "Invalid parameters" };

  try {
    const update = await db
      .prepare(
        `UPDATE ai_jobs
         SET status = 'running',
             started_at = datetime('now'),
             attempt_count = attempt_count + 1,
             next_retry_at = NULL,
             updated_at = datetime('now')
         WHERE id = ?
           AND status = 'pending'
           AND (next_retry_at IS NULL OR next_retry_at <= datetime('now'))
           AND attempt_count < max_attempts`
      )
      .bind(jobId)
      .run();

    const changed = update?.meta?.changes ?? update?.changes ?? 0;
    if (!changed) {
      return { success: false, error: "Job not claimable" };
    }

    const job = await getAIJobById(db, jobId);
    await appendAIJobEvent(db, jobId, {
      eventType: "job.running",
      source: "autopilot_executor",
      step: "execution_started",
      message: "AI job execution started",
      metadata: { attemptCount: job?.attempt_count },
    });

    return { success: true, job };
  } catch (err) {
    log.error("[AI Autopilot] claimAIJobForExecution error:", err);
    return { success: false, error: "Failed to claim AI job" };
  }
}

export async function completeAIJob(db, jobId, resultMetadata = null) {
  if (!db || !jobId) return { success: false, error: "Invalid parameters" };

  try {
    const update = await db
      .prepare(
        `UPDATE ai_jobs
         SET status = 'completed',
             completed_at = datetime('now'),
             updated_at = datetime('now'),
             last_error = NULL,
             last_retry_decision_json = ?
         WHERE id = ?
           AND status = 'running'`
      )
      .bind(stringifyNullableJson(resultMetadata), jobId)
      .run();

    const changed = update?.meta?.changes ?? update?.changes ?? 0;
    if (!changed) return { success: false, error: "Job not in running state" };

    await appendAIJobEvent(db, jobId, {
      eventType: "job.completed",
      source: "autopilot_executor",
      step: "completed",
      message: "AI job completed",
      metadata: resultMetadata || undefined,
    });

    return { success: true };
  } catch (err) {
    log.error("[AI Autopilot] completeAIJob error:", err);
    return { success: false, error: "Failed to complete AI job" };
  }
}

export async function scheduleAIJobRetry(db, jobId, errorText, decision) {
  if (!db || !jobId) return { success: false, error: "Invalid parameters" };

  const delayMs = Math.max(0, Number(decision?.nextRetryDelayMs) || 0);
  const delaySeconds = Math.max(0, Math.ceil(delayMs / 1000));
  const retryAtExpr = delaySeconds > 0 ? `+${delaySeconds} seconds` : "now";

  try {
    const update = await db
      .prepare(
        `UPDATE ai_jobs
         SET status = 'pending',
             started_at = NULL,
             next_retry_at = datetime('now', ?),
             updated_at = datetime('now'),
             last_error = ?,
             last_retry_decision_json = ?
         WHERE id = ?
           AND status = 'running'`
      )
      .bind(retryAtExpr, String(errorText || "Unknown error").slice(0, 2000), stringifyNullableJson(decision), jobId)
      .run();

    const changed = update?.meta?.changes ?? update?.changes ?? 0;
    if (!changed) return { success: false, error: "Job not in running state" };

    await appendAIJobEvent(db, jobId, {
      eventType: "job.retry_scheduled",
      source: "autopilot_executor",
      step: "retry_scheduled",
      message: `Retry scheduled in ${delaySeconds}s`,
      metadata: {
        delaySeconds,
        decision,
      },
    });

    return { success: true, delaySeconds };
  } catch (err) {
    log.error("[AI Autopilot] scheduleAIJobRetry error:", err);
    return { success: false, error: "Failed to schedule retry" };
  }
}

export async function failAIJobTerminal(db, jobId, errorText, decision = null) {
  if (!db || !jobId) return { success: false, error: "Invalid parameters" };

  try {
    const update = await db
      .prepare(
        `UPDATE ai_jobs
         SET status = 'failed_terminal',
             completed_at = datetime('now'),
             updated_at = datetime('now'),
             started_at = NULL,
             next_retry_at = NULL,
             last_error = ?,
             last_retry_decision_json = ?
         WHERE id = ?
           AND status IN ('running', 'pending')`
      )
      .bind(String(errorText || "Unknown error").slice(0, 2000), stringifyNullableJson(decision), jobId)
      .run();

    const changed = update?.meta?.changes ?? update?.changes ?? 0;
    if (!changed) return { success: false, error: "Job not mutable" };

    await appendAIJobEvent(db, jobId, {
      eventType: "job.failed_terminal",
      source: "autopilot_executor",
      step: "failed_terminal",
      message: "AI job failed terminally",
      metadata: {
        error: errorText,
        decision,
      },
    });

    return { success: true };
  } catch (err) {
    log.error("[AI Autopilot] failAIJobTerminal error:", err);
    return { success: false, error: "Failed to fail job" };
  }
}

export async function getDuePendingAIJobs(db, limit = 25) {
  if (!db) return [];

  const safeLimit = clampInt(limit, 25, 1, 100);
  const result = await db
    .prepare(
      `SELECT *
       FROM ai_jobs
       WHERE status = 'pending'
         AND (next_retry_at IS NULL OR next_retry_at <= datetime('now'))
       ORDER BY created_at ASC
       LIMIT ?`
    )
    .bind(safeLimit)
    .all();

  return (result.results || []).map(normalizeJob);
}

export async function recoverStaleRunningAIJobs(db) {
  if (!db) return { recovered: 0 };

  const recoveredResult = await db
    .prepare(
      `UPDATE ai_jobs
       SET status = 'pending',
           started_at = NULL,
           next_retry_at = datetime('now', '+10 seconds'),
           updated_at = datetime('now'),
           last_error = COALESCE(last_error, 'Job marked stale and recovered by watchdog')
       WHERE status = 'running'
         AND started_at IS NOT NULL
         AND datetime(started_at, '+' || timeout_seconds || ' seconds') <= datetime('now')
         AND attempt_count < max_attempts`
    )
    .run();

  const failedResult = await db
    .prepare(
      `UPDATE ai_jobs
       SET status = 'failed_terminal',
           started_at = NULL,
           completed_at = datetime('now'),
           updated_at = datetime('now'),
           next_retry_at = NULL,
           last_error = COALESCE(last_error, 'Stale job exhausted retry budget')
       WHERE status = 'running'
         AND started_at IS NOT NULL
         AND datetime(started_at, '+' || timeout_seconds || ' seconds') <= datetime('now')
         AND attempt_count >= max_attempts`
    )
    .run();

  return {
    recovered: recoveredResult?.meta?.changes ?? recoveredResult?.changes ?? 0,
    failed: failedResult?.meta?.changes ?? failedResult?.changes ?? 0,
  };
}

export async function getAIJobEvents(db, jobId, limit = 200) {
  if (!db || !jobId) return [];
  const safeLimit = clampInt(limit, 200, 1, 500);

  const result = await db
    .prepare(
      `SELECT id, event_type, source, step, message, metadata_json, created_at
       FROM ai_job_events
       WHERE job_id = ?
       ORDER BY created_at ASC
       LIMIT ?`
    )
    .bind(jobId, safeLimit)
    .all();

  return (result.results || []).map((row) => ({
    ...row,
    metadata_json: parseJson(row.metadata_json),
  }));
}
