import { redirect } from "@sveltejs/kit";
import { listAIJobsForUser } from "$lib/db/ai-orchestration.js";
import { getRunnerEvents, getRunnerJobs } from "$lib/db/local-runners.js";

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

function asMillis(value) {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

async function getStatusCounts(db, table, userId) {
  const result = await db
    .prepare(
      `SELECT status, COUNT(*) AS count
       FROM ${table}
       WHERE user_id = ?
       GROUP BY status`
    )
    .bind(userId)
    .all();

  const counts = {};
  for (const row of result.results || []) {
    counts[row.status] = Number(row.count) || 0;
  }
  return counts;
}

async function getTypeCounts(db, userId) {
  const result = await db
    .prepare(
      `SELECT job_type, COUNT(*) AS count
       FROM local_runner_jobs
       WHERE user_id = ?
       GROUP BY job_type`
    )
    .bind(userId)
    .all();

  const counts = {};
  for (const row of result.results || []) {
    counts[row.job_type || "unknown"] = Number(row.count) || 0;
  }
  return counts;
}

async function getTimeoutCount(db, userId) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM local_runner_jobs
       WHERE user_id = ?
         AND terminal_error IS NOT NULL
         AND lower(terminal_error) LIKE '%timed out%'`
    )
    .bind(userId)
    .first();
  return Number(row?.count) || 0;
}

async function getAIEventsByJobs(db, jobIds, limit = 500) {
  if (!db || !Array.isArray(jobIds) || jobIds.length === 0) return [];

  const safeIds = jobIds
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (safeIds.length === 0) return [];

  const placeholders = safeIds.map(() => "?").join(", ");
  const safeLimit = clampInt(limit, 500, 1, 2000);

  const result = await db
    .prepare(
      `SELECT id, job_id, event_type, source, step, message, metadata_json, created_at
       FROM ai_job_events
       WHERE job_id IN (${placeholders})
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    )
    .bind(...safeIds, safeLimit)
    .all();

  return (result.results || []).map((row) => ({
    id: row.id,
    jobId: row.job_id,
    eventType: row.event_type,
    source: row.source,
    step: row.step,
    message: row.message,
    metadata: parseJson(row.metadata_json),
    createdAt: row.created_at,
  }));
}

function inferTimelineLevel(domain, type) {
  const normalized = String(type || "").toLowerCase();
  if (normalized.includes("fail") || normalized.includes("error") || normalized.includes("timeout")) return "error";
  if (normalized.includes("retry") || normalized.includes("warn")) return "warn";
  if (domain === "runner" && normalized.includes("completed")) return "ok";
  if (domain === "ai" && normalized.includes("completed")) return "ok";
  return "info";
}

