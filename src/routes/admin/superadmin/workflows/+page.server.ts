import { redirect } from "@sveltejs/kit";
import {
  listSuperadminWorkflowRuns,
  listSuperadminWorkflowTemplates,
} from "$lib/db/superadmin-workflows.js";
import { OPERATION_TEMPLATES } from "$lib/server/superadmin-workflow-presets.js";

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

  const db = (platform as any)?.env?.DB;
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