import { json } from "@sveltejs/kit";
import {
  EVENT_CATEGORIES,
  EVENT_TYPES,
  getLogs,
  getLogStats,
  log,
} from "$lib/db/logger.js";
import { verifyGuildAccess } from "$lib/discord/guilds.js";

// Check if dev auth bypass is enabled
const isDev = process.env.NODE_ENV !== "production";
const devAuthEnabled = isDev && process.env.DEV_AUTH_BYPASS === "true";

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

  // Check for dev auth bypass
  const isDevMockToken = accessToken === "dev_mock_token";
  const devGuildId = platform?.env?.DISCORD_GUILD_ID ||
    process.env.DISCORD_GUILD_ID;

  let hasAccess = false;
  let reason = null;

  if (devAuthEnabled && isDevMockToken) {
    // In dev mode with bypass, grant access if it's the dev guild or user is admin
    hasAccess = guildId === devGuildId || !!adminUserIds;
    log.debug("[DEV] Bypassing guild access check, hasAccess:", hasAccess);
  } else {
    // Verify access via Discord API (with caching)
    const accessResult = await verifyGuildAccess(
      guildId,
      accessToken,
      botToken,
      adminUserIds,
      cookies,
    );
    hasAccess = accessResult.hasAccess;
    reason = accessResult.reason;
  }

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
  const sortOrder = url.searchParams.get("sortOrder") || "desc";

  const db = platform?.env?.DB;

  log.debug(
    "[DEBUG] platform.env keys:",
    platform?.env ? Object.keys(platform.env) : "no platform.env",
  );
  log.debug("[DEBUG] db binding:", db ? "exists" : "null");

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
    sortOrder,
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
