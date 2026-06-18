/**
 * External API v1 - Logs
 * 
 * GET /api/v1/logs - Get event logs for the authenticated guild
 * 
 * Requires scope: logs:read
 * Auth: Bearer <api_key>
 */

import { json } from "@sveltejs/kit";
import { authenticateApiKey, hasScope } from "$lib/api-auth.js";
import { getLogs, getLogStats } from "$lib/db/logger.js";
import { log } from "$lib/db/logger.js";

/** @type {import('./$types').RequestHandler} */
export async function GET({ request, platform, url }) {
  const auth = await authenticateApiKey(request, platform);
  if (!auth.authenticated) {
    return json({ error: auth.error }, { status: auth.status });
  }

  if (!hasScope(auth, "logs:read")) {
    return json({ error: "Insufficient scope. Required: logs:read" }, { status: 403 });
  }

  const db = (platform as any)?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 500 });
  }

  try {
    // Parse query parameters
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);
    const offset = parseInt(url.searchParams.get("offset") || "0");
    const eventType = url.searchParams.get("event_type") || undefined;
    const search = url.searchParams.get("search") || undefined;

    // Check if stats are requested
    if (url.searchParams.get("stats") === "true") {
      const stats = await getLogStats(db, auth.guildId);
      return json({ guild_id: auth.guildId, stats });
    }

    const result = await getLogs(db, auth.guildId, {
      limit,
      offset,
      eventType,
      search,
    });

    return json({
      guild_id: auth.guildId,
      logs: result.logs || result,
      total: result.total,
      limit,
      offset,
    });
  } catch (error) {
    log.error("[API v1] Error fetching logs:", error);
    return json({ error: "Failed to fetch logs" }, { status: 500 });
  }
}
