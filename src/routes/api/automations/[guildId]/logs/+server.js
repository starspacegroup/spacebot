/**
 * Automation logs API endpoint
 * GET - Get execution logs for automations
 */

import { json } from "@sveltejs/kit";
import { getAutomationLogs } from "$lib/db/automations.js";
import { log } from "$lib/db/logger.js";
import { verifyGuildAdmin } from "$lib/discord/guilds.js";

/** @type {import('./$types').RequestHandler} */
export async function GET({ params, url, cookies, platform }) {
  const { guildId } = params;
  const accessToken = cookies.get("discord_access_token");

  const auth = await verifyGuildAdmin(guildId, accessToken, cookies);
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
