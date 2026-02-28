import { redirect } from "@sveltejs/kit";
import { log } from "$lib/db/logger.js";
import { getAllGuildMetadata } from "$lib/db/guild-metadata.js";
import { getAllServerPlans, PLAN_TIERS } from "$lib/db/server-plans.js";

function checkIsSuperAdmin(userId, platform) {
	if (!userId) return false;
	const adminUserIds = platform?.env?.ADMIN_USER_IDS || process.env.ADMIN_USER_IDS || "";
	return adminUserIds.split(",").map((id) => id.trim()).filter(Boolean).includes(userId);
}

/**
 * Get per-guild usage counts for commands and automations.
 * Returns a Map of guild_id -> { commands_total, commands_active, automations_total, automations_active }
 */
async function getGuildUsageCounts(db) {
	if (!db) return new Map();

	try {
		const [cmdRows, autoRows] = await Promise.all([
			db.prepare(`
				SELECT guild_id,
				       COUNT(*) as total,
				       SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as active
				FROM commands
				GROUP BY guild_id
			`).all(),
			db.prepare(`
				SELECT guild_id,
				       COUNT(*) as total,
				       SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as active
				FROM automations
				GROUP BY guild_id
			`).all(),
		]);

		const usageMap = new Map();

		for (const row of cmdRows?.results || []) {
			const entry = usageMap.get(row.guild_id) || { commands_total: 0, commands_active: 0, automations_total: 0, automations_active: 0 };
			entry.commands_total = row.total;
			entry.commands_active = row.active;
			usageMap.set(row.guild_id, entry);
		}

		for (const row of autoRows?.results || []) {
			const entry = usageMap.get(row.guild_id) || { commands_total: 0, commands_active: 0, automations_total: 0, automations_active: 0 };
			entry.automations_total = row.total;
			entry.automations_active = row.active;
			usageMap.set(row.guild_id, entry);
		}

		return usageMap;
	} catch (error) {
		log.error("[Superadmin Servers] Failed to get usage counts:", error);
		return new Map();
	}
}

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform }) {
	const userId = cookies.get("discord_user_id");
	if (!checkIsSuperAdmin(userId, platform)) {
		throw redirect(302, "/admin");
	}

	const db = platform?.env?.DB;

	const [allMetadata, allPlans, usageMap] = await Promise.all([
		db ? getAllGuildMetadata(db) : [],
		db ? getAllServerPlans(db) : [],
		db ? getGuildUsageCounts(db) : new Map(),
	]);

	// Build plan map
	const planMap = new Map(allPlans.map((p) => [p.guild_id, p]));

	// Merge servers with plans and usage counts
	const servers = allMetadata.map((guild) => {
		const usage = usageMap.get(guild.guild_id) || { commands_total: 0, commands_active: 0, automations_total: 0, automations_active: 0 };
		return {
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
			usage,
		};
	});

	// Sort by member count descending
	servers.sort((a, b) => (b.approximate_member_count || 0) - (a.approximate_member_count || 0));

	return {
		servers,
		planTiers: PLAN_TIERS,
	};
}
