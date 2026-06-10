import { json } from "@sveltejs/kit";
import {
  createSuperadminWorkflowRun,
  getSuperadminWorkflowTemplate,
  listSuperadminWorkflowRuns,
} from "$lib/db/superadmin-workflows.js";
import { executeSuperadminWorkflowRun } from "$lib/server/superadmin-workflow-runtime.js";

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
  if (body?.execute_now !== false) {
    const executed = await executeSuperadminWorkflowRun({
      db,
      platform,
      fetch,
      template: result.template,
      run,
      inputJson: body?.input_json,
    });
    if (executed) {
      run = executed;
    }
  }

  return json({ success: true, run, template: result.template }, { status: 201 });
}
