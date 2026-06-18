import { json } from "@sveltejs/kit";
import { listUserActivity } from "$lib/db/user-activity.js";

function checkIsSuperAdmin(userId, platform) {
  if (!userId) return false;
  const adminUserIds = (platform as any)?.env?.ADMIN_USER_IDS || process.env.ADMIN_USER_IDS || "";
  return adminUserIds.split(",").map((id) => id.trim()).filter(Boolean).includes(userId);
}

/** @type {import('./$types').RequestHandler} */
export async function GET({ cookies, platform, params, url }) {
  const userId = cookies.get("discord_user_id");
  if (!checkIsSuperAdmin(userId, platform)) {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  const db = (platform as any)?.env?.DB;
  if (!db) return json({ error: "Database unavailable" }, { status: 503 });

  const page = Number.parseInt(url.searchParams.get("page") || "1", 10);
  const pageSize = Number.parseInt(url.searchParams.get("pageSize") || "25", 10);
  const type = url.searchParams.get("type") || "all";
  const method = url.searchParams.get("method") || "all";
  const pathPrefix = url.searchParams.get("pathPrefix") || "";

  const activity = await listUserActivity(db, params.userId, {
    page,
    pageSize,
    type,
    method,
    pathPrefix,
  });

  return json(activity);
}
