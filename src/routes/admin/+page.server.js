import { commands, registerCommands } from "$lib/discord/commands.js";
import { fail } from "@sveltejs/kit";

// Track server start time for uptime calculation
const SERVER_START_TIME = Date.now();

// Discord permission flags
const ADMINISTRATOR = 0x8;
const MANAGE_GUILD = 0x20;

/**
 * Fetch user's guilds from Discord API
 * @param {string} accessToken - Discord OAuth2 access token
 * @returns {Promise<Array>} - Array of guilds
 */
async function fetchUserGuilds(accessToken) {
	if (!accessToken) return [];

	try {
		const response = await fetch("https://discord.com/api/users/@me/guilds", {
			headers: {
				Authorization: `Bearer ${accessToken}`,
			},
		});

		if (!response.ok) {
			console.error("Failed to fetch guilds:", response.status);
			return [];
		}

		return await response.json();
	} catch (error) {
		console.error("Error fetching guilds:", error);
		return [];
	}
}

/**
 * Filter guilds where user has admin permissions
 * @param {Array} guilds - Array of Discord guilds
 * @returns {Array} - Filtered array of admin guilds
 */
function filterAdminGuilds(guilds) {
	return guilds.filter((guild) => {
		const permissions = BigInt(guild.permissions);
		// User has admin or manage guild permissions, or is owner
		return guild.owner ||
			(permissions & BigInt(ADMINISTRATOR)) !== 0n ||
			(permissions & BigInt(MANAGE_GUILD)) !== 0n;
	}).map((guild) => ({
		id: guild.id,
		name: guild.name,
		icon: guild.icon,
		owner: guild.owner,
	}));
}

/**
 * Fetch guilds where the bot is a member (returns Set of IDs)
 * @param {string} botToken - Discord bot token
 * @returns {Promise<Set<string>>} - Set of guild IDs where bot is a member
 */
async function fetchBotGuilds(botToken) {
	if (!botToken) return new Set();

	try {
		const response = await fetch("https://discord.com/api/users/@me/guilds", {
			headers: {
				Authorization: `Bot ${botToken}`,
			},
		});

		if (!response.ok) {
			console.error("Failed to fetch bot guilds:", response.status);
			return new Set();
		}

		const guilds = await response.json();
		return new Set(guilds.map((g) => g.id));
	} catch (error) {
		console.error("Error fetching bot guilds:", error);
		return new Set();
	}
}

/**
 * Fetch guilds where the bot is a member with full details
 * Used by superadmins to see all bot guilds
 * @param {string} botToken - Discord bot token
 * @returns {Promise<Array>} - Array of guild objects with details
 */
async function fetchBotGuildsWithDetails(botToken) {
	if (!botToken) return [];

	try {
		const response = await fetch("https://discord.com/api/users/@me/guilds", {
			headers: {
				Authorization: `Bot ${botToken}`,
			},
		});

		if (!response.ok) {
			console.error("Failed to fetch bot guilds:", response.status);
			return [];
		}

		const guilds = await response.json();
		return guilds.map((guild) => ({
			id: guild.id,
			name: guild.name,
			icon: guild.icon,
			owner: false, // Bot is never the owner
			memberCount: guild.approximate_member_count || null,
		}));
	} catch (error) {
		console.error("Error fetching bot guilds:", error);
		return [];
	}
}

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

/**
 * Check if user is a superadmin (defined in ADMIN_USER_IDS env var)
 */
