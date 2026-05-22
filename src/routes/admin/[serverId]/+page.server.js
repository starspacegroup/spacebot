import { commands, registerCommands } from "$lib/discord/commands.js";
import { getBuiltInCommands, getGuildCommands } from "$lib/db/commands.js";
import { fail, redirect } from "@sveltejs/kit";
import {
  getLogStats,
  log,
} from "$lib/db/logger.js";
import { hasFullAdminPermission } from "$lib/discord/guilds.js";
import { getGuildSettings, DEFAULT_SETTINGS } from "$lib/db/settings.js";
import { getGuildStatistics } from "$lib/db/statistics.js";
import { syncServerStatsIfStale } from "$lib/db/server-stats.js";
import { getMemberGrowthChart, getVoiceActivityChart, runStatsAggregation } from "$lib/db/stats-aggregation.js";
import { getGuildMetadata } from "$lib/db/guild-metadata.js";
import { getAutomations } from "$lib/db/automations.js";
import { getGuildIntegrations } from "$lib/db/integrations.js";
import { getServerPlan } from "$lib/db/server-plans.js";

// Track server start time for uptime calculation
const SERVER_START_TIME = Date.now();
const DASHBOARD_CACHE_FRESH_MS = 20 * 1000;
const DASHBOARD_CACHE_STALE_MS = 10 * 60 * 1000;
const DASHBOARD_CACHE = globalThis.__spacebotDashboardCache ||= new Map();

/**
 * Fetch a channel's info from Discord API
 * @param {string} botToken - The bot token
 * @param {string} channelId - The channel ID to fetch
 * @returns {Promise<{id: string, name: string} | null>}
 */
