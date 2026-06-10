/**
 * Operation registry for superadmin workflow task nodes.
 *
 * A task node with `data.operation` set executes the matching handler here.
 * These wrap the same implementations the legacy /api/cron endpoint uses
 * (via $lib/server/cron-jobs.js), plus workflow-only operations like talking
 * to a local runner or calling an arbitrary HTTP endpoint.
 *
 * Handler context (`ctx`):
 *   db        – D1 database binding
 *   platform  – SvelteKit platform object (env, context)
 *   botToken  – Discord bot token (may be null)
 *   fetch     – event.fetch (relative URLs allowed, cookies forwarded)
 *   data      – the node's data object with {tokens} already resolved
 *   input     – the run input_json object
 *   variables – mutable runtime variable bag
 *   run       – { id } of the current run
 *   template  – { id, slug } of the template
 */

import {
  getBotGuilds,
  getGuildsWithLogs,
  runHourlyAggregation,
  runDailyRefresh,
  runCacheRefresh,
  runRebuildStats,
  refreshServerStatsAndMetadata,
  deleteAggregatedStats,
  verifyAggregateIntegrity,
} from "$lib/server/cron-jobs.js";
import { cleanupOldData } from "$lib/db/stats-aggregation.js";
import { pruneOldStats } from "$lib/db/server-stats.js";
import { processScheduledMessages, getPendingMessages } from "$lib/db/scheduled-messages.js";
import { sweepAllTimedOutRunnerJobs, createRunnerJob } from "$lib/db/local-runners.js";
import { syncWorkersAICatalog } from "$lib/server/workers-ai-models.js";
import { log } from "$lib/log.js";

const RUNNER_WAIT_POLL_MS = 2_500;
const RUNNER_WAIT_DEFAULT_SECONDS = 90;
const RUNNER_WAIT_MAX_SECONDS = 240;
const HTTP_BODY_PREVIEW_LIMIT = 4_000;

