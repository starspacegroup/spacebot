/**
 * Cron dispatcher for superadmin workflows.
 *
 * POST /api/superadmin/workflows/dispatch
 *   Called on a fixed tick (every 30–60s) by the gateway cron process. Finds
 *   enabled cron-scheduled workflow templates whose expression matches the
 *   current UTC minute, creates a run for each (deduped per minute), and
 *   executes them through the graph runtime. This replaces the hardcoded job
 *   schedules that previously lived in scripts/cron.js.
 *
 *   Auth: Bearer CRON_SECRET / INTERNAL_API_KEY, or a superadmin session.
 *
 * GET /api/superadmin/workflows/dispatch
 *   Superadmin diagnostics: scheduled templates, whether each is due now,
 *   expression validity, and the registered operation catalog.
 */

import { json } from "@sveltejs/kit";
import {
  createSuperadminWorkflowRun,
  listSuperadminWorkflowTemplates,
} from "$lib/db/superadmin-workflows.js";
import { executeSuperadminWorkflowRun } from "$lib/server/superadmin-workflow-runtime.js";
import { seedSuperadminWorkflowPresets } from "$lib/server/superadmin-workflow-presets.js";
import { listWorkflowOperations } from "$lib/server/superadmin-workflow-operations.js";
import { cronMatches, isValidCronExpression } from "$lib/server/cron-match.js";
import { log } from "$lib/log.js";

function checkIsSuperAdmin(userId, platform) {
  if (!userId) return false;
  const adminUserIds = platform?.env?.ADMIN_USER_IDS || process.env.ADMIN_USER_IDS || "";
  return adminUserIds.split(",").map((id) => id.trim()).filter(Boolean).includes(userId);
}

function checkBearerAuth(request, platform) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) return false;

  const cronSecret = platform?.env?.CRON_SECRET || process.env.CRON_SECRET;
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;

  const internalKey = platform?.env?.INTERNAL_API_KEY || process.env.INTERNAL_API_KEY;
  if (internalKey && authHeader === `Bearer ${internalKey}`) return true;

  return false;
}

function isAuthorized({ request, cookies, platform }) {
  if (checkBearerAuth(request, platform)) return true;
  return checkIsSuperAdmin(cookies.get("discord_user_id"), platform);
}

function minuteStartSql(date) {
  // Matches the "YYYY-MM-DD HH:MM:SS" format used for created_at values.
  return `${date.toISOString().slice(0, 16).replace("T", " ")}:00`;
}

function listCronTemplates(templates) {
  return templates.filter((t) =>
    t.enabled
    && !t.archived
    && t.schedule_type === "cron"
    && String(t.cron_expression || "").trim()
  );
}

/**
 * A template already dispatched for this minute must not fire again — the
 * dispatcher tick (30s) is faster than cron granularity (1 min).
 */
async function hasRunThisMinute(db, templateId, minuteSql) {
  const row = await db.prepare(
    `SELECT id FROM superadmin_workflow_runs
     WHERE template_id = ? AND trigger_source = 'cron' AND created_at >= ?
     LIMIT 1`
  ).bind(templateId, minuteSql).first();
  return Boolean(row);
}

export async function GET({ request, cookies, platform }) {
  if (!isAuthorized({ request, cookies, platform })) {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  const db = platform?.env?.DB;
  if (!db) return json({ error: "Database unavailable" }, { status: 503 });

  const now = new Date();
  const templates = await listSuperadminWorkflowTemplates(db, { limit: 200 });
  const scheduled = listCronTemplates(templates).map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    cron_expression: t.cron_expression,
    valid_expression: isValidCronExpression(t.cron_expression),
    due_now: cronMatches(t.cron_expression, now),
  }));

  return json({
    now: now.toISOString(),
    scheduled,
    operations: listWorkflowOperations(),
  });
}

export async function POST({ request, cookies, platform, fetch }) {
  if (!isAuthorized({ request, cookies, platform })) {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  const db = platform?.env?.DB;
  if (!db) return json({ error: "Database unavailable" }, { status: 503 });

  const now = new Date();
  const minuteSql = minuteStartSql(now);

  // First-run continuity: when the database has no templates at all, seed the
  // presets that mirror the legacy cron jobs so replacing scripts/cron.js
  // never leaves the system without its hourly/daily/minute operations.
  let seeded = [];
  let templates = await listSuperadminWorkflowTemplates(db, { includeArchived: true, limit: 200 });
  if (templates.length === 0) {
    seeded = await seedSuperadminWorkflowPresets(db, "system");
    templates = await listSuperadminWorkflowTemplates(db, { includeArchived: true, limit: 200 });
  }

  const cronTemplates = listCronTemplates(templates);
  const due = [];
  const skipped = [];

  for (const template of cronTemplates) {
    if (!isValidCronExpression(template.cron_expression)) {
      skipped.push({ id: template.id, slug: template.slug, reason: "invalid_expression" });
      continue;
    }
    if (!cronMatches(template.cron_expression, now)) continue;
    if (await hasRunThisMinute(db, template.id, minuteSql)) {
      skipped.push({ id: template.id, slug: template.slug, reason: "already_dispatched" });
      continue;
    }
    due.push(template);
  }

  const dispatched = [];
  const failures = [];
  const executions = [];

  for (const template of due) {
    const created = await createSuperadminWorkflowRun(db, template.id, null, {
      trigger_source: "cron",
      input_json: { scheduled_for: minuteSql, dispatched_at: now.toISOString() },
    });

    if (!created.success) {
      failures.push({ id: template.id, slug: template.slug, error: created.error });
      continue;
    }

    dispatched.push({ id: template.id, slug: template.slug, run_id: created.run.id });
    executions.push(
      executeSuperadminWorkflowRun({
        db,
        platform,
        fetch,
        template: created.template,
        run: created.run,
        inputJson: created.run.input_json,
      }).catch((error) => {
        log.error(`[Workflows] Dispatch execution failed for ${template.slug}:`, error);
      })
    );
  }

  // Execute after responding when the platform supports it, so the scheduler
  // tick returns quickly even when a due workflow takes minutes.
  const executionBatch = Promise.allSettled(executions);
  if (platform?.context?.waitUntil) {
    platform.context.waitUntil(executionBatch);
  } else {
    await executionBatch;
  }

  if (dispatched.length > 0) {
    log.info(`[Workflows] Dispatched ${dispatched.length} cron workflow(s): ${dispatched.map((d) => d.slug).join(", ")}`);
  }

  return json({
    success: true,
    now: now.toISOString(),
    checked: cronTemplates.length,
    dispatched,
    skipped,
    failures,
    seeded,
  });
}
