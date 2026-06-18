import { json } from "@sveltejs/kit";
import { dev } from "$app/environment";
import {
  EVENT_CATEGORIES,
  EVENT_TYPES,
  getLogs,
  getLogStats,
  log,
} from "$lib/db/logger.js";
import { verifyGuildAccess } from "$lib/discord/guilds.js";

/**
 * Safely get environment variable, works in both Node.js and Cloudflare Workers
 * @param {string} name - Environment variable name
 * @param {import('@sveltejs/kit').RequestEvent['platform']} platform - SvelteKit platform object
 * @returns {string|undefined}
 */
function getEnv(name, platform) {
  return platform?.env?.[name] ?? (typeof process !== 'undefined' ? process.env?.[name] : undefined);
}

/**
 * GET /api/logs/[guildId] - Fetch logs for a guild
 */
export async function GET({ params, url, cookies, platform }) {
  const { guildId } = params;

  const devAuthEnabled = dev && getEnv('DEV_AUTH_BYPASS', platform) === 'true';

  if (!guildId) {
    return json({ error: "Guild ID required" }, { status: 400 });
  }

  // Get auth info
  const accessToken = cookies.get("discord_access_token");
  const botToken = getEnv('DISCORD_BOT_TOKEN', platform);
  const adminUserIds = getEnv('ADMIN_USER_IDS', platform);

  // Check for dev auth bypass
  const isDevMockToken = accessToken === "dev_mock_token";
  const devGuildId = getEnv('DISCORD_GUILD_ID', platform);

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

  const db = (platform as any)?.env?.DB;

  log.debug(
    "[DEBUG] platform.env keys:",
    (platform as any)?.env ? Object.keys((platform as any).env) : "no platform.env",
  );
  log.debug("[DEBUG] db binding:", db ? "exists" : "null");

  if (!db) {
    log.error("[Logs API] Database binding not available");
    return json({ 
      error: "Database not available", 
      logs: [], 
      total: 0, 
      categories: EVENT_CATEGORIES, 
      eventTypes: EVENT_TYPES 
    }, { status: 503 });
  }

  try {
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

    const response: Record<string, any> = {
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
  } catch (error) {
    log.error("[Logs API] Error fetching logs:", error);
    return json({ 
      error: "Failed to fetch logs", 
      logs: [], 
      total: 0, 
      categories: EVENT_CATEGORIES, 
      eventTypes: EVENT_TYPES 
    }, { status: 500 });
  }
}