function requireBotToken(ctx) {
  if (!ctx.botToken) throw new Error("Bot token not configured");
  return ctx.botToken;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchRunnerJobRow(db, jobId) {
  return db.prepare(
    `SELECT id, status, output, exit_code, result_json, completed_at
     FROM local_runner_jobs WHERE id = ?`
  ).bind(jobId).first();
}

/**
 * Create a job for a local runner and (by default) wait for its result.
 *
 * Node data:
 *   runner_token_id       – required, the local runner token that owns the job
 *   job_type              – shell_command (default) | dm | system_profile | …
 *   command               – required for shell_command
 *   payload / payload_json – payload object for typed jobs
 *   working_dir, label, target_instance_id, timeout_seconds – passthrough
 *   wait_for_result       – default true; false = fire-and-forget
 *   wait_timeout_seconds  – default 90, max 240
 *   fail_on_timeout       – default false; true fails the step if the job
 *                           hasn't finished within the wait window
 */
async function runLocalRunnerJob(ctx) {
  const { db, data } = ctx;
  const tokenId = Number(data.runner_token_id) || 0;
  if (!tokenId) throw new Error("local_runner_job requires data.runner_token_id");

  const token = await db.prepare(
    "SELECT id, user_id FROM local_runner_tokens WHERE id = ? AND revoked = 0"
  ).bind(tokenId).first();
  if (!token) throw new Error(`Runner token ${tokenId} not found or revoked`);

  const payload = data.payload_json ?? data.payload ?? null;
  const created = await createRunnerJob(db, token.user_id, tokenId, {
    command: typeof data.command === "string" ? data.command : "",
    job_type: typeof data.job_type === "string" && data.job_type.trim() ? data.job_type.trim() : "shell_command",
    payload_json: payload,
    working_dir: data.working_dir ?? null,
    label: data.label || `workflow:${ctx.template?.slug || ctx.template?.id} run#${ctx.run?.id}`,
    target_instance_id: data.target_instance_id ?? null,
    timeout_seconds: data.timeout_seconds ?? undefined,
  });

  if (!created.success) {
    throw new Error(`Failed to create runner job: ${created.error}`);
  }

  const jobId = created.jobId;
  if (data.wait_for_result === false) {
    return { jobId, dispatched: true, waited: false };
  }

  const waitSeconds = Math.min(
    Math.max(1, Number(data.wait_timeout_seconds) || RUNNER_WAIT_DEFAULT_SECONDS),
    RUNNER_WAIT_MAX_SECONDS,
  );
  const deadline = Date.now() + waitSeconds * 1000;
  const startedAt = Date.now();

  let row = await fetchRunnerJobRow(db, jobId);
  while (row && !["completed", "failed", "canceled"].includes(String(row.status)) && Date.now() < deadline) {
    await sleep(RUNNER_WAIT_POLL_MS);
    row = await fetchRunnerJobRow(db, jobId);
  }

  const finalStatus = String(row?.status || "unknown");
  const finished = ["completed", "failed", "canceled"].includes(finalStatus);
  const result = {
    jobId,
    dispatched: true,
    waited: true,
    waited_ms: Date.now() - startedAt,
    status: finalStatus,
    timed_out: !finished,
    exit_code: row?.exit_code ?? null,
    output: typeof row?.output === "string" ? row.output.slice(0, 16_000) : null,
    result: (() => {
      try {
        return row?.result_json ? JSON.parse(row.result_json) : null;
      } catch {
        return null;
      }
    })(),
  };

  if (finalStatus === "failed" || finalStatus === "canceled") {
    const detail = result.output ? `: ${result.output.slice(0, 300)}` : "";
    throw Object.assign(new Error(`Runner job #${jobId} ${finalStatus}${detail}`), { operationResult: result });
  }
  if (!finished && data.fail_on_timeout === true) {
    throw Object.assign(new Error(`Runner job #${jobId} did not finish within ${waitSeconds}s`), { operationResult: result });
  }

  return result;
}

/**
 * Generic HTTP request step.
 * Node data: url (required), method, headers (object), body (string|object),
 * fail_on_error (default true).
 */
async function runHttpRequest(ctx) {
  const { data } = ctx;
  const url = String(data.url || "").trim();
  if (!/^https?:\/\//i.test(url) && !url.startsWith("/")) {
    throw new Error("http_request requires data.url (absolute http(s) URL or app-relative path)");
  }

  const method = String(data.method || "POST").toUpperCase();
  const headers = (data.headers && typeof data.headers === "object") ? { ...data.headers } : {};
  let body;
  if (data.body !== undefined && data.body !== null && method !== "GET" && method !== "HEAD") {
    if (typeof data.body === "string") {
      body = data.body;
    } else {
      body = JSON.stringify(data.body);
      if (!headers["Content-Type"] && !headers["content-type"]) headers["Content-Type"] = "application/json";
    }
  }

  const response = await ctx.fetch(url, { method, headers, body });
  const text = await response.text().catch(() => "");
  const result = {
    url,
    method,
    status: response.status,
    ok: response.ok,
    body: text.slice(0, HTTP_BODY_PREVIEW_LIMIT),
  };

  if (!response.ok && data.fail_on_error !== false) {
    throw Object.assign(new Error(`HTTP ${response.status} from ${url}`), { operationResult: result });
  }
  return result;
}

/**
 * Bridge to the legacy /api/cron job runner for anything not yet expressed as
 * granular operations. Node data: legacyJob | job_name.
 */
async function runLegacyCronJob(ctx) {
  const jobName = String(ctx.data.legacyJob || ctx.data.job_name || "").trim();
  if (!jobName) throw new Error("legacy_cron_job requires data.legacyJob");

  const secret = ctx.platform?.env?.CRON_SECRET
    || ctx.platform?.env?.INTERNAL_API_KEY
    || process.env.CRON_SECRET
    || process.env.INTERNAL_API_KEY;

  const headers = { "Content-Type": "application/json" };
  if (secret) headers.Authorization = `Bearer ${secret}`;

  const response = await ctx.fetch("/api/cron", {
    method: "POST",
    headers,
    body: JSON.stringify({ jobName }),
  });
  const bodyJson = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(
      new Error(`Legacy cron job "${jobName}" failed: ${bodyJson.error || `HTTP ${response.status}`}`),
      { operationResult: bodyJson },
    );
  }
  return { jobName, ...bodyJson };
}

