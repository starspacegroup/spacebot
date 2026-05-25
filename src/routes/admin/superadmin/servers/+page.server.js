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
 * Get all guilds the bot is currently in from the Discord API.
 */
async function getBotGuilds(botToken) {
	if (!botToken) {
		return { guilds: [], available: false };
	}

	try {
		const response = await fetch("https://discord.com/api/v10/users/@me/guilds?with_counts=true", {
			headers: { Authorization: `Bot ${botToken}` },
		});

		if (!response.ok) {
			log.warn(`[Superadmin Servers] Failed to fetch bot guilds: ${response.status}`);
			return { guilds: [], available: false };
		}

		const guilds = await response.json();
		return { guilds, available: true };
	} catch (error) {
		log.error("[Superadmin Servers] Failed to fetch bot guilds:", error);
		return { guilds: [], available: false };
	}
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
	const botToken = platform?.env?.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;

	const [botGuildsResult, allMetadata, allPlans, usageMap] = await Promise.all([
		getBotGuilds(botToken),
		db ? getAllGuildMetadata(db) : [],
		db ? getAllServerPlans(db) : [],
		db ? getGuildUsageCounts(db) : new Map(),
	]);
	const botGuilds = botGuildsResult.guilds;
	const botPresenceReliable = botGuildsResult.available;

	// Build lookup maps
	const planMap = new Map(allPlans.map((p) => [p.guild_id, p]));
	const metadataMap = new Map(allMetadata.map((m) => [m.guild_id, m]));

	// Start with all guilds the bot is in (from Discord API)
	const seenGuildIds = new Set();
	const servers = [];

	for (const apiGuild of botGuilds) {
		seenGuildIds.add(apiGuild.id);
		const meta = metadataMap.get(apiGuild.id);
		const usage = usageMap.get(apiGuild.id) || { commands_total: 0, commands_active: 0, automations_total: 0, automations_active: 0 };
		servers.push({
			guild_id: apiGuild.id,
			name: meta?.name || apiGuild.name,
			icon: meta?.icon ?? apiGuild.icon,
			owner_id: meta?.owner_id || (apiGuild.owner ? apiGuild.owner_id : null),
			approximate_member_count: meta?.approximate_member_count || apiGuild.approximate_member_count || 0,
			premium_tier: meta?.premium_tier ?? 0,
			premium_subscription_count: meta?.premium_subscription_count ?? 0,
			features: meta?.features || apiGuild.features || [],
			fetched_at: meta?.fetched_at || null,
			plan: planMap.get(apiGuild.id) || null,
			bot_presence: "in",
			usage,
		});
	}

	// Also include any metadata-only guilds not in the API response (e.g. bot was removed)
	for (const guild of allMetadata) {
		if (seenGuildIds.has(guild.guild_id)) continue;
		const usage = usageMap.get(guild.guild_id) || { commands_total: 0, commands_active: 0, automations_total: 0, automations_active: 0 };
		servers.push({
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
			bot_presence: botPresenceReliable ? "not_in" : "unknown",
			usage,
		});
	}

	// Sort by member count descending
	servers.sort((a, b) => (b.approximate_member_count || 0) - (a.approximate_member_count || 0));

	return {
		servers,
		planTiers: PLAN_TIERS,
	};
}
