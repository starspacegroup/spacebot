/**
 * Superadmin Users API
 *
 * GET  /api/superadmin/users       - List all tracked users
 * POST /api/superadmin/users       - Create/update a user record
 *
 * Superadmin access only.
 */

import { json } from "@sveltejs/kit";
import { listUsers, upsertUser, getUser } from "$lib/db/users.js";
import { log } from "$lib/log.js";

function checkIsSuperAdmin(userId, platform) {
  if (!userId) return false;
  const adminUserIds = platform?.env?.ADMIN_USER_IDS || process.env.ADMIN_USER_IDS || "";
  return adminUserIds.split(",").map((id) => id.trim()).filter(Boolean).includes(userId);
}

/** @type {import('./$types').RequestHandler} */
export async function GET({ cookies, platform, url }) {
  const userId = cookies.get("discord_user_id");
  if (!checkIsSuperAdmin(userId, platform)) {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  const db = platform?.env?.DB;
  if (!db) return json({ error: "Database unavailable" }, { status: 503 });

  const search = url.searchParams.get("search") || undefined;
  const limit = parseInt(url.searchParams.get("limit") || "50", 10);
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);
  const sort = url.searchParams.get("sort") || "last_login_at";
  const order = url.searchParams.get("order") || "desc";

  const result = await listUsers(db, { search, limit, offset, sort, order });
  return json(result);
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ cookies, platform, request }) {
  const userId = cookies.get("discord_user_id");
  if (!checkIsSuperAdmin(userId, platform)) {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  const db = platform?.env?.DB;
  if (!db) return json({ error: "Database unavailable" }, { status: 503 });

  const body = await request.json();
  if (!body.id) {
    return json({ error: "User ID is required" }, { status: 400 });
  }

  const result = await upsertUser(db, body);
  if (!result.success) {
    return json({ error: result.error }, { status: 500 });
  }

  const user = await getUser(db, body.id);
  return json({ success: true, user });
}