export async function load({ cookies, platform, url }) {
  const userId = cookies.get("discord_user_id");
  if (!userId) {
    throw redirect(302, "/login");
  }

  const db = platform?.env?.DB;
  if (!db) {
    return { jobs: [] };
  }

  const limit = clampInt(url.searchParams.get("limit"), 50, 1, 100);
  const offset = clampInt(url.searchParams.get("offset"), 0, 0, 10_000);
  const status = url.searchParams.get("status") || null;
  const runnerJobType = url.searchParams.get("runnerJobType") || null;
  const q = (url.searchParams.get("q") || "").trim();
  const eventLimit = clampInt(url.searchParams.get("eventLimit"), 200, 50, 800);

  const [jobs, runnerJobs, aiStatusCounts, runnerStatusCounts, runnerTypeCounts, runnerEvents, timeoutCount] = await Promise.all([
    listAIJobsForUser(db, userId, { limit, offset, status }),
    getRunnerJobs(db, userId, null, {
      limit: 120,
      ...(runnerJobType ? { jobType: runnerJobType } : {}),
    }),
    getStatusCounts(db, "ai_jobs", userId),
    getStatusCounts(db, "local_runner_jobs", userId),
    getTypeCounts(db, userId),
    getRunnerEvents(db, userId, { limit: eventLimit }),
    getTimeoutCount(db, userId),
  ]);

  const aiEvents = await getAIEventsByJobs(
    db,
    jobs.map((job) => job.id),
    Math.max(400, eventLimit * 2)
  );

  const aiEventsByJob = new Map();
  for (const event of aiEvents) {
    if (!aiEventsByJob.has(event.jobId)) {
      aiEventsByJob.set(event.jobId, []);
    }
    aiEventsByJob.get(event.jobId).push(event);
  }

  const correlationByAiJobId = new Map();
  for (const job of jobs) {
    correlationByAiJobId.set(job.id, job.correlation_id);
  }

  const runnerEventsByJob = new Map();
  for (const event of runnerEvents || []) {
    if (!event?.job_id) continue;
    if (!runnerEventsByJob.has(event.job_id)) {
      runnerEventsByJob.set(event.job_id, []);
    }
    runnerEventsByJob.get(event.job_id).push({
      id: event.id,
      eventType: event.event_type,
      level: event.level,
      message: event.message,
      source: event.instance_name || event.token_name || "runner",
      details: event.details,
      createdAt: event.created_at,
    });
  }

  const runnerRecentJobs = runnerJobs
    .slice(0, 120)
    .map((job) => ({
      id: job.id,
      jobType: job.job_type,
      status: job.status,
      label: job.label,
      command: job.command,
      output: job.output,
      exitCode: job.exit_code,
      targetInstanceName: job.target_instance_name,
      claimedByInstanceName: job.claimed_by_instance_name,
      attemptCount: job.attempt_count,
      maxAttempts: job.max_attempts,
      timeoutSeconds: job.timeout_seconds,
      terminalError: job.terminal_error,
      artifactCount: job.artifact_count,
      nextRetryAt: job.next_retry_at,
      payload: job.payload_json,
      result: job.result_json,
      capabilityRequirements: job.capability_requirements_json,
      runnerEvents: runnerEventsByJob.get(job.id) || [],
      createdAt: job.created_at,
      startedAt: job.started_at,
      completedAt: job.completed_at,
      updatedAt: job.updated_at,
    }));

  const filteredJobs = q
    ? jobs.filter((job) => {
        const haystack = [
          job.correlation_id,
          job.request_text,
          job.last_error,
          job.status,
          job.source,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(q.toLowerCase());
      })
    : jobs;

  const aiJobsWithEvents = filteredJobs.map((job) => {
    const eventsForJob = aiEventsByJob.get(job.id) || [];
    const latestEvent = eventsForJob[0] || null;
    return {
      id: job.id,
      correlationId: job.correlation_id,
      source: job.source,
      status: job.status,
      requestText: job.request_text,
      maxAttempts: job.max_attempts,
      attemptCount: job.attempt_count,
      nextRetryAt: job.next_retry_at,
      lastError: job.last_error,
      createdAt: job.created_at,
      startedAt: job.started_at,
      completedAt: job.completed_at,
      updatedAt: job.updated_at,
      eventCount: eventsForJob.length,
      latestEvent,
      events: eventsForJob,
    };
  });

  const timeline = [];

  for (const event of aiEvents) {
    timeline.push({
      id: `ai-${event.id}`,
      domain: "ai",
      occurredAt: event.createdAt,
      level: inferTimelineLevel("ai", event.eventType),
      type: event.eventType,
      source: event.source || "autopilot",
      step: event.step,
      message: event.message,
      correlationId: correlationByAiJobId.get(event.jobId) || null,
      aiJobId: event.jobId,
      runnerJobId: null,
      metadata: event.metadata,
    });
  }

  for (const event of runnerEvents || []) {
    timeline.push({
      id: `runner-${event.id}`,
      domain: "runner",
      occurredAt: event.created_at,
      level: inferTimelineLevel("runner", event.event_type || event.level),
      type: event.event_type,
      source: event.instance_name || event.token_name || "runner",
      step: null,
      message: event.message,
      correlationId: null,
      aiJobId: null,
      runnerJobId: event.job_id || null,
      metadata: event.details,
    });
  }

  timeline.sort((a, b) => asMillis(b.occurredAt) - asMillis(a.occurredAt));
  const timelineLimited = timeline.slice(0, eventLimit);

  const allStatusCounts = {
    pending: Number(aiStatusCounts.pending) || 0,
    running: Number(aiStatusCounts.running) || 0,
    completed: Number(aiStatusCounts.completed) || 0,
    failed_terminal: Number(aiStatusCounts.failed_terminal) || 0,
    canceled: Number(aiStatusCounts.canceled) || 0,
  };

  const allRunnerStatusCounts = {
    pending: Number(runnerStatusCounts.pending) || 0,
    running: Number(runnerStatusCounts.running) || 0,
    completed: Number(runnerStatusCounts.completed) || 0,
    failed: Number(runnerStatusCounts.failed) || 0,
    canceled: Number(runnerStatusCounts.canceled) || 0,
  };

  const latestActivityAt = [
    ...jobs.map((j) => j.updated_at || j.created_at),
    ...runnerRecentJobs.map((j) => j.updatedAt || j.createdAt),
    ...timelineLimited.map((e) => e.occurredAt),
  ]
    .filter(Boolean)
    .sort((a, b) => asMillis(b) - asMillis(a))[0] || null;

  return {
    jobs: aiJobsWithEvents,
    filters: {
      limit,
      offset,
      status,
      runnerJobType,
      q,
      eventLimit,
    },
    pagination: {
      limit,
      offset,
      hasPrev: offset > 0,
      hasNext: jobs.length >= limit,
      returned: filteredJobs.length,
      loaded: jobs.length,
    },
    runnerRecentJobs,
    summary: {
      ai: {
        total: Object.values(allStatusCounts).reduce((sum, n) => sum + n, 0),
        counts: allStatusCounts,
      },
      runner: {
        total: Object.values(allRunnerStatusCounts).reduce((sum, n) => sum + n, 0),
        counts: allRunnerStatusCounts,
        typeCounts: runnerTypeCounts,
        timeoutCount,
      },
      latestActivityAt,
      timelineCount: timelineLimited.length,
    },
    timeline: timelineLimited,
  };
}
