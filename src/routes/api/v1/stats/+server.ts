/**
 * External API v1 - Statistics
 * 
 * GET /api/v1/stats - Get server statistics for the authenticated guild
 * 
 * Requires scope: stats:read
 * Auth: Bearer <api_key>
 */

import { json } from "@sveltejs/kit";
import { authenticateApiKey, hasScope } from "$lib/api-auth.js";
import { log } from "$lib/db/logger.js";

/** @type {import('./$types').RequestHandler} */
export async function GET({ request, platform, url }) {
  const auth = await authenticateApiKey(request, platform);
  if (!auth.authenticated) {
    return json({ error: auth.error }, { status: auth.status });
  }

  if (!hasScope(auth, "stats:read")) {
    return json({ error: "Insufficient scope. Required: stats:read" }, { status: 403 });
  }

  const db = (platform as any)?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 500 });
  }

  try {
    const days = Math.min(parseInt(url.searchParams.get("days") || "30"), 90);
    
    // Get aggregated stats
    const statsResult = await db
      .prepare(
        `SELECT * FROM aggregated_stats 
         WHERE guild_id = ? AND period_type = 'daily'
         ORDER BY period_start DESC LIMIT ?`
      )
      .bind(auth.guildId, days)
      .all();

    // Get current server stats snapshot
    const currentStats = await db
      .prepare("SELECT * FROM server_stats WHERE guild_id = ? ORDER BY recorded_at DESC LIMIT 1")
      .bind(auth.guildId)
      .first();

    return json({
      guild_id: auth.guildId,
      current: currentStats || null,
      daily_stats: statsResult.results || [],
      days,
    });
  } catch (error) {
    log.error("[API v1] Error fetching stats:", error);
    return json({ error: "Failed to fetch statistics" }, { status: 500 });
  }
}
