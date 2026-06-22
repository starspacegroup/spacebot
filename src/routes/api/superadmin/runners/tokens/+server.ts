import { json } from "@sveltejs/kit";
import { getAllRunnerTokens } from "$lib/db/local-runners.js";

function checkIsSuperAdmin(userId, platform) {
  if (!userId) return false;
  const adminUserIds = (platform as any)?.env?.ADMIN_USER_IDS || process.env.ADMIN_USER_IDS || "";
  return adminUserIds.split(",").map((id) => id.trim()).filter(Boolean).includes(userId);
}

// Backs the runner-token picker in the superadmin workflow editor's task
// step (operation: "local_runner_job") — see src/routes/admin/superadmin/workflows/+page.svelte.
export async function GET({ cookies, platform }) {
  const userId = cookies.get("discord_user_id");
  if (!checkIsSuperAdmin(userId, platform)) {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  const db = (platform as any)?.env?.DB;
  if (!db) return json({ error: "Database unavailable" }, { status: 503 });

  const tokens = await getAllRunnerTokens(db);
  return json({ tokens });
}
