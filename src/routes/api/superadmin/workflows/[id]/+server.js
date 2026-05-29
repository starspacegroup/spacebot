import { json } from "@sveltejs/kit";
import {
  archiveSuperadminWorkflowTemplate,
  getSuperadminWorkflowTemplate,
  updateSuperadminWorkflowTemplate,
} from "$lib/db/superadmin-workflows.js";

function checkIsSuperAdmin(userId, platform) {
  if (!userId) return false;
  const adminUserIds = platform?.env?.ADMIN_USER_IDS || process.env.ADMIN_USER_IDS || "";
  return adminUserIds.split(",").map((id) => id.trim()).filter(Boolean).includes(userId);
}

export async function GET({ cookies, platform, params }) {
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

  return json({ template });
}

export async function PATCH({ cookies, platform, params, request }) {
  const userId = cookies.get("discord_user_id");
  if (!checkIsSuperAdmin(userId, platform)) {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  const templateId = Number(params.id);
  if (!templateId) return json({ error: "Invalid workflow ID" }, { status: 400 });

  const db = platform?.env?.DB;
  if (!db) return json({ error: "Database unavailable" }, { status: 503 });

  const body = await request.json();
  const result = await updateSuperadminWorkflowTemplate(db, templateId, userId, body || {});
  if (!result.success) {
    const status = result.error === "Workflow not found" ? 404 : result.error === "A workflow with this slug already exists" ? 409 : 400;
    return json({ error: result.error }, { status });
  }

  return json({ success: true, template: result.template });
}

export async function DELETE({ cookies, platform, params }) {
  const userId = cookies.get("discord_user_id");
  if (!checkIsSuperAdmin(userId, platform)) {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  const templateId = Number(params.id);
  if (!templateId) return json({ error: "Invalid workflow ID" }, { status: 400 });

  const db = platform?.env?.DB;
  if (!db) return json({ error: "Database unavailable" }, { status: 503 });

  const result = await archiveSuperadminWorkflowTemplate(db, templateId, userId);
  if (!result.success) {
    const status = result.error === "Workflow not found" ? 404 : 400;
    return json({ error: result.error }, { status });
  }

  return json({ success: true, template: result.template });
}