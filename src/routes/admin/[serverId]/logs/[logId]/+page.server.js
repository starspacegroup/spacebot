import { error, redirect } from "@sveltejs/kit";
import {
  EVENT_CATEGORIES,
  EVENT_TYPES,
  getLogById,
  log,
} from "$lib/db/logger.js";
import { getUserGuilds } from "$lib/discord/guilds.js";

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

  // Get parent layout data (includes user info, admin guilds, etc.)
  const parentData = await parent();
  const accessToken = cookies.get("discord_access_token");

  // Check if user is logged in
  if (!parentData.isLoggedIn || !parentData.user) {
    throw redirect(302, "/login");
  }

  const user = parentData.user;
  const botToken = platform?.env?.DISCORD_BOT_TOKEN ||
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

  // Fetch guild info from bot to verify bot is in guild
  const guildInfo = await fetchGuildInfo(serverId, botToken);
  const botInGuild = !!guildInfo;

  if (!botInGuild) {
    throw redirect(302, `/admin/${serverId}/logs`);
  }

  // Get database
  const db = platform?.env?.DB;
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
  const categoryInfo = EVENT_CATEGORIES[log.event_category] || {
    name: log.event_category,
    color: "#888",
    icon: "📌",
  };

  const eventTypeInfo = EVENT_TYPES[log.event_type] || {
    category: log.event_category,
    description: log.event_type,
  };

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
