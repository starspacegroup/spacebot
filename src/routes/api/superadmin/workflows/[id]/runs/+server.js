import { json } from "@sveltejs/kit";
import {
  createSuperadminWorkflowRun,
  getSuperadminWorkflowTemplate,
  listSuperadminWorkflowRuns,
  updateSuperadminWorkflowRun,
} from "$lib/db/superadmin-workflows.js";

function checkIsSuperAdmin(userId, platform) {
  if (!userId) return false;
  const adminUserIds = platform?.env?.ADMIN_USER_IDS || process.env.ADMIN_USER_IDS || "";
  return adminUserIds.split(",").map((id) => id.trim()).filter(Boolean).includes(userId);
}

export async function GET({ cookies, platform, params, url }) {
  const userId = cookies.get("discord_user_id");
  if (!checkIsSuperAdmin(userId, platform)) {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  const templateId = Number(params.id);
  if (!templateId) return json({ error: "Invalid workflow ID" }, { status: 400 });

  const db = platform?.env?.DB;
  if (!db) return json({ error: "Database unavailable" }, { status: 503 });

  const template = await getSuperadminWorkflowTemplate(db, templateId);
  if (!template) return json({ error: "Workflow not found" }, { status: 404 });

  const limit = parseInt(url.searchParams.get("limit") || "50", 10);
  const runs = await listSuperadminWorkflowRuns(db, { templateId, limit });
  return json({ template, runs });
}

export async function POST({ cookies, platform, params, request, fetch }) {
  const userId = cookies.get("discord_user_id");
  if (!checkIsSuperAdmin(userId, platform)) {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  const templateId = Number(params.id);
  if (!templateId) return json({ error: "Invalid workflow ID" }, { status: 400 });

  const db = platform?.env?.DB;
  if (!db) return json({ error: "Database unavailable" }, { status: 503 });

  const body = await request.json();
  const result = await createSuperadminWorkflowRun(db, templateId, userId, body || {});
  if (!result.success) {
    const status = result.error === "Workflow not found" ? 404 : 400;
    return json({ error: result.error }, { status });
  }

  let run = result.run;
  const shouldBridgeLegacyJob = body?.execute_now !== false && result.template?.legacy_job_name;

  if (shouldBridgeLegacyJob) {
    const startedAt = new Date().toISOString().slice(0, 19).replace("T", " ");
    await updateSuperadminWorkflowRun(db, run.id, {
      status: "running",
      started_at: startedAt,
      result_json: {
        bridgeMode: "legacy_cron",
        jobName: result.template.legacy_job_name,
      },
    });

    const startTime = Date.now();
    const cronResponse = await fetch("/api/cron", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobName: result.template.legacy_job_name }),
    });
    const cronBody = await cronResponse.json().catch(() => ({}));

    const runUpdate = await updateSuperadminWorkflowRun(db, run.id, {
      status: cronResponse.ok ? "completed" : "failed",
      completed_at: new Date().toISOString().slice(0, 19).replace("T", " "),
      duration_ms: Date.now() - startTime,
      error_message: cronResponse.ok ? null : (cronBody.error || "Legacy cron bridge failed"),
      result_json: cronResponse.ok
        ? {
          bridgeMode: "legacy_cron",
          jobName: result.template.legacy_job_name,
          cron: cronBody,
        }
        : {
          bridgeMode: "legacy_cron",
          jobName: result.template.legacy_job_name,
          error: cronBody.error || "Legacy cron bridge failed",
        },
    });

    if (runUpdate.success) {
      run = runUpdate.run;
    }
  }

  return json({ success: true, run, template: result.template }, { status: 201 });
}