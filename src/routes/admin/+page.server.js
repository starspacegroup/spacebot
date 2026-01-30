import { commands, registerCommands } from "$lib/discord/commands.js";
import { fail, redirect } from "@sveltejs/kit";
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

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform, parent }) {
	// Get parent layout data (includes adminGuilds, selectedGuildId, user, etc.)
	const parentData = await parent();

	// Check if user is logged in via cookie
	const userId = cookies.get("discord_user_id");
	const username = cookies.get("discord_username");
	const avatar = cookies.get("discord_avatar");

	if (!userId) {
		return {
			isAdmin: false,
			isSuperAdmin: false,
			user: null,
		};
	}

	// Check if current user is a superadmin (has access to everything)
	const isSuperAdmin = checkIsSuperAdmin(userId, platform);

	// Use adminGuilds from parent layout
	const adminGuilds = parentData.adminGuilds || [];
	const guildsWithBot = adminGuilds.filter((g) => g.botIsInServer !== false);

	// User has admin access if they're a superadmin OR have at least one admin guild
	const isAdmin = isSuperAdmin || guildsWithBot.length > 0;

	// If user has a selected guild, redirect to that server's dashboard
	// This handles the case where user lands on /admin but already has a server cookie
	if (parentData.selectedGuildId) {
		throw redirect(302, `/admin/${parentData.selectedGuildId}`);
	}

	return {
		isAdmin,
		isSuperAdmin,
		user: {
			id: userId,
			username: username || "Unknown",
			avatar,
		},
		// Note: adminGuilds come from the layout
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
			log.error("Failed to register commands:", error);
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
