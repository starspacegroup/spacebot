import { redirect } from "@sveltejs/kit";
import {
  listSuperadminWorkflowRuns,
  listSuperadminWorkflowTemplates,
} from "$lib/db/superadmin-workflows.js";

const LEGACY_STARTERS = [
  {
    name: "Daily Refresh Migration",
    slug: "daily-refresh-migration",
    description: "Template starter for the legacy daily_refresh cron job.",
    category: "cron-migration",
    execution_backend: "cloudflare_workflows",
    legacy_job_name: "daily_refresh",
    schedule_type: "cron",
    cron_expression: "0 0 * * *",
    canvas_json: {
      nodes: [
        { id: "start", type: "trigger", title: "Schedule Trigger", position: { x: 0, y: 0 }, data: { schedule: "0 0 * * *" } },
        { id: "aggregate", type: "task", title: "Aggregate Stats", position: { x: 0, y: 140 }, data: { legacyJob: "hourly_aggregation" } },
        { id: "refresh", type: "task", title: "Refresh Discord Data", position: { x: 0, y: 280 }, data: { legacyJob: "daily_refresh" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "aggregate" },
        { id: "e2", source: "aggregate", target: "refresh" },
      ],
    },
  },
  {
    name: "Scheduled Messages Dispatcher",
    slug: "scheduled-messages-dispatcher",
    description: "Starter for moving send_scheduled_messages into a workflow run pipeline.",
    category: "cron-migration",
    execution_backend: "cloudflare_workflows",
    legacy_job_name: "send_scheduled_messages",
    schedule_type: "cron",
    cron_expression: "* * * * *",
    canvas_json: {
      nodes: [
        { id: "start", type: "trigger", title: "Minute Trigger", position: { x: 0, y: 0 }, data: { schedule: "* * * * *" } },
        { id: "claim", type: "task", title: "Claim Due Messages", position: { x: 0, y: 140 }, data: { batchSize: 100 } },
        { id: "deliver", type: "task", title: "Deliver Messages", position: { x: 0, y: 280 }, data: { strategy: "fanout" } },
      ],
      edges: [
        { id: "e1", source: "start", target: "claim" },
        { id: "e2", source: "claim", target: "deliver" },
      ],
    },
  },
  {
    name: "Rebuild Stats Recovery Run",
    slug: "rebuild-stats-recovery-run",
    description: "Starter for the rebuild_stats manual recovery workflow.",
    category: "recovery",
    execution_backend: "cloudflare_workflows",
    legacy_job_name: "rebuild_stats",
    schedule_type: "manual",
    cron_expression: null,
    canvas_json: {
      nodes: [
        { id: "review", type: "approval", title: "Dangerous Action Review", position: { x: 0, y: 0 }, data: { requiresConfirmation: true } },
        { id: "wipe", type: "task", title: "Wipe Aggregates", position: { x: 0, y: 140 }, data: { destructive: true } },
        { id: "rebuild", type: "task", title: "Rebuild Historical Stats", position: { x: 0, y: 280 }, data: { legacyJob: "rebuild_stats" } },
      ],
      edges: [
        { id: "e1", source: "review", target: "wipe" },
        { id: "e2", source: "wipe", target: "rebuild" },
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
    legacyStarters: LEGACY_STARTERS,
  };
}