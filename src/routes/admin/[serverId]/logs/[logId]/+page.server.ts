import { error, redirect } from "@sveltejs/kit";
import {
  EVENT_CATEGORIES,
  EVENT_TYPES,
  getLogById,
  log,
} from "$lib/db/logger.js";
import { getUserGuilds } from "$lib/discord/guilds.js";
import {
  getDiscordCategoryMeta,
  getDiscordEventTypeMeta,
} from "$lib/discord/event-metadata.js";

// Discord permission flags
const ADMINISTRATOR = 0x8;
const MANAGE_GUILD = 0x20;

/**
 * Fetch guild info from bot
 */
async function fetchGuildInfo(guildId, botToken) {
  try {
    const response = await fetch(`https://discord.com/api/guilds/${guildId}`, {
      headers: { Authorization: `Bot ${botToken}` },
    });

    if (!response.ok) return null;
    return await response.json();
  } catch (err) {
    log.error("Error fetching guild info:", err);
    return null;
  }
}

export async function load({ params, cookies, platform, parent }) {
  const { serverId, logId } = params;

  // Validate that serverId is a Discord snowflake (numeric string, 17-20 digits)
  if (!/^\d{17,20}$/.test(serverId)) {
    throw redirect(302, "/admin");
  }

  // Get parent layout data (includes user info, admin guilds, etc.)
  const parentData = await parent();
  const accessToken = cookies.get("discord_access_token");

  // Check if user is logged in
  if (!parentData.isLoggedIn || !parentData.user) {
    throw redirect(302, "/login");
  }

  const user = parentData.user;
  const botToken = (platform as any)?.env?.DISCORD_BOT_TOKEN ||
    process.env.DISCORD_BOT_TOKEN;

  // Check if superadmin (from parent or recalculated)
  const isSuperAdmin = parentData.isSuperAdmin;

  // Check if using dev auth bypass with mock token
  const isDevMockToken = accessToken === "dev_mock_token";

  // For dev mode, use guilds from parent data; otherwise fetch from Discord API (with caching)
  let userGuilds = [];
  if (isDevMockToken && parentData.adminGuilds) {
    userGuilds = parentData.adminGuilds;
  } else {
    userGuilds = await getUserGuilds(accessToken, cookies);
  }

  // Find the requested guild
  const userGuild = userGuilds.find((g) => g.id === serverId);

  // Verify access
  let hasAccess = false;

  if (isSuperAdmin) {
    hasAccess = true;
  } else if (userGuild) {
    const permissions = BigInt(userGuild.permissions);
    hasAccess = userGuild.owner ||
      (permissions & BigInt(ADMINISTRATOR)) !== 0n ||
      (permissions & BigInt(MANAGE_GUILD)) !== 0n;
  }

  if (!hasAccess) {
    throw redirect(302, "/admin");
  }

  // Derive bot presence from parent layout data (already resolved with caching)
  // This avoids a redundant uncached API call that can transiently fail
  const adminGuilds = parentData.adminGuilds || [];
  const layoutGuild = adminGuilds.find((g) => g.id === serverId);
  const botInGuild = layoutGuild?.botIsInServer !== false;

  if (!botInGuild) {
    throw redirect(302, `/admin/${serverId}/logs`);
  }

  // Get richer guild info from bot API if possible, fallback to layout data
  let guildInfo = await fetchGuildInfo(serverId, botToken);
  if (!guildInfo) {
    // Use layout data as fallback instead of treating as "bot not installed"
    guildInfo = layoutGuild
      ? { id: layoutGuild.id, name: layoutGuild.name, icon: layoutGuild.icon }
      : (userGuild ? { id: userGuild.id, name: userGuild.name, icon: userGuild.icon } : { id: serverId, name: "Unknown Server" });
  }

  // Get database
  const db = (platform as any)?.env?.DB;
  if (!db) {
    throw error(500, "Database not available");
  }

  // Parse log ID
  const logIdNum = parseInt(logId);
  if (isNaN(logIdNum)) {
    throw error(400, "Invalid log ID");
  }

  // Fetch the log entry
  const log = await getLogById(db, logIdNum, serverId);

  if (!log) {
    throw error(404, "Log entry not found");
  }

  // Get category and event type info
  const categoryInfo = getDiscordCategoryMeta(log.event_category);
  const eventTypeInfo = getDiscordEventTypeMeta(log.event_type, {
    fallbackCategory: log.event_category,
  });

  return {
    serverId,
    guild: guildInfo,
    botInGuild,
    log,
    categoryInfo,
    eventTypeInfo,
    eventCategories: EVENT_CATEGORIES,
    eventTypes: EVENT_TYPES,
  };
}
