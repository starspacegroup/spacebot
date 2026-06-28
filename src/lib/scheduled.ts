/**
 * Cloudflare Worker scheduled handler
 * 
 * This file defines scheduled event handlers (cron triggers)
 * for Cloudflare Workers/Pages.
 * 
 * Cron schedules defined in wrangler.toml:
 * - "0 * * * *" = Every hour (stats aggregation)  
 * - "0 0 * * *" = Daily at midnight (stats refresh from Discord + cleanup)
 */

import { runStatsAggregation, cleanupOldData } from "./db/stats-aggregation.js";
import { recordServerStats, fetchGuildStatsFromDiscord, pruneOldStats } from "./db/server-stats.js";
import { log } from "./log.js";

function getJobNameFromCronPattern(cronPattern) {
  if (cronPattern === "0 * * * *") return "hourly_aggregation";
  if (cronPattern === "0 0 * * *") return "daily_refresh";
  return null;
}

async function recordJobStart(db, jobName, cronPattern) {
  if (!db || !jobName) return null;

  try {
    const startedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const result = await db.prepare(`
      INSERT INTO cron_job_history (job_name, cron_pattern, triggered_by, status, started_at)
      VALUES (?, ?, 'cron', 'running', ?)
    `).bind(jobName, cronPattern, startedAt).run();

    if (result.meta?.last_row_id) {
      return result.meta.last_row_id;
    }

    const insertedRow = await db.prepare(`
      SELECT id
      FROM cron_job_history
      WHERE job_name = ?
        AND cron_pattern = ?
        AND triggered_by = 'cron'
        AND status = 'running'
        AND started_at = ?
      ORDER BY id DESC
      LIMIT 1
    `).bind(jobName, cronPattern, startedAt).first();

    return insertedRow?.id || null;
  } catch (error) {
    log.error("[Scheduled] Failed to record job start:", error);
    return null;
  }
}

async function recordJobComplete(db, jobId, success, resultData, errorMessage = null, durationMs = null) {
  if (!db || !jobId) return;

  try {
    await db.prepare(`
      UPDATE cron_job_history
      SET status = ?,
          result_data = ?,
          error_message = ?,
          completed_at = datetime('now'),
          duration_ms = ?
      WHERE id = ?
    `).bind(
      success ? 'success' : 'failed',
      resultData == null ? null : JSON.stringify(resultData),
      errorMessage,
      durationMs,
      jobId,
    ).run();
  } catch (error) {
    log.error("[Scheduled] Failed to record job completion:", error);
  }
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

/**
 * Get all guilds the bot is in via Discord API
 */
async function getBotGuilds(botToken) {
  if (!botToken) return [];

  try {
    const response = await fetch("https://discord.com/api/v10/users/@me/guilds", {
      headers: {
        Authorization: `Bot ${botToken}`,
      },
    });

    if (!response.ok) {
      log.warn(`Failed to fetch bot guilds: ${response.status}`);
      return [];
    }

    return await response.json();
  } catch (error) {
    log.error("Failed to fetch bot guilds:", error);
    return [];
  }
}

/**
 * Hourly job: Aggregate stats from event logs
 */
async function runHourlyAggregation(env) {
  const db = env.DB;
  if (!db) {
    log.warn("[Scheduled] Database not available for hourly aggregation");
    return { success: false, error: "Database not available" };
  }

  const startTime = Date.now();
  const guilds = await getGuildsWithLogs(db);

  if (guilds.length === 0) {
    log.info("[Scheduled] No guilds with recent activity for hourly aggregation");
    return { success: true, guildsProcessed: 0 };
  }

  const results = {
    guildsProcessed: 0,
    guildsFailed: 0,
    totalHourlyPeriods: 0,
    totalDailyPeriods: 0,
  };

  for (const guildId of guilds) {
    try {
      const { hourly, daily } = await runStatsAggregation(db, guildId);
      
      if (hourly.success) {
        results.guildsProcessed++;
        results.totalHourlyPeriods += hourly.periodsProcessed;
        results.totalDailyPeriods += daily.periodsProcessed;
      } else {
        results.guildsFailed++;
      }
    } catch (error) {
      results.guildsFailed++;
      log.error(`[Scheduled] Failed to aggregate stats for ${guildId}:`, error);
    }
  }

  const duration = Date.now() - startTime;
  log.info(`[Scheduled] Hourly aggregation completed: ${results.guildsProcessed} guilds, ${results.totalHourlyPeriods} hourly periods in ${duration}ms`);

  return { success: true, ...results, duration };
}

/**
 * Daily job: Refresh stats from Discord API and cleanup old data
 */
async function runDailyRefresh(env) {
  const db = env.DB;
  const botToken = env.DISCORD_BOT_TOKEN;

  if (!db) {
    log.warn("[Scheduled] Database not available for daily refresh");
    return { success: false, error: "Database not available" };
  }

  if (!botToken) {
    log.warn("[Scheduled] Bot token not configured for daily refresh");
    return { success: false, error: "Bot token not configured" };
  }

  const startTime = Date.now();
  const guilds = await getBotGuilds(botToken);

  if (guilds.length === 0) {
    log.info("[Scheduled] No guilds found for daily refresh");
    return { success: true, guildsProcessed: 0 };
  }

  const results = {
    processed: 0,
    failed: 0,
  };

  // Refresh stats from Discord for each guild
  for (const guild of guilds) {
    try {
      const fetchResult = await fetchGuildStatsFromDiscord(botToken, guild.id);
      
      if (fetchResult) {
        const result = await recordServerStats(db, guild.id, fetchResult.stats);
        if (result.success) {
          results.processed++;
        } else {
          results.failed++;
        }
      } else {
        results.failed++;
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 50));
    } catch (error) {
      results.failed++;
      log.error(`[Scheduled] Failed to refresh stats for ${guild.id}:`, error);
    }
  }

  // Cleanup old data
  const pruned = await pruneOldStats(db);
  const cleanup = await cleanupOldData(db);

  const duration = Date.now() - startTime;
  log.info(`[Scheduled] Daily refresh completed: ${results.processed} guilds, pruned ${pruned} old stats in ${duration}ms`);

  return { 
    success: true, 
    ...results, 
    prunedStats: pruned,
    cleanup,
    duration,
  };
}

