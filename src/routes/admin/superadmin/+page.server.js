/**
 * Superadmin Dashboard
 * 
 * Provides global bot statistics and management for superadmins only.
 */

import { redirect } from "@sveltejs/kit";
import { log } from "$lib/db/logger.js";

/**
 * Check if user is a superadmin (defined in ADMIN_USER_IDS env var)
 */
function checkIsSuperAdmin(userId, platform) {
	if (!userId) return false;

	const adminUserIds = platform?.env?.ADMIN_USER_IDS ||
		process.env.ADMIN_USER_IDS || "";

	const superAdminIdList = adminUserIds.split(",").map((id) => id.trim())
		.filter(Boolean);

	return superAdminIdList.includes(userId);
}

/**
 * Get all guilds the bot is in with details
 */
async function getBotGuildsWithDetails(botToken) {
	if (!botToken) return [];

	try {
		const response = await fetch("https://discord.com/api/v10/users/@me/guilds", {
			headers: {
				Authorization: `Bot ${botToken}`,
			},
		});

		if (!response.ok) {
			log.warn(`[Superadmin] Failed to fetch bot guilds: ${response.status}`);
			return [];
		}

		return await response.json();
	} catch (error) {
		log.error("[Superadmin] Failed to fetch bot guilds:", error);
		return [];
	}
}

/**
 * Get bot application info
 */
async function getBotApplicationInfo(botToken) {
	if (!botToken) return null;

	try {
		const response = await fetch("https://discord.com/api/v10/oauth2/applications/@me", {
			headers: {
				Authorization: `Bot ${botToken}`,
			},
		});

		if (!response.ok) {
			log.warn(`[Superadmin] Failed to fetch bot app info: ${response.status}`);
			return null;
		}

		return await response.json();
	} catch (error) {
		log.error("[Superadmin] Failed to fetch bot app info:", error);
		return null;
	}
}

/**
 * Get global statistics from the database
 */
async function getGlobalStats(db) {
	if (!db) return null;

	try {
		const [
			totalAutomations,
			activeAutomations,
			totalCommands,
			totalEventLogs,
			totalWebhooks,
			recentActivityByGuild,
		] = await Promise.all([
			// Total automations across all guilds
			db.prepare(`SELECT COUNT(*) as count FROM automations`).first(),
			// Active automations
			db.prepare(`SELECT COUNT(*) as count FROM automations WHERE enabled = 1`).first(),
			// Total custom commands
			db.prepare(`SELECT COUNT(*) as count FROM commands`).first(),
			// Total event logs (last 30 days)
			db.prepare(`
				SELECT COUNT(*) as count FROM event_logs 
				WHERE created_at >= datetime('now', '-30 days')
			`).first(),
			// Total webhooks
			db.prepare(`SELECT COUNT(*) as count FROM webhooks`).first(),
			// Activity by guild (last 7 days)
			db.prepare(`
				SELECT guild_id, COUNT(*) as event_count
				FROM event_logs
				WHERE created_at >= datetime('now', '-7 days')
				GROUP BY guild_id
				ORDER BY event_count DESC
				LIMIT 10
			`).all(),
		]);

		return {
			totalAutomations: totalAutomations?.count || 0,
			activeAutomations: activeAutomations?.count || 0,
			totalCommands: totalCommands?.count || 0,
			totalEventLogs: totalEventLogs?.count || 0,
			totalWebhooks: totalWebhooks?.count || 0,
			recentActivityByGuild: recentActivityByGuild?.results || [],
		};
	} catch (error) {
		log.error("[Superadmin] Failed to fetch global stats:", error);
		return null;
	}
}

/**
 * Get server stats summary from the database
 */
async function getServerStatsSummary(db) {
	if (!db) return null;

	try {
		// Get the latest stats for each guild
		const result = await db.prepare(`
			SELECT 
				s1.guild_id,
				s1.member_count,
				s1.channel_count,
				s1.role_count,
				s1.boost_level,
				s1.recorded_at
			FROM server_stats s1
			INNER JOIN (
				SELECT guild_id, MAX(recorded_at) as max_recorded
				FROM server_stats
				GROUP BY guild_id
			) s2 ON s1.guild_id = s2.guild_id AND s1.recorded_at = s2.max_recorded
		`).all();

		return result?.results || [];
	} catch (error) {
		log.error("[Superadmin] Failed to fetch server stats summary:", error);
		return [];
	}
}

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform }) {
	const userId = cookies.get("discord_user_id");

	// Verify superadmin access
	if (!checkIsSuperAdmin(userId, platform)) {
		throw redirect(302, "/admin");
	}

	const botToken = platform?.env?.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;
	const db = platform?.env?.DB;

	// Fetch all data in parallel
	const [botGuilds, botAppInfo, globalStats, serverStatsSummary] = await Promise.all([
		getBotGuildsWithDetails(botToken),
		getBotApplicationInfo(botToken),
		getGlobalStats(db),
		getServerStatsSummary(db),
	]);

	// Merge server stats with guild info
	const statsMap = new Map(serverStatsSummary.map(s => [s.guild_id, s]));
	const guildsWithStats = botGuilds.map(guild => ({
		...guild,
		stats: statsMap.get(guild.id) || null,
	}));

	// Sort by member count (descending) if we have stats
	guildsWithStats.sort((a, b) => {
		const aCount = a.stats?.member_count || a.approximate_member_count || 0;
		const bCount = b.stats?.member_count || b.approximate_member_count || 0;
		return bCount - aCount;
	});

	// Calculate totals
	const totalMembers = guildsWithStats.reduce((sum, g) => 
		sum + (g.stats?.member_count || g.approximate_member_count || 0), 0);
	const totalChannels = guildsWithStats.reduce((sum, g) => 
		sum + (g.stats?.channel_count || 0), 0);

	return {
		isSuperAdmin: true,
		botApp: botAppInfo ? {
			id: botAppInfo.id,
			name: botAppInfo.name,
			icon: botAppInfo.icon,
			description: botAppInfo.description,
			isPublic: botAppInfo.bot_public,
			approximateGuildCount: botAppInfo.approximate_guild_count,
		} : null,
		guilds: guildsWithStats,
		summary: {
			totalGuilds: botGuilds.length,
			totalMembers,
			totalChannels,
		},
		globalStats: globalStats || {
			totalAutomations: 0,
			activeAutomations: 0,
			totalCommands: 0,
			totalEventLogs: 0,
			totalWebhooks: 0,
			recentActivityByGuild: [],
		},
		user: {
			id: userId,
			username: cookies.get("discord_username") || "Superadmin",
			avatar: cookies.get("discord_avatar") || null,
		},
	};
}
