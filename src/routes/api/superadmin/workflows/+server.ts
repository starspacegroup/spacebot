import { json } from "@sveltejs/kit";
import {
  createSuperadminWorkflowTemplate,
  listSuperadminWorkflowRuns,
  listSuperadminWorkflowTemplates,
} from "$lib/db/superadmin-workflows.js";

function checkIsSuperAdmin(userId, platform) {
  if (!userId) return false;
  const adminUserIds = (platform as any)?.env?.ADMIN_USER_IDS || process.env.ADMIN_USER_IDS || "";
  return adminUserIds.split(",").map((id) => id.trim()).filter(Boolean).includes(userId);
}

export async function GET({ cookies, platform, url }) {
  const userId = cookies.get("discord_user_id");
  if (!checkIsSuperAdmin(userId, platform)) {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  const db = (platform as any)?.env?.DB;
  if (!db) return json({ error: "Database unavailable" }, { status: 503 });

  const includeArchived = url.searchParams.get("includeArchived") === "true";
  const limit = parseInt(url.searchParams.get("limit") || "100", 10);
  const runLimit = parseInt(url.searchParams.get("runLimit") || "50", 10);

  const [templates, runs] = await Promise.all([
    listSuperadminWorkflowTemplates(db, { includeArchived, limit }),
    listSuperadminWorkflowRuns(db, { limit: runLimit }),
  ]);

  return json({ templates, runs });
}

export async function POST({ cookies, platform, request }) {
  const userId = cookies.get("discord_user_id");
  if (!checkIsSuperAdmin(userId, platform)) {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  const db = (platform as any)?.env?.DB;
  if (!db) return json({ error: "Database unavailable" }, { status: 503 });

  const body = await request.json();
  const result = await createSuperadminWorkflowTemplate(db, userId, body || {});
  if (!result.success) {
    const status = result.error === "A workflow with this slug already exists" ? 409 : 400;
    return json({ error: result.error }, { status });
  }

  return json({ success: true, template: result.template }, { status: 201 });
}