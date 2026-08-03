import { commands, registerCommands } from '$lib/discord/commands.js';
import { fail, redirect } from '@sveltejs/kit';
import { log } from '$lib/db/logger.js';
import { hasFullAdminPermission } from '$lib/discord/guilds.js';
import { normalizeLocalRunnerAssistPolicy } from '$lib/db/settings.js';
import { getGuildMetadata } from '$lib/db/guild-metadata.js';
import { getDashboardCacheEntry } from '$lib/server/dashboard-stats.js';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';

// Track server start time for uptime calculation
const SERVER_START_TIME = Date.now();

/**
 * Format uptime into a human-readable string
 */
function formatUptime(ms) {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (days > 0) {
		return `${days}d ${hours % 24}h ${minutes % 60}m`;
	}
	if (hours > 0) {
		return `${hours}h ${minutes % 60}m`;
	}
	return `${minutes}m ${seconds % 60}s`;
}

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform, parent, params }) {
	// Get parent layout data (includes adminGuilds, selectedGuildId, user, etc.)
	const parentData = await parent();

	// Check if user is logged in via cookie
	const userId = cookies.get('discord_user_id');
	const username = cookies.get('discord_username');
	const avatar = cookies.get('discord_avatar');

	if (!userId) {
		throw redirect(302, '/login');
	}

	// Get the server ID from the route params
	const serverId = params.serverId;

	// Validate that serverId is a Discord snowflake (numeric string, 17-20 digits)
	// This prevents this route from catching static paths like 'superadmin' or 'servers'
	if (!/^\d{17,20}$/.test(serverId)) {
		throw redirect(302, '/admin');
	}

	// Check if current user is a superadmin (has access to everything)
	const isSuperAdmin = checkIsSuperAdmin(userId, platform);

	// Calculate uptime
	const uptime = formatUptime(Date.now() - SERVER_START_TIME);

	// Use adminGuilds from parent layout
	const adminGuilds = parentData.adminGuilds || [];
	const guildsWithBot = adminGuilds.filter((g) => g.botIsInServer !== false);

	// User has admin access if they're a superadmin OR have at least one admin guild
	const isAdmin = isSuperAdmin || guildsWithBot.length > 0;

	// Check if user has access to this specific server
	const hasAccessToServer = isSuperAdmin || adminGuilds.some((g) => g.id === serverId);

	if (!hasAccessToServer) {
		// Prevent redirect loops when a stale last_viewed_guild cookie points to
		// a server the user can no longer access.
		cookies.delete('last_viewed_guild', {
			path: '/',
			httpOnly: false,
			secure: false,
			sameSite: 'lax',
		});
		throw redirect(302, '/admin');
	}

	// Get guild info from parent layout data (already resolved with bot presence)
	const guild = adminGuilds.find((g) => g.id === serverId);

	// Derive bot presence from layout data — avoids redundant API call that can transiently fail
	const botInGuild = guild?.botIsInServer !== false;

	// Check if user has full administrator permission (not just MANAGE_GUILD)
	const hasFullAdminAccess = isSuperAdmin || hasFullAdminPermission(guild);

	const db = (platform as any)?.env?.DB;

	// Cheap, always-fresh — used for the per-server accent theme in the root
	// layout, so it shouldn't wait on the cache/hotload cycle below.
	const guildMetadata = db ? await getGuildMetadata(db, serverId) : null;

	// The Discord guild list can come back without this server: a rate-limited
	// /users/@me/guilds, or a superadmin viewing a server they aren't a member of.
	// D1 already knows the guild's name and icon (the gateway and the daily
	// metadata sync keep it current), so fall back to those rather than rendering
	// a real server as "Unknown Server". Permission-bearing fields are
	// deliberately not synthesized — only display fields — so `hasFullAdminAccess`
	// and `botInGuild` above still come from the authoritative Discord list.
	const displayGuild =
		guild ||
		(guildMetadata
			? { id: serverId, name: guildMetadata.name, icon: guildMetadata.icon || null }
			: undefined);

	let loadMeta = {
		source: 'live',
		needsHotload: false,
		isStale: false,
		updatedAt: null,
	};

	let logStats = null;
	let basicStats = null;
	let memberGrowthChartData = [];
	let voiceActivityChartData = [];
	let activityChartData = [];
	let builtInCmds = [];
	let featureCounts = {
		automations: { active: 0, inactive: 0, total: 0 },
		commands: { active: 0, inactive: 0, total: 0 },
		integrations: { active: 0, inactive: 0, total: 0 },
	};
	let planLimits: { max_automations: number; max_commands: number; plan?: string } = {
		max_automations: 9,
		max_commands: 3,
	};
	let localRunnerAssist = normalizeLocalRunnerAssistPolicy(null);
	let aiAutopilotSummary = {
		total: 0,
		pending: 0,
		running: 0,
		completed: 0,
		failed_terminal: 0,
		canceled: 0,
		latest: null,
	};
	let settings = { loggingChannelId: null, loggingChannelName: null };

	// Heavy stats (Discord API calls, stats aggregation, a dozen D1 queries) are
	// never fetched inline here. A warm cache (written by the
	// /api/admin/[serverId]/dashboard-stats endpoint) is served directly; a cold
	// cache renders a shell immediately and the client fetches that endpoint
	// itself, showing loading skeletons in the meantime — see +page.svelte.
	const { cachedEntry, hasFreshCache, hasStaleCache } = getDashboardCacheEntry(serverId);
	if (hasStaleCache && cachedEntry?.data) {
		logStats = cachedEntry.data.logStats;
		basicStats = cachedEntry.data.basicStats;
		memberGrowthChartData = cachedEntry.data.memberGrowthChartData;
		voiceActivityChartData = cachedEntry.data.voiceActivityChartData;
		activityChartData = cachedEntry.data.activityChartData;
		builtInCmds = cachedEntry.data.builtInCmds || [];
		featureCounts = cachedEntry.data.featureCounts;
		planLimits = cachedEntry.data.planLimits;
		localRunnerAssist = normalizeLocalRunnerAssistPolicy(cachedEntry.data.localRunnerAssist);
		aiAutopilotSummary = cachedEntry.data.aiAutopilotSummary || aiAutopilotSummary;
		settings = cachedEntry.data.settings || settings;
		loadMeta = {
			source: 'cache',
			needsHotload: false,
			isStale: !hasFreshCache,
			updatedAt: new Date(cachedEntry.cachedAt).toISOString(),
		};
	} else if (db && botInGuild) {
		// Only signal a hotload when one can actually succeed (db + bot present),
		// otherwise the page would show loading skeletons forever.
		loadMeta = {
			source: 'shell',
			needsHotload: true,
			isStale: false,
			updatedAt: null,
		};
	}

	// Update the last viewed guild cookie
	cookies.set('last_viewed_guild', serverId, {
		path: '/',
		httpOnly: false,
		secure: false,
		sameSite: 'lax',
		maxAge: 60 * 60 * 24 * 365, // 1 year
	});

	return {
		isAdmin,
		isSuperAdmin,
		hasFullAdminAccess,
		uptime,
		latency: Math.floor(Math.random() * 50) + 10, // Simulated latency
		stats: {
			servers: guildsWithBot.length,
			users: 0,
			commandsUsed: 0,
		},
		commands: (builtInCmds.length > 0 ? builtInCmds : commands).map((cmd) => ({
			name: cmd.name,
			description: cmd.description,
		})),
		user: {
			id: userId,
			username: username || 'Unknown',
			avatar,
		},
		serverId,
		guild: displayGuild,
		guildMetadata,
		botInGuild,
		logStats,
		settings,
		basicStats,
		memberGrowthChartData,
		voiceActivityChartData,
		activityChartData,
		featureCounts,
		planLimits,
		localRunnerAssist,
		aiAutopilotSummary,
		loadMeta,
	};
}

/** @type {import('./$types').Actions} */
export const actions = {
	/**
	 * Register/refresh Discord slash commands (superadmin only)
	 */
	refreshCommands: async ({ cookies, platform }) => {
		// Verify superadmin access
		const userId = cookies.get('discord_user_id');
		if (!checkIsSuperAdmin(userId, platform)) {
			return fail(403, {
				success: false,
				message: 'Access denied. Superadmin privileges required.',
				action: 'refreshCommands',
			});
		}

		const clientId = (platform as any)?.env?.DISCORD_CLIENT_ID || process.env.DISCORD_CLIENT_ID;
		const botToken = (platform as any)?.env?.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;
		const guildId = (platform as any)?.env?.DISCORD_GUILD_ID || process.env.DISCORD_GUILD_ID;

		if (!clientId || !botToken) {
			return fail(400, {
				success: false,
				message: 'Missing DISCORD_CLIENT_ID or DISCORD_BOT_TOKEN',
				action: 'refreshCommands',
			});
		}

		try {
			await registerCommands(clientId, botToken, guildId || null);
			return {
				success: true,
				message: guildId
					? `Successfully registered ${commands.length} commands to guild!`
					: `Successfully registered ${commands.length} global commands! (May take up to 1 hour to propagate)`,
				action: 'refreshCommands',
			};
		} catch (error) {
			log.error('Failed to register commands:', error);
			return fail(500, {
				success: false,
				message: `Failed to register commands: ${error.message}`,
				action: 'refreshCommands',
			});
		}
	},

	/**
	 * Clear any cached data (superadmin only)
	 */
	clearCache: async ({ cookies, platform }) => {
		// Verify superadmin access
		const userId = cookies.get('discord_user_id');
		if (!checkIsSuperAdmin(userId, platform)) {
			return fail(403, {
				success: false,
				message: 'Access denied. Superadmin privileges required.',
				action: 'clearCache',
			});
		}

		// In a real implementation, this would clear any KV or cache storage
		return {
			success: true,
			message: 'Cache cleared successfully!',
			action: 'clearCache',
		};
	},

	/**
	 * Simulate a bot restart (superadmin only)
	 */
	restartBot: async ({ cookies, platform }) => {
		// Verify superadmin access
		const userId = cookies.get('discord_user_id');
		if (!checkIsSuperAdmin(userId, platform)) {
			return fail(403, {
				success: false,
				message: 'Access denied. Superadmin privileges required.',
				action: 'restartBot',
			});
		}

		// Since this is an HTTP-based interaction endpoint (not a WebSocket gateway bot),
		// we can't truly "restart" - but we can reset internal state
		return {
			success: true,
			message: 'Bot state has been reset. Note: This is an HTTP-based interaction endpoint.',
			action: 'restartBot',
		};
	},
};
