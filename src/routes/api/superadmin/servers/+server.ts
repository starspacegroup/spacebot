/**
 * Superadmin Servers API
 *
 * GET  /api/superadmin/servers       - List all servers with their plans
 * POST /api/superadmin/servers       - Force-create/update a server plan
 *
 * Superadmin access only.
 */

import { json } from "@sveltejs/kit";
import { getAllServerPlans, upsertServerPlan, getServerPlan, PLAN_TIERS } from "$lib/db/server-plans.js";
import { getAllGuildMetadata } from "$lib/db/guild-metadata.js";

function checkIsSuperAdmin(userId, platform) {
  if (!userId) return false;
  const adminUserIds = (platform as any)?.env?.ADMIN_USER_IDS || process.env.ADMIN_USER_IDS || "";
  return adminUserIds.split(",").map((id) => id.trim()).filter(Boolean).includes(userId);
}

/** @type {import('./$types').RequestHandler} */
export async function GET({ cookies, platform }) {
  const userId = cookies.get("discord_user_id");
  if (!checkIsSuperAdmin(userId, platform)) {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  const db = (platform as any)?.env?.DB;
  if (!db) return json({ error: "Database unavailable" }, { status: 503 });

  // Fetch guild metadata and plans in parallel
  const [allMetadata, allPlans] = await Promise.all([
    getAllGuildMetadata(db),
    getAllServerPlans(db),
  ]);

  // Build a map of plans by guild_id
  const planMap = new Map(allPlans.map((p) => [p.guild_id, p]));

  // Merge servers with their plans
  const servers = allMetadata.map((guild) => ({
    ...guild,
    plan: planMap.get(guild.guild_id) || { plan: "free", ...PLAN_TIERS.free, guild_id: guild.guild_id },
  }));

  return json({ servers, planTiers: PLAN_TIERS });
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ cookies, platform, request }) {
  const userId = cookies.get("discord_user_id");
  if (!checkIsSuperAdmin(userId, platform)) {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  const db = (platform as any)?.env?.DB;
  if (!db) return json({ error: "Database unavailable" }, { status: 503 });

  const body = await request.json();
  if (!body.guild_id) {
    return json({ error: "guild_id is required" }, { status: 400 });
  }

  const result = await upsertServerPlan(db, body.guild_id, body);
  if (!result.success) {
    return json({ error: result.error }, { status: 500 });
  }

  const plan = await getServerPlan(db, body.guild_id);
  return json({ success: true, plan });
}
