import { fail, redirect } from "@sveltejs/kit";
import { log } from "$lib/db/logger.js";
import { getServerPlan, PLAN_TIERS } from "$lib/db/server-plans.js";
import { hasFullAdminPermission } from "$lib/discord/guilds.js";

/**
 * Check if user is a superadmin (defined in ADMIN_USER_IDS env var)
 */
function checkIsSuperAdmin(userId, platform) {
  if (!userId) return false;
  const adminUserIds = platform?.env?.ADMIN_USER_IDS || process.env.ADMIN_USER_IDS || "";
  return adminUserIds.split(",").map((id) => id.trim()).filter(Boolean).includes(userId);
}

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform, parent, params }) {
  if (!/^\d{17,20}$/.test(params.serverId)) {
    throw redirect(302, "/admin");
  }

  const parentData = await parent();
  const userId = cookies.get("discord_user_id");

  if (!userId) {
    throw redirect(302, "/login");
  }

  const serverId = params.serverId;
  const isSuperAdmin = checkIsSuperAdmin(userId, platform);
  const adminGuilds = parentData.adminGuilds || [];

  const hasAccessToServer = isSuperAdmin || adminGuilds.some((g) => g.id === serverId);
  if (!hasAccessToServer) {
    throw redirect(302, "/admin");
  }

  const guild = adminGuilds.find((g) => g.id === serverId);

  // Only administrators can manage billing
  const hasFullAdminAccess = isSuperAdmin || hasFullAdminPermission(guild);
  if (!hasFullAdminAccess) {
    throw redirect(302, `/admin/${serverId}`);
  }

  const db = platform?.env?.DB;
  const plan = db ? await getServerPlan(db, serverId) : { plan: "free", ...PLAN_TIERS.free };

  // Check if Stripe is configured
  const stripeConfigured = !!(platform?.env?.STRIPE_SECRET_KEY || process.env?.STRIPE_SECRET_KEY);

  return {
    serverId,
    guild,
    plan,
    planTiers: PLAN_TIERS,
    stripeConfigured,
    isSuperAdmin,
  };
}
