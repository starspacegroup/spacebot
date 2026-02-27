import { redirect } from "@sveltejs/kit";
import { log } from "$lib/db/logger.js";
import { getAllGuildMetadata } from "$lib/db/guild-metadata.js";
import { getAllServerPlans, PLAN_TIERS } from "$lib/db/server-plans.js";

function checkIsSuperAdmin(userId, platform) {
	if (!userId) return false;
	const adminUserIds = platform?.env?.ADMIN_USER_IDS || process.env.ADMIN_USER_IDS || "";
	return adminUserIds.split(",").map((id) => id.trim()).filter(Boolean).includes(userId);
}

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform }) {
	const userId = cookies.get("discord_user_id");
	if (!checkIsSuperAdmin(userId, platform)) {
		throw redirect(302, "/admin");
	}

	const db = platform?.env?.DB;

	const [allMetadata, allPlans] = await Promise.all([
		db ? getAllGuildMetadata(db) : [],
		db ? getAllServerPlans(db) : [],
	]);

	// Build plan map
	const planMap = new Map(allPlans.map((p) => [p.guild_id, p]));

	// Merge servers with plans
	const servers = allMetadata.map((guild) => ({
		guild_id: guild.guild_id,
		name: guild.name,
		icon: guild.icon,
		owner_id: guild.owner_id,
		approximate_member_count: guild.approximate_member_count,
		premium_tier: guild.premium_tier,
		premium_subscription_count: guild.premium_subscription_count,
		features: guild.features,
		fetched_at: guild.fetched_at,
		plan: planMap.get(guild.guild_id) || null,
	}));

	// Sort by member count descending
	servers.sort((a, b) => (b.approximate_member_count || 0) - (a.approximate_member_count || 0));

	return {
		servers,
		planTiers: PLAN_TIERS,
	};
}
