import { json } from "@sveltejs/kit";
import {
  EVENT_CATEGORIES,
  EVENT_TYPES,
  getLogs,
  getLogStats,
} from "$lib/db/logger.js";

// Discord permission flags
const ADMINISTRATOR = 0x8;
const MANAGE_GUILD = 0x20;

/**
 * Verify user has admin access to the guild
 */
async function verifyGuildAccess(guildId, accessToken, botToken, adminUserIds) {
  if (!accessToken) return { hasAccess: false };

  try {
    // Fetch user info
    const userResponse = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userResponse.ok) return { hasAccess: false };
    const user = await userResponse.json();

    // Check if superadmin
    const superAdminIds = (adminUserIds || "").split(",").map((id) =>
      id.trim()
    );
    if (superAdminIds.includes(user.id)) {
      return { hasAccess: true, isSuperAdmin: true };
    }

    // Fetch user's guilds
    const guildsResponse = await fetch(
      "https://discord.com/api/users/@me/guilds",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    if (!guildsResponse.ok) return { hasAccess: false };
    const guilds = await guildsResponse.json();

    // Find the requested guild
    const guild = guilds.find((g) => g.id === guildId);
    if (!guild) return { hasAccess: false };

    // Check permissions
    const permissions = BigInt(guild.permissions);
    const hasAdmin = guild.owner ||
      (permissions & BigInt(ADMINISTRATOR)) !== 0n ||
      (permissions & BigInt(MANAGE_GUILD)) !== 0n;

    if (!hasAdmin) return { hasAccess: false };

    // Verify bot is in the guild
    const botGuildsResponse = await fetch(
      "https://discord.com/api/users/@me/guilds",
      {
        headers: { Authorization: `Bot ${botToken}` },
      },
    );

    if (botGuildsResponse.ok) {
      const botGuilds = await botGuildsResponse.json();
      const botInGuild = botGuilds.some((g) => g.id === guildId);
      if (!botInGuild) return { hasAccess: false, reason: "Bot not in guild" };
    }

    return { hasAccess: true };
  } catch (error) {
    console.error("Error verifying guild access:", error);
    return { hasAccess: false };
  }
}

/**
 * GET /api/logs/[guildId] - Fetch logs for a guild
 */
export async function GET({ params, url, cookies, platform }) {
  const { guildId } = params;

  if (!guildId) {
    return json({ error: "Guild ID required" }, { status: 400 });
  }

  // Get auth info
  const accessToken = cookies.get("discord_access_token");
  const botToken = platform?.env?.DISCORD_BOT_TOKEN ||
    process.env.DISCORD_BOT_TOKEN;
  const adminUserIds = platform?.env?.ADMIN_USER_IDS ||
    process.env.ADMIN_USER_IDS;

  // Verify access
  const { hasAccess, reason } = await verifyGuildAccess(
    guildId,
    accessToken,
    botToken,
    adminUserIds,
  );

  if (!hasAccess) {
    return json({ error: reason || "Access denied" }, { status: 403 });
  }

  // Parse query parameters
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);
  const offset = parseInt(url.searchParams.get("offset") || "0");
  const category = url.searchParams.get("category");
  const eventType = url.searchParams.get("eventType");
  const actorId = url.searchParams.get("actorId");
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");
  const search = url.searchParams.get("search");
  const includeStats = url.searchParams.get("stats") === "true";

  const db = platform?.env?.DB;

  console.log(
    "[DEBUG] platform.env keys:",
    platform?.env ? Object.keys(platform.env) : "no platform.env",
  );
  console.log("[DEBUG] db binding:", db ? "exists" : "null");

  // Fetch logs
  const { logs, total } = await getLogs(db, guildId, {
    limit,
    offset,
    category,
    eventType,
    actorId,
    startDate,
    endDate,
    search,
  });

  const response = {
    logs,
    total,
    limit,
    offset,
    hasMore: offset + logs.length < total,
  };

  // Include stats if requested
  if (includeStats) {
    response.stats = await getLogStats(db, guildId);
  }

  // Include category and event type metadata
  response.categories = EVENT_CATEGORIES;
  response.eventTypes = EVENT_TYPES;

  return json(response);
}
