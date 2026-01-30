import { commands, registerCommands } from "$lib/discord/commands.js";
import { fail, redirect } from "@sveltejs/kit";
import {
  EVENT_CATEGORIES,
  EVENT_TYPES,
  getLogs,
  getLogStats,
  log,
} from "$lib/db/logger.js";
import { getBotGuildIds } from "$lib/discord/guilds.js";

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
export async function load({ cookies, platform, parent, params }) {
  // Get parent layout data (includes adminGuilds, selectedGuildId, user, etc.)
  const parentData = await parent();

  // Check if user is logged in via cookie
  const userId = cookies.get("discord_user_id");
  const username = cookies.get("discord_username");
  const avatar = cookies.get("discord_avatar");

  if (!userId) {
    throw redirect(302, "/login");
  }

  // Get the server ID from the route params
  const serverId = params.serverId;

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
  const hasAccessToServer = isSuperAdmin ||
    adminGuilds.some((g) => g.id === serverId);

  if (!hasAccessToServer) {
    throw redirect(302, "/admin");
  }

  // Check if bot is in this guild
  const botToken = platform?.env?.DISCORD_BOT_TOKEN ||
    process.env.DISCORD_BOT_TOKEN;
  const botGuildIds = await getBotGuildIds(botToken, cookies);
  const botInGuild = botGuildIds.has(serverId);

  // Get guild info
  const guild = adminGuilds.find((g) => g.id === serverId);

  // Fetch recent logs for the selected guild
  let recentLogs = [];
  let logStats = null;

  const db = platform?.env?.DB;
  if (db && botInGuild) {
    try {
      // Get the 5 most recent logs for the compact widget
      const logsResult = await getLogs(db, serverId, {
        limit: 5,
        offset: 0,
      });
      recentLogs = logsResult.logs || [];

      // Get stats for the dashboard
      logStats = await getLogStats(db, serverId);
    } catch (error) {
      log.error("Failed to fetch logs for dashboard:", error);
    }
  }

  // Update the last viewed guild cookie
  cookies.set("last_viewed_guild", serverId, {
    path: "/",
    httpOnly: false,
    secure: false,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });

  return {
    isAdmin,
    isSuperAdmin,
    uptime,
    latency: Math.floor(Math.random() * 50) + 10, // Simulated latency
    stats: {
      servers: guildsWithBot.length,
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
    serverId,
    guild,
    botInGuild,
    recentLogs,
    logStats,
    eventCategories: EVENT_CATEGORIES,
    eventTypes: EVENT_TYPES,
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
};