const OPERATIONS = {
  // --- Discovery / read-only ---
  getGuildsWithLogs: {
    description: "List guild IDs with event logs in the last 7 days",
    handler: async (ctx) => {
      const guilds = await getGuildsWithLogs(ctx.db);
      ctx.variables.guilds_found = guilds.length;
      return { guilds, count: guilds.length };
    },
  },
  getBotGuilds: {
    description: "List all guilds the bot is currently in",
    handler: async (ctx) => {
      const guilds = await getBotGuilds(requireBotToken(ctx));
      ctx.variables.guilds_found = guilds.length;
      return { count: guilds.length, guilds: guilds.map((g) => ({ id: g.id, name: g.name })) };
    },
  },
  verifyAggregateIntegrity: {
    description: "Sanity-check aggregated stats coverage against source event logs",
    handler: (ctx) => verifyAggregateIntegrity(ctx.db),
  },

  // --- Stats pipeline ---
  runStatsAggregation: {
    description: "Aggregate event logs into hourly + daily stats for all active guilds",
    handler: (ctx) => runHourlyAggregation(ctx.db),
  },
  runHourlyAggregation: {
    description: "Alias of runStatsAggregation",
    handler: (ctx) => runHourlyAggregation(ctx.db),
  },
  fetchGuildStatsFromDiscord: {
    description: "Refresh server stats + guild metadata from Discord for every bot guild",
    handler: (ctx) => refreshServerStatsAndMetadata(ctx.db, requireBotToken(ctx)),
  },
  refreshGuildCache: {
    description: "Refresh member and role caches for every bot guild",
    handler: (ctx) => runCacheRefresh(ctx.db, requireBotToken(ctx)),
  },
  runDailyRefresh: {
    description: "Full daily refresh: stats, metadata, caches, prune, cleanup",
    handler: (ctx) => runDailyRefresh(ctx.db, requireBotToken(ctx)),
  },
  cleanupOldData: {
    description: "Prune old stats and clean up expired operational data",
    handler: async (ctx) => ({
      prunedStats: await pruneOldStats(ctx.db),
      cleanup: await cleanupOldData(ctx.db),
    }),
  },
  deleteAggregatedStats: {
    description: "Delete ALL aggregated stats (hourly + daily)",
    destructive: true,
    handler: (ctx) => deleteAggregatedStats(ctx.db),
  },
  runRebuildStats: {
    description: "Wipe and rebuild all aggregates from event logs (90-day lookback)",
    destructive: true,
    handler: (ctx) => runRebuildStats(ctx.db),
  },

  // --- Scheduled messages ---
  claimScheduledMessages: {
    description: "Count due scheduled messages and expose messages_found to the graph",
    handler: async (ctx) => {
      const limit = Math.max(1, Math.min(500, Number(ctx.data.batch_size) || 100));
      const pending = await getPendingMessages(ctx.db, limit);
      ctx.variables.messages_found = pending.length;
      return { claimed: pending.length };
    },
  },
  processScheduledMessages: {
    description: "Deliver due scheduled messages",
    handler: (ctx) => processScheduledMessages(ctx.db, requireBotToken(ctx)),
  },

  // --- Runner / AI maintenance ---
  sweepAllTimedOutRunnerJobs: {
    description: "Fail + requeue local runner jobs that exceeded their timeout",
    handler: (ctx) => sweepAllTimedOutRunnerJobs(ctx.db),
  },
  syncWorkersAICatalog: {
    description: "Refresh the Workers AI model catalog cache",
    handler: async (ctx) => {
      const synced = await syncWorkersAICatalog(ctx.db, ctx.platform);
      return {
        syncedAt: synced.syncedAt,
        modelCount: Array.isArray(synced.models) ? synced.models.length : 0,
      };
    },
  },

  // --- Integration steps ---
  local_runner_job: {
    description: "Dispatch a job to a local runner (optionally waiting for the result)",
    handler: runLocalRunnerJob,
  },
  http_request: {
    description: "Call an HTTP endpoint with templated url/headers/body",
    handler: runHttpRequest,
  },
  legacy_cron_job: {
    description: "Bridge a single step to a named legacy /api/cron job",
    handler: runLegacyCronJob,
  },
  sleep: {
    description: "Pause the workflow for data.seconds (max 30)",
    handler: async (ctx) => {
      const seconds = Math.max(0, Math.min(30, Number(ctx.data.seconds) || 1));
      await sleep(seconds * 1000);
      return { slept_seconds: seconds };
    },
  },
  noop: {
    description: "Do nothing (placeholder / structural step)",
    handler: () => ({ ok: true }),
  },
};

export function listWorkflowOperations() {
  return Object.entries(OPERATIONS).map(([key, def]) => ({
    key,
    description: def.description,
    destructive: def.destructive === true,
  }));
}

export function hasWorkflowOperation(operationKey) {
  return Boolean(OPERATIONS[String(operationKey || "").trim()]);
}

/**
 * Execute a registered operation. Throws on failure (the runtime turns that
 * into a failed step); unknown operations throw so misconfigured nodes are
 * loud instead of silently skipped.
 */
export async function executeWorkflowOperation(operationKey, ctx) {
  const key = String(operationKey || "").trim();
  const definition = OPERATIONS[key];
  if (!definition) {
    throw new Error(`Unknown workflow operation: "${key}". Registered operations: ${Object.keys(OPERATIONS).join(", ")}`);
  }

  log.debug(`[Workflows] Executing operation ${key} (run #${ctx.run?.id})`);
  return definition.handler(ctx);
}
