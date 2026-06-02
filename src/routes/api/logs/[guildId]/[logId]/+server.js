import { json } from "@sveltejs/kit";
import { dev } from "$app/environment";
import {
  EVENT_CATEGORIES,
  EVENT_TYPES,
  getLogById,
  log,
} from "$lib/db/logger.js";
import { verifyGuildAccess } from "$lib/discord/guilds.js";
import {
  getDiscordCategoryMeta,
  getDiscordEventTypeMeta,
} from "$lib/discord/event-metadata.js";

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
 * GET /api/logs/[guildId]/[logId] - Fetch a single log entry
 */
export async function GET({ params, cookies, platform }) {
  const { guildId, logId } = params;

  const devAuthEnabled = dev && getEnv('DEV_AUTH_BYPASS', platform) === 'true';

  if (!guildId || !logId) {
    return json({ error: "Guild ID and Log ID required" }, { status: 400 });
  }

  // Get auth info
  const accessToken = cookies.get("discord_access_token");
  const botToken = getEnv('DISCORD_BOT_TOKEN', platform);
  const adminUserIds = getEnv('ADMIN_USER_IDS', platform);

  // Check for dev auth bypass
  const isDevMockToken = accessToken === "dev_mock_token" && devAuthEnabled;

  if (!isDevMockToken) {
    // Verify access (with caching)
    const { hasAccess } = await verifyGuildAccess(
      guildId,
      accessToken,
      botToken,
      adminUserIds,
      cookies,
    );

    if (!hasAccess) {
      return json({ error: "Unauthorized" }, { status: 403 });
    }
  }

  // Get database
  const db = platform?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 500 });
  }

  // Parse log ID
  const logIdNum = parseInt(logId);
  if (isNaN(logIdNum)) {
    return json({ error: "Invalid log ID" }, { status: 400 });
  }

  // Fetch the log entry
  const log = await getLogById(db, logIdNum, guildId);

  if (!log) {
    return json({ error: "Log entry not found" }, { status: 404 });
  }

  // Include metadata for the UI
  const categoryInfo = getDiscordCategoryMeta(log.event_category);
  const eventTypeInfo = getDiscordEventTypeMeta(log.event_type, {
    fallbackCategory: log.event_category,
  });

  return json({
    log,
    categoryInfo,
    eventTypeInfo,
  });
}
