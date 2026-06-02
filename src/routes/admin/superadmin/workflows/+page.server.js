import { redirect } from "@sveltejs/kit";
import {
  listSuperadminWorkflowRuns,
  listSuperadminWorkflowTemplates,
} from "$lib/db/superadmin-workflows.js";

const OPERATION_TEMPLATES = [
  {
    name: "Hourly Server Activity Rollup",
    slug: "hourly-server-activity-rollup",
    description: "Runs the current hourly gateway operations path for event-to-stats aggregation and queue hygiene.",
    category: "operations",
    execution_backend: "cloudflare_workflows",
    legacy_job_name: "hourly_aggregation",
    schedule_type: "cron",
    cron_expression: "0 * * * *",
    canvas_json: {
      nodes: [
        { id: "start", type: "trigger", title: "Hourly Trigger", position: { x: 0, y: 0 }, data: { schedule: "0 * * * *", source: "gateway-cron" } },
        { id: "discover", type: "task", title: "Discover Active Guilds", position: { x: 0, y: 140 }, data: { operation: "getGuildsWithLogs", queue_key: "ops.stats.discovery" } },
        { id: "aggregate", type: "task", title: "Aggregate Hourly + Daily Stats", position: { x: 0, y: 280 }, data: { operation: "runStatsAggregation", queue_key: "ops.stats.aggregate" } },
        { id: "runnerSweep", type: "task", title: "Sweep Timed-Out Runner Jobs", position: { x: 0, y: 420 }, data: { operation: "sweepAllTimedOutRunnerJobs", queue_key: "ops.runners.sweep" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "discover", label: "start" },
        { id: "e2", source: "discover", target: "aggregate", label: "guilds_found" },
        { id: "e3", source: "aggregate", target: "runnerSweep", label: "success" },
      ],
    },
  },
  {
    name: "Daily Server Intelligence Refresh",
    slug: "daily-server-intelligence-refresh",
    description: "Runs the current daily gateway operations sequence: refresh stats/metadata/cache, prune stale data, and close orphaned sessions.",
    category: "operations",
    execution_backend: "cloudflare_workflows",
    legacy_job_name: "daily_refresh",
    schedule_type: "cron",
    cron_expression: "0 0 * * *",
    canvas_json: {
      nodes: [
        { id: "start", type: "trigger", title: "Daily Trigger", position: { x: 0, y: 0 }, data: { schedule: "0 0 * * *", source: "gateway-cron" } },
        { id: "aggregate", type: "task", title: "Run Aggregation First", position: { x: 0, y: 140 }, data: { operation: "runHourlyAggregation", queue_key: "ops.stats.aggregate" } },
        { id: "fetch", type: "task", title: "Fetch Guild Data from Discord", position: { x: 0, y: 280 }, data: { operation: "fetchGuildStatsFromDiscord", queue_key: "ops.discord.fetch" } },
        { id: "cache", type: "task", title: "Refresh Member + Role Cache", position: { x: 0, y: 420 }, data: { operation: "refreshGuildCache", queue_key: "ops.discord.cache" } },
        { id: "cleanup", type: "task", title: "Prune + Cleanup Old Operational Data", position: { x: 0, y: 560 }, data: { operation: "cleanupOldData", queue_key: "ops.maintenance.cleanup" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "aggregate", label: "start" },
        { id: "e2", source: "aggregate", target: "fetch", label: "success" },
        { id: "e3", source: "fetch", target: "cache", label: "success" },
        { id: "e4", source: "cache", target: "cleanup", label: "success" },
      ],
    },
  },
  {
    name: "Minute Scheduled Message Dispatch",
    slug: "minute-scheduled-message-dispatch",
    description: "Dispatches due scheduled messages every minute with a queue-friendly claim-and-deliver flow.",
    category: "operations",
    execution_backend: "cloudflare_workflows",
    legacy_job_name: "send_scheduled_messages",
    schedule_type: "cron",
    cron_expression: "* * * * *",
    canvas_json: {
      nodes: [
        { id: "start", type: "trigger", title: "Minute Trigger", position: { x: 0, y: 0 }, data: { schedule: "* * * * *", source: "gateway-cron" } },
        { id: "claim", type: "task", title: "Claim Due Messages", position: { x: 0, y: 140 }, data: { operation: "claimScheduledMessages", queue_key: "ops.messages.claim", batch_size: 100 } },
        { id: "deliver", type: "task", title: "Deliver Messages", position: { x: 0, y: 280 }, data: { operation: "processScheduledMessages", queue_key: "ops.messages.deliver" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "claim", label: "start" },
        { id: "e2", source: "claim", target: "deliver", label: "messages_found" },
      ],
    },
  },
  {
    name: "Workers AI Catalog Sync",
    slug: "workers-ai-catalog-sync",
    description: "Keeps the cached Workers AI model catalog fresh in the database for superadmin model selection.",
    category: "operations",
    execution_backend: "cloudflare_workflows",
    legacy_job_name: "sync_workers_ai_models",
    schedule_type: "cron",
    cron_expression: "0 */6 * * *",
    canvas_json: {
      nodes: [
        { id: "start", type: "trigger", title: "6-Hour Trigger", position: { x: 0, y: 0 }, data: { schedule: "0 */6 * * *", source: "gateway-cron" } },
        { id: "sync", type: "task", title: "Sync Workers AI Catalog", position: { x: 0, y: 140 }, data: { operation: "syncWorkersAICatalog", queue_key: "ops.ai.catalog" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "sync", label: "start" },
      ],
    },
  },
  {
    name: "Rebuild Stats Recovery Run",
    slug: "rebuild-stats-recovery-run",
    description: "Manual recovery path for rebuilding all aggregates from source event logs.",
    category: "recovery",
    execution_backend: "cloudflare_workflows",
    legacy_job_name: "rebuild_stats",
    schedule_type: "manual",
    cron_expression: null,
    canvas_json: {
      nodes: [
        { id: "review", type: "approval", title: "Dangerous Action Review", position: { x: 0, y: 0 }, data: { requiresConfirmation: true } },
        { id: "wipe", type: "task", title: "Wipe Existing Aggregates", position: { x: 0, y: 140 }, data: { operation: "deleteAggregatedStats", destructive: true, queue_key: "ops.recovery.prepare" } },
        { id: "rebuild", type: "task", title: "Rebuild Historical Stats", position: { x: 0, y: 280 }, data: { operation: "runRebuildStats", legacyJob: "rebuild_stats", queue_key: "ops.recovery.rebuild" } },
        { id: "verify", type: "task", title: "Verify Rebuild Totals", position: { x: 0, y: 420 }, data: { operation: "verifyAggregateIntegrity", queue_key: "ops.recovery.verify" } },
      ],
      edges: [
        { id: "e1", source: "review", target: "wipe", label: "approved" },
        { id: "e2", source: "wipe", target: "rebuild", label: "prepared" },
        { id: "e3", source: "rebuild", target: "verify", label: "success" },
      ],
    },
  },
  {
    name: "Manual Member and Role Cache Refresh",
    slug: "manual-member-role-cache-refresh",
    description: "Manual operations template to refresh member and role caches without running full daily refresh.",
    category: "operations",
    execution_backend: "cloudflare_workflows",
    legacy_job_name: "refresh_cache",
    schedule_type: "manual",
    cron_expression: null,
    canvas_json: {
      nodes: [
        { id: "start", type: "trigger", title: "Manual Trigger", position: { x: 0, y: 0 }, data: { source: "operator" } },
        { id: "guilds", type: "task", title: "Fetch Bot Guilds", position: { x: 0, y: 140 }, data: { operation: "getBotGuilds", queue_key: "ops.discord.guilds" } },
        { id: "refresh", type: "task", title: "Refresh Cache for Each Guild", position: { x: 0, y: 280 }, data: { operation: "refreshGuildCache", queue_key: "ops.discord.cache" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "guilds", label: "start" },
        { id: "e2", source: "guilds", target: "refresh", label: "guilds_found" },
      ],
    },
  },
];

function checkIsSuperAdmin(userId, platform) {
  if (!userId) return false;
  const adminUserIds = platform?.env?.ADMIN_USER_IDS || process.env.ADMIN_USER_IDS || "";
  return adminUserIds.split(",").map((id) => id.trim()).filter(Boolean).includes(userId);
}

export async function load({ cookies, platform }) {
  const userId = cookies.get("discord_user_id");
  if (!checkIsSuperAdmin(userId, platform)) {
    throw redirect(302, "/admin");
  }

  const db = platform?.env?.DB;
  const [templates, runs] = db
    ? await Promise.all([
        listSuperadminWorkflowTemplates(db, { limit: 100 }),
        listSuperadminWorkflowRuns(db, { limit: 100 }),
      ])
    : [[], []];

  return {
    templates,
    runs,
    operationTemplates: OPERATION_TEMPLATES,
  };
}