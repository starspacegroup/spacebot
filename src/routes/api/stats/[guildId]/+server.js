/**
 * API endpoint for recording and retrieving server statistics
 * 
 * GET /api/stats/[guildId] - Get server stats history
 * POST /api/stats/[guildId] - Record new stats snapshot (requires bot token or cron secret)
 */

import { json } from "@sveltejs/kit";
import {
  recordServerStats,
  getServerStatsHistory,
  getMemberCountChanges,
  getPeakMemberCount,
  getLatestServerStats,
  fetchGuildStatsFromDiscord,
} from "$lib/db/server-stats.js";
import { log } from "$lib/log.js";

/**
 * Verify the request has proper authorization
 */
function verifyAuth(request, platform) {
  // Check for cron secret (for scheduled jobs)
  const cronSecret = platform?.env?.CRON_SECRET || process.env.CRON_SECRET;
  const authHeader = request.headers.get("Authorization");
  
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return { authorized: true, type: "cron" };
  }

  // Check for internal request header (from our own app)
  const internalKey = platform?.env?.INTERNAL_API_KEY || process.env.INTERNAL_API_KEY;
  if (internalKey && authHeader === `Bearer ${internalKey}`) {
    return { authorized: true, type: "internal" };
  }

  return { authorized: false };
}

/** @type {import('./$types').RequestHandler} */
export async function GET({ params, url, platform, cookies }) {
  const { guildId } = params;

  if (!guildId) {
    return json({ error: "Guild ID required" }, { status: 400 });
  }

  const db = platform?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 503 });
  }

  // Get query parameters
  const period = url.searchParams.get("period") || "7d";
  const granularity = url.searchParams.get("granularity") || "auto";

  try {
    const [history, changes, peak, latest] = await Promise.all([
      getServerStatsHistory(db, guildId, { period, granularity }),
      getMemberCountChanges(db, guildId),
      getPeakMemberCount(db, guildId, period),
      getLatestServerStats(db, guildId),
    ]);

    return json({
      success: true,
      guildId,
      period,
      current: {
        memberCount: latest?.member_count || changes.current,
        humanCount: latest?.human_count || changes.currentHuman || null,
        onlineCount: latest?.online_count || null,
        botCount: latest?.bot_count || changes.botCount || null,
        boostCount: latest?.boost_count || null,
        boostLevel: latest?.boost_level || null,
        lastUpdated: latest?.recorded_at || null,
      },
      changes: {
        day: changes.day,
        week: changes.week,
        month: changes.month,
        dayHuman: changes.dayHuman,
        weekHuman: changes.weekHuman,
        monthHuman: changes.monthHuman,
      },
      peak: {
        count: peak.peak,
        date: peak.peakDate,
      },
      history,
    });
  } catch (error) {
    log.error("Failed to get server stats:", error);
    return json({ error: "Failed to fetch statistics" }, { status: 500 });
  }
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ params, request, platform }) {
  const { guildId } = params;

  if (!guildId) {
    return json({ error: "Guild ID required" }, { status: 400 });
  }

  // Verify authorization
  const auth = verifyAuth(request, platform);
  if (!auth.authorized) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = platform?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 503 });
  }

  const botToken = platform?.env?.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;

  try {
    // Check if stats were provided in the request body
    let stats;
    const contentType = request.headers.get("content-type");
    
    if (contentType?.includes("application/json")) {
      const body = await request.json();
      if (body.member_count !== undefined) {
        stats = body;
      }
    }

    // If no stats provided, fetch from Discord API
    if (!stats) {
      stats = await fetchGuildStatsFromDiscord(botToken, guildId);
      if (!stats) {
        return json({ error: "Failed to fetch guild stats from Discord" }, { status: 502 });
      }
    }

    // Record the stats
    const result = await recordServerStats(db, guildId, stats);

    if (!result.success) {
      return json({ error: result.error }, { status: 500 });
    }

    return json({
      success: true,
      guildId,
      recorded: stats,
      source: auth.type,
    });
  } catch (error) {
    log.error("Failed to record server stats:", error);
    return json({ error: "Failed to record statistics" }, { status: 500 });
  }
}