/**
 * Cloudflare Worker scheduled event handler
 * 
 * @param {ScheduledEvent} event - The scheduled event
 * @param {Env} env - Environment bindings
 * @param {ExecutionContext} ctx - Execution context
 */
export async function scheduled(event, env, _ctx) {
  const cronPattern = event.cron;
  const jobName = getJobNameFromCronPattern(cronPattern);
  const db = env.DB;
  const startTime = Date.now();
  const jobId = await recordJobStart(db, jobName, cronPattern);
  
  log.info(`[Scheduled] Running cron job: ${cronPattern}`);

  try {
    // Determine which job to run based on cron pattern
    if (cronPattern === "0 * * * *") {
      // Hourly job - aggregate stats
      const result = await runHourlyAggregation(env);
      await recordJobComplete(db, jobId, true, result, null, Date.now() - startTime);
      log.info("[Scheduled] Hourly aggregation result:", result);
    } else if (cronPattern === "0 0 * * *") {
      // Daily job - refresh from Discord and cleanup
      // Also run aggregation to ensure we have the latest
      const aggregationResult = await runHourlyAggregation(env);
      const refreshResult = await runDailyRefresh(env);
      await recordJobComplete(db, jobId, true, { aggregation: aggregationResult, refresh: refreshResult }, null, Date.now() - startTime);
      log.info("[Scheduled] Daily job results:", { aggregation: aggregationResult, refresh: refreshResult });
    } else {
      await recordJobComplete(db, jobId, false, null, `Unknown cron pattern: ${cronPattern}`, Date.now() - startTime);
      log.warn(`[Scheduled] Unknown cron pattern: ${cronPattern}`);
    }
  } catch (error) {
    await recordJobComplete(db, jobId, false, null, error instanceof Error ? error.message : String(error), Date.now() - startTime);
    log.error(`[Scheduled] Cron job failed for ${cronPattern}:`, error);
    throw error; // Re-throw to mark the scheduled event as failed
  }
}

export default {
  scheduled,
};
