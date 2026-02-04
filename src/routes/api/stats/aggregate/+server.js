/**
 * API endpoint for scheduled stats aggregation
 * 
 * POST /api/stats/aggregate - Run stats aggregation for all guilds
 * 
 * This endpoint is designed to be called by a cron job every hour
 * to build aggregated statistics from event logs.
 * 
 * It's smart enough to skip data that's already been processed,
 * so running it multiple times is safe and efficient.
 */

import { json } from "@sveltejs/kit";
import { runStatsAggregation, cleanupOldData } from "$lib/db/stats-aggregation.js";
import { log } from "$lib/log.js";

/**
 * Verify the request has proper authorization
 */
function verifyAuth(request, platform) {
  const cronSecret = platform?.env?.CRON_SECRET || process.env.CRON_SECRET;
  const authHeader = request.headers.get("Authorization");
  
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return true;
  }

  const internalKey = platform?.env?.INTERNAL_API_KEY || process.env.INTERNAL_API_KEY;
  if (internalKey && authHeader === `Bearer ${internalKey}`) {
    return true;
  }

  return false;
}

/**
 * Get all guilds that have event logs
 */
async function getGuildsWithLogs(db) {
  if (!db) return [];

  try {
    const result = await db.prepare(`
      SELECT DISTINCT guild_id 
      FROM event_logs 
      WHERE created_at >= datetime('now', '-7 days')
    `).all();

    return result.results?.map(r => r.guild_id) || [];
  } catch (error) {
    log.error("Failed to get guilds with logs:", error);
    return [];
  }
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ request, platform }) {
  // Verify authorization
  if (!verifyAuth(request, platform)) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = platform?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 503 });
  }

  const startTime = Date.now();

  try {
    // Get all guilds with recent activity
    const guilds = await getGuildsWithLogs(db);
    
    if (guilds.length === 0) {
      return json({ 
        success: true, 
        message: "No guilds with recent activity found",
        guildsProcessed: 0,
        duration: Date.now() - startTime,
      });
    }

    const results = {
      guildsProcessed: 0,
      guildsFailed: 0,
      totalHourlyPeriods: 0,
      totalDailyPeriods: 0,
      totalEventsProcessed: 0,
      errors: [],
    };

    // Process each guild
    for (const guildId of guilds) {
      try {
        const { hourly, daily } = await runStatsAggregation(db, guildId);
        
        if (hourly.success && daily.success) {
          results.guildsProcessed++;
          results.totalHourlyPeriods += hourly.periodsProcessed;
          results.totalDailyPeriods += daily.periodsProcessed;
          results.totalEventsProcessed += hourly.eventsProcessed;
        } else {
          results.guildsFailed++;
          if (hourly.error) results.errors.push({ guildId, type: "hourly", error: hourly.error });
          if (daily.error) results.errors.push({ guildId, type: "daily", error: daily.error });
        }
      } catch (error) {
        results.guildsFailed++;
        results.errors.push({ guildId, error: error.message });
      }
    }

    // Cleanup old data periodically (only if we processed something)
    let cleanup = { sessionsDeleted: 0, aggregatesDeleted: 0 };
    if (results.guildsProcessed > 0) {
      cleanup = await cleanupOldData(db);
    }

    const duration = Date.now() - startTime;

    log.info(`[StatsAggregation] Completed: ${results.guildsProcessed} guilds, ${results.totalHourlyPeriods} hourly periods, ${results.totalDailyPeriods} daily periods in ${duration}ms`);

    return json({
      success: true,
      totalGuilds: guilds.length,
      guildsProcessed: results.guildsProcessed,
      guildsFailed: results.guildsFailed,
      hourlyPeriodsCreated: results.totalHourlyPeriods,
      dailyPeriodsCreated: results.totalDailyPeriods,
      eventsProcessed: results.totalEventsProcessed,
      cleanup: {
        sessionsDeleted: cleanup.sessionsDeleted,
        aggregatesDeleted: cleanup.aggregatesDeleted,
      },
      duration: `${duration}ms`,
      errors: results.errors.length > 0 ? results.errors.slice(0, 10) : undefined,
    });
  } catch (error) {
    log.error("Failed to run stats aggregation:", error);
    return json({ 
      error: "Failed to run stats aggregation",
      details: error.message,
    }, { status: 500 });
  }
}

/** @type {import('./$types').RequestHandler} */
export async function GET({ platform }) {
  // Simple health check / info endpoint
  const db = platform?.env?.DB;

  let stats = null;
  if (db) {
    try {
      // Get some basic info about aggregated data
      const result = await db.prepare(`
        SELECT 
          period_type,
          COUNT(*) as count,
          MIN(period_start) as earliest,
          MAX(period_start) as latest
        FROM aggregated_stats
        GROUP BY period_type
      `).all();
      
      stats = result.results || [];
    } catch {
      // Table might not exist yet
      stats = [];
    }
  }

  return json({
    endpoint: "/api/stats/aggregate",
    method: "POST",
    description: "Runs hourly stats aggregation for all guilds with recent activity. Smart enough to skip already-processed data.",
    authorization: "Requires CRON_SECRET or INTERNAL_API_KEY",
    schedule: "Designed to run every hour via cron",
    status: {
      database: db ? "available" : "unavailable",
    },
    currentData: stats,
  });
}