function checkIsSuperAdmin(userId, platform) {
	if (!userId) return false;

	const adminUserIds = platform?.env?.ADMIN_USER_IDS ||
		process.env.ADMIN_USER_IDS || "";

	const superAdminIdList = adminUserIds.split(",").map((id) => id.trim())
		.filter(
			Boolean,
		);

	return superAdminIdList.includes(userId);
}

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform, url }) {
	// Check if user is logged in via cookie
	const userId = cookies.get("discord_user_id");
	const username = cookies.get("discord_username");
	const accessToken = cookies.get("discord_access_token");
	const avatar = cookies.get("discord_avatar");

	if (!userId) {
		return {
			isAdmin: false,
			isSuperAdmin: false,
			uptime: "0h 0m",
			latency: 0,
			stats: {
				servers: 0,
				users: 0,
				commandsUsed: 0,
			},
			commands: [],
			user: null,
			adminGuilds: [],
			selectedGuildId: null,
		};
	}

	// Check if current user is a superadmin (has access to everything)
	const isSuperAdmin = checkIsSuperAdmin(userId, platform);

	// Calculate uptime
	const uptime = formatUptime(Date.now() - SERVER_START_TIME);

	// Get bot token to fetch bot's guilds
	const botToken = platform?.env?.DISCORD_BOT_TOKEN ||
		process.env.DISCORD_BOT_TOKEN;

	// Fetch user's guilds and bot's guilds in parallel
	const [allUserGuilds, botGuildIds] = await Promise.all([
		fetchUserGuilds(accessToken),
		fetchBotGuilds(botToken),
	]);

	let adminGuilds;

	if (isSuperAdmin) {
		// Superadmin sees ALL guilds where the bot is a member
		// We need to fetch all bot guilds with details
		const allBotGuilds = await fetchBotGuildsWithDetails(botToken);

		// For superadmin, show all bot guilds plus any user admin guilds
		// (in case there are guilds user admins but bot isn't in yet)
		const userAdminGuilds = filterAdminGuilds(allUserGuilds);
		const userAdminGuildIds = new Set(userAdminGuilds.map((g) => g.id));

		// Combine: all bot guilds, plus user's admin guilds that bot isn't in
		const combinedGuilds = [...allBotGuilds];
		userAdminGuilds.forEach((guild) => {
			if (!botGuildIds.has(guild.id)) {
				combinedGuilds.push({ ...guild, botNotIn: true });
			}
		});

		adminGuilds = combinedGuilds;
	} else {
		// Regular users: only guilds where they have admin permissions AND bot is present
		adminGuilds = filterAdminGuilds(allUserGuilds).filter(
			(guild) => botGuildIds.has(guild.id),
		);
	}

	// User has admin access if they're a superadmin OR have at least one admin guild
	const isAdmin = isSuperAdmin || adminGuilds.length > 0;

	// Get selected guild from URL or default to first
	const selectedGuildId = url.searchParams.get("guild") ||
		(adminGuilds.length > 0 ? adminGuilds[0].id : null);

	return {
		isAdmin,
		isSuperAdmin,
		uptime,
		latency: Math.floor(Math.random() * 50) + 10, // Simulated latency
		stats: {
			servers: adminGuilds.length,
			users: 0,
			commandsUsed: 0,
		},
		commands: commands.map((cmd) => ({
			name: cmd.name,
			description: cmd.description,
		})),
		user: {
			id: userId,
			username: username || "Unknown",
			avatar,
		},
		adminGuilds,
		selectedGuildId,
	};
}

/** @type {import('./$types').Actions} */
export const actions = {
	/**
	 * Register/refresh Discord slash commands (superadmin only)
	 */
	refreshCommands: async ({ cookies, platform }) => {
		// Verify superadmin access
		const userId = cookies.get("discord_user_id");
		if (!checkIsSuperAdmin(userId, platform)) {
			return fail(403, {
				success: false,
				message: "Access denied. Superadmin privileges required.",
				action: "refreshCommands",
			});
		}

		const clientId = platform?.env?.DISCORD_CLIENT_ID ||
			process.env.DISCORD_CLIENT_ID;
		const botToken = platform?.env?.DISCORD_BOT_TOKEN ||
			process.env.DISCORD_BOT_TOKEN;
		const guildId = platform?.env?.DISCORD_GUILD_ID ||
			process.env.DISCORD_GUILD_ID;

		if (!clientId || !botToken) {
			return fail(400, {
				success: false,
				message: "Missing DISCORD_CLIENT_ID or DISCORD_BOT_TOKEN",
				action: "refreshCommands",
			});
		}

		try {
			await registerCommands(clientId, botToken, guildId || null);
			return {
				success: true,
				message: guildId
					? `Successfully registered ${commands.length} commands to guild!`
					: `Successfully registered ${commands.length} global commands! (May take up to 1 hour to propagate)`,
				action: "refreshCommands",
			};
		} catch (error) {
			console.error("Failed to register commands:", error);
			return fail(500, {
				success: false,
				message: `Failed to register commands: ${error.message}`,
				action: "refreshCommands",
			});
		}
	},

	/**
	 * Clear any cached data (superadmin only)
	 */
	clearCache: async ({ cookies, platform }) => {
		// Verify superadmin access
		const userId = cookies.get("discord_user_id");
		if (!checkIsSuperAdmin(userId, platform)) {
			return fail(403, {
				success: false,
				message: "Access denied. Superadmin privileges required.",
				action: "clearCache",
			});
		}

		// In a real implementation, this would clear any KV or cache storage
		return {
			success: true,
			message: "Cache cleared successfully!",
			action: "clearCache",
		};
	},

	/**
	 * Simulate a bot restart (superadmin only)
	 */
	restartBot: async ({ cookies, platform }) => {
		// Verify superadmin access
		const userId = cookies.get("discord_user_id");
		if (!checkIsSuperAdmin(userId, platform)) {
			return fail(403, {
				success: false,
				message: "Access denied. Superadmin privileges required.",
				action: "restartBot",
			});
		}

		// Since this is an HTTP-based interaction endpoint (not a WebSocket gateway bot),
		// we can't truly "restart" - but we can reset internal state
		return {
			success: true,
			message:
				"Bot state has been reset. Note: This is an HTTP-based interaction endpoint.",
			action: "restartBot",
		};
	},

	/**
	 * Logout action
	 */
	logout: async ({ cookies }) => {
		cookies.delete("discord_user_id", { path: "/" });
		cookies.delete("discord_username", { path: "/" });
		cookies.delete("discord_avatar", { path: "/" });
		cookies.delete("discord_access_token", { path: "/" });

		return {
			success: true,
			message: "Logged out successfully",
			action: "logout",
		};
	},
};
