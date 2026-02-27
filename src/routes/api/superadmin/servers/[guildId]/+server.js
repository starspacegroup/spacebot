/**
 * Superadmin Single Server API
 *
 * GET    /api/superadmin/servers/[guildId] - Get server details + plan
 * PATCH  /api/superadmin/servers/[guildId] - Update server plan
 * DELETE /api/superadmin/servers/[guildId] - Delete server plan (reset to free)
 *
 * Superadmin access only.
 */

import { json } from "@sveltejs/kit";
import { getServerPlan, upsertServerPlan, deleteServerPlan } from "$lib/db/server-plans.js";
import { getGuildMetadata } from "$lib/db/guild-metadata.js";
import { log } from "$lib/log.js";

function checkIsSuperAdmin(userId, platform) {
  if (!userId) return false;
  const adminUserIds = platform?.env?.ADMIN_USER_IDS || process.env.ADMIN_USER_IDS || "";
  return adminUserIds.split(",").map((id) => id.trim()).filter(Boolean).includes(userId);
}

/** @type {import('./$types').RequestHandler} */
export async function GET({ cookies, platform, params }) {
  const userId = cookies.get("discord_user_id");
  if (!checkIsSuperAdmin(userId, platform)) {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  const db = platform?.env?.DB;
  if (!db) return json({ error: "Database unavailable" }, { status: 503 });

  const [metadata, plan] = await Promise.all([
    getGuildMetadata(db, params.guildId),
    getServerPlan(db, params.guildId),
  ]);

  return json({ server: metadata, plan });
}

/** @type {import('./$types').RequestHandler} */
export async function PATCH({ cookies, platform, params, request }) {
  const userId = cookies.get("discord_user_id");
  if (!checkIsSuperAdmin(userId, platform)) {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  const db = platform?.env?.DB;
  if (!db) return json({ error: "Database unavailable" }, { status: 503 });

  const body = await request.json();
  const result = await upsertServerPlan(db, params.guildId, body);

  if (!result.success) {
    return json({ error: result.error }, { status: 500 });
  }

  const plan = await getServerPlan(db, params.guildId);
  return json({ success: true, plan });
}

/** @type {import('./$types').RequestHandler} */
export async function DELETE({ cookies, platform, params }) {
  const userId = cookies.get("discord_user_id");
  if (!checkIsSuperAdmin(userId, platform)) {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  const db = platform?.env?.DB;
  if (!db) return json({ error: "Database unavailable" }, { status: 503 });

  const result = await deleteServerPlan(db, params.guildId);
  if (!result.success) {
    return json({ error: result.error }, { status: 500 });
  }

  return json({ success: true });
}
