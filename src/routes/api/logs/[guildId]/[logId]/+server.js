import { json } from "@sveltejs/kit";
import {
  EVENT_CATEGORIES,
  EVENT_TYPES,
  getLogById,
  log,
} from "$lib/db/logger.js";
import { verifyGuildAccess } from "$lib/discord/guilds.js";

// Check if dev auth bypass is enabled
const isDev = process.env.NODE_ENV !== "production";
const devAuthEnabled = isDev && process.env.DEV_AUTH_BYPASS === "true";

/**
 * GET /api/logs/[guildId]/[logId] - Fetch a single log entry
 */
export async function GET({ params, cookies, platform }) {
  const { guildId, logId } = params;

  if (!guildId || !logId) {
    return json({ error: "Guild ID and Log ID required" }, { status: 400 });
  }

  // Get auth info
  const accessToken = cookies.get("discord_access_token");
  const botToken = platform?.env?.DISCORD_BOT_TOKEN ||
    process.env.DISCORD_BOT_TOKEN;
  const adminUserIds = platform?.env?.ADMIN_USER_IDS ||
    process.env.ADMIN_USER_IDS;

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
  const categoryInfo = EVENT_CATEGORIES[log.event_category] || {
    name: log.event_category,
    color: "#888",
    icon: "📌",
  };

  const eventTypeInfo = EVENT_TYPES[log.event_type] || {
    category: log.event_category,
    description: log.event_type,
  };

  return json({
    log,
    categoryInfo,
    eventTypeInfo,
  });
}
