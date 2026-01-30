/**
 * Automation logs API endpoint
 * GET - Get execution logs for automations
 */

import { json } from "@sveltejs/kit";
import { getAutomationLogs } from "$lib/db/automations.js";
import { log } from "$lib/db/logger.js";

/**
 * Verify user has admin access to the guild
 */
async function verifyGuildAdmin(guildId, accessToken) {
  if (!accessToken || !guildId) {
    return { authorized: false, error: "Unauthorized" };
  }

  try {
    const response = await fetch(
      "https://discord.com/api/v10/users/@me/guilds",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    if (!response.ok) {
      return { authorized: false, error: "Failed to verify permissions" };
    }

    const guilds = await response.json();
    const guild = guilds.find((g) => g.id === guildId);

    if (!guild) {
      return { authorized: false, error: "Guild not found" };
    }

    const permissions = BigInt(guild.permissions);
    const ADMINISTRATOR = BigInt(0x8);
    const MANAGE_GUILD = BigInt(0x20);

    if ((permissions & ADMINISTRATOR) || (permissions & MANAGE_GUILD)) {
      return { authorized: true, guild };
    }

    return { authorized: false, error: "Insufficient permissions" };
  } catch (error) {
    log.error("Guild verification error:", error);
    return { authorized: false, error: "Verification failed" };
  }
}

/** @type {import('./$types').RequestHandler} */
export async function GET({ params, url, cookies, platform }) {
  const { guildId } = params;
  const accessToken = cookies.get("discord_access_token");

  const auth = await verifyGuildAdmin(guildId, accessToken);
  if (!auth.authorized) {
    return json({ error: auth.error }, { status: 403 });
  }

  const db = platform?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 500 });
  }

  const limit = parseInt(url.searchParams.get("limit") || "50");
  const offset = parseInt(url.searchParams.get("offset") || "0");
  const automationId = url.searchParams.get("automationId");
  const success = url.searchParams.get("success");

  const { logs, total } = await getAutomationLogs(db, guildId, {
    limit,
    offset,
    automationId: automationId ? parseInt(automationId) : undefined,
    success: success !== null ? success === "true" : undefined,
  });

  return json({
    logs,
    total,
    pagination: {
      limit,
      offset,
      hasMore: offset + logs.length < total,
    },
  });
}
