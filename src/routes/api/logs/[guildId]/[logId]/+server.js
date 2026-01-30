import { json } from "@sveltejs/kit";
import { EVENT_CATEGORIES, EVENT_TYPES, getLogById } from "$lib/db/logger.js";

// Check if dev auth bypass is enabled
const isDev = process.env.NODE_ENV !== "production";
const devAuthEnabled = isDev && process.env.DEV_AUTH_BYPASS === "true";

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

    return { hasAccess: hasAdmin };
  } catch (error) {
    console.error("Error verifying guild access:", error);
    return { hasAccess: false };
  }
}

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
    // Verify access
    const { hasAccess } = await verifyGuildAccess(
      guildId,
      accessToken,
      botToken,
      adminUserIds,
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