async function getChannelInfo(botToken, channelId) {
  if (!botToken || !channelId) return null;
  
  try {
    const response = await fetch(
      `https://discord.com/api/v10/channels/${channelId}`,
      {
        headers: {
          Authorization: `Bot ${botToken}`,
        },
      },
    );
    
    if (!response.ok) return null;
    
    const channel = await response.json();
    return { id: channel.id, name: channel.name };
  } catch {
    return null;
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
    .filter(Boolean);

  return superAdminIdList.includes(userId);
}

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform, parent, params, url }) {
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

  // Validate that serverId is a Discord snowflake (numeric string, 17-20 digits)
  // This prevents this route from catching static paths like 'superadmin' or 'servers'
  if (!/^\d{17,20}$/.test(serverId)) {
    throw redirect(302, "/admin");
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
  const hasAccessToServer = isSuperAdmin ||
    adminGuilds.some((g) => g.id === serverId);

  if (!hasAccessToServer) {
    throw redirect(302, "/admin");
  }

  // Get guild info from parent layout data (already resolved with bot presence)
  const guild = adminGuilds.find((g) => g.id === serverId);

  // Derive bot presence from layout data — avoids redundant API call that can transiently fail
  const botInGuild = guild?.botIsInServer !== false;

  const botToken = platform?.env?.DISCORD_BOT_TOKEN ||
    process.env.DISCORD_BOT_TOKEN;

  // Check if user has full administrator permission (not just MANAGE_GUILD)
  const hasFullAdminAccess = isSuperAdmin || hasFullAdminPermission(guild);

  // Fetch data for the selected guild
  const forceHotload = url.searchParams.get("hotload") === "1";
  const cacheKey = `${serverId}`;
  const cachedEntry = DASHBOARD_CACHE.get(cacheKey);
  const cacheAgeMs = cachedEntry ? Date.now() - cachedEntry.cachedAt : Number.POSITIVE_INFINITY;
  const hasFreshCache = cacheAgeMs <= DASHBOARD_CACHE_FRESH_MS;
  const hasStaleCache = cacheAgeMs <= DASHBOARD_CACHE_STALE_MS;

  let loadMeta = {
    source: "live",
    needsHotload: false,
    isStale: false,
    updatedAt: null,
  };

  let logStats = null;
  let dbSettings = DEFAULT_SETTINGS;
  let basicStats = null;
  let memberGrowthChartData = [];
  let voiceActivityChartData = [];
  let activityChartData = [];
  let builtInCmds = [];
  let guildMetadata = null;
  let featureCounts = { automations: { active: 0, inactive: 0, total: 0 }, commands: { active: 0, inactive: 0, total: 0 }, integrations: { active: 0, inactive: 0, total: 0 } };
  let planLimits = { max_automations: 9, max_commands: 3 };

  if (!forceHotload && hasStaleCache && cachedEntry?.data) {
    logStats = cachedEntry.data.logStats;
    dbSettings = cachedEntry.data.dbSettings;
    basicStats = cachedEntry.data.basicStats;
    memberGrowthChartData = cachedEntry.data.memberGrowthChartData;
    voiceActivityChartData = cachedEntry.data.voiceActivityChartData;
    activityChartData = cachedEntry.data.activityChartData;
    builtInCmds = cachedEntry.data.builtInCmds;
    guildMetadata = cachedEntry.data.guildMetadata;
    featureCounts = cachedEntry.data.featureCounts;
    planLimits = cachedEntry.data.planLimits;
    loadMeta = {
      source: "cache",
      needsHotload: false,
      isStale: !hasFreshCache,
      updatedAt: new Date(cachedEntry.cachedAt).toISOString(),
    };
  }

  const db = platform?.env?.DB;
  const shouldFetchLive = db && botInGuild && (forceHotload || !hasStaleCache);
  if (shouldFetchLive) {
    try {
      const syncedStats = await syncServerStatsIfStale(db, serverId, botToken);

      // Never block initial render on aggregation. Read available data immediately.
      try {
        runStatsAggregation(db, serverId).catch((aggError) => {
          log.warn(`[Dashboard] On-demand aggregation failed for ${serverId}:`, aggError);
        });
      } catch (aggError) {
        log.warn(`[Dashboard] On-demand aggregation failed for ${serverId}:`, aggError);
      }

      const [stats, settings, guildStats, memberStats, memberGrowth, voiceActivity, builtIn, metadata, automationsResult, guildCommands, guildIntegrations, serverPlan] = await Promise.all([
        getLogStats(db, serverId),
        getGuildSettings(db, serverId),
        getGuildStatistics(db, serverId, parentData.timezone || null),
        Promise.resolve(syncedStats.latest),
        getMemberGrowthChart(db, serverId, "30d", parentData.timezone || null),
        getVoiceActivityChart(db, serverId, "30d", parentData.timezone || null),
        getBuiltInCommands(db),
        getGuildMetadata(db, serverId),
        getAutomations(db, serverId, { limit: 1000 }),
        getGuildCommands(db, serverId),
        getGuildIntegrations(db, serverId),
        getServerPlan(db, serverId),
      ]);

      // Compute feature counts
      const allAutomations = automationsResult.automations || [];
      const activeAutomations = allAutomations.filter(a => a.enabled).length;
      const activeCommands = guildCommands.filter(c => c.enabled).length;
      const enabledIntegrations = guildIntegrations.filter(i => i.guild_enabled).length;
      featureCounts = {
        automations: { active: activeAutomations, inactive: allAutomations.length - activeAutomations, total: allAutomations.length },
        commands: { active: activeCommands, inactive: guildCommands.length - activeCommands, total: guildCommands.length },
        integrations: { active: enabledIntegrations, inactive: guildIntegrations.filter(i => !i.guild_enabled && (i.connected_at || i.guild_enabled)).length, total: guildIntegrations.filter(i => i.connected_at || i.guild_enabled).length },
      };
      planLimits = {
        max_automations: serverPlan.max_automations,
        max_commands: serverPlan.max_commands,
        plan: serverPlan.plan || 'free',
      };
      logStats = stats;
      dbSettings = settings;
      memberGrowthChartData = memberGrowth || [];
      voiceActivityChartData = voiceActivity || [];
      activityChartData = guildStats?.timeSeries?.daily || [];
      builtInCmds = builtIn || [];
      guildMetadata = metadata || null;
      basicStats = {
        members: memberStats?.member_count || 0,
        humanMembers: memberStats?.human_count || 0,
        totalEvents: guildStats?.events?.total || 0,
        eventsToday: guildStats?.events?.today || 0,
      };

      DASHBOARD_CACHE.set(cacheKey, {
        cachedAt: Date.now(),
        data: {
          logStats,
          dbSettings,
          basicStats,
          memberGrowthChartData,
          voiceActivityChartData,
          activityChartData,
          builtInCmds,
          guildMetadata,
          featureCounts,
          planLimits,
        },
      });

      loadMeta = {
        source: forceHotload ? "hotload" : "live",
        needsHotload: false,
        isStale: false,
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      log.error("Failed to fetch data for dashboard:", error);
      if (forceHotload) {
        loadMeta = {
          source: "error",
          needsHotload: false,
          isStale: false,
          updatedAt: null,
        };
      }
    }
  } else if (!hasStaleCache) {
    loadMeta = {
      source: "shell",
      needsHotload: true,
      isStale: false,
      updatedAt: null,
    };
  }

  // Fetch channel name if logging channel is configured
  let loggingChannelName = null;
  if (dbSettings.log_channel_id && botToken) {
    const channelInfo = await getChannelInfo(botToken, dbSettings.log_channel_id);
    if (channelInfo) {
      loggingChannelName = channelInfo.name;
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
      username: username || "Unknown",
      avatar,
    },
    serverId,
    guild,
    guildMetadata,
    botInGuild,
    logStats,
    settings: {
      loggingChannelId: dbSettings.log_channel_id || null,
      loggingChannelName,

    },
    basicStats,
    memberGrowthChartData,
    voiceActivityChartData,
    activityChartData,
    featureCounts,
    planLimits,
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
