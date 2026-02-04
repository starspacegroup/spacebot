/**
 * API endpoint for managing cron jobs
 * 
 * GET /api/cron - Get cron job history and definitions
 * POST /api/cron - Manually trigger a cron job
 * 
 * Only accessible by superadmins.
 */

import { json } from "@sveltejs/kit";
import { runStatsAggregation, cleanupOldData } from "$lib/db/stats-aggregation.js";
import { recordServerStats, fetchGuildStatsFromDiscord, pruneOldStats } from "$lib/db/server-stats.js";
import { log } from "$lib/log.js";

/**
 * Check if user is a superadmin
 */
function checkIsSuperAdmin(userId, platform) {
  if (!userId) return false;

  const adminUserIds = platform?.env?.ADMIN_USER_IDS ||
    process.env.ADMIN_USER_IDS || "";

  const superAdminIdList = adminUserIds.split(",").map((id) => id.trim())
    .filter(Boolean);

  return superAdminIdList.includes(userId);
}

/**
 * Get the list of available cron jobs
 */
function getCronJobDefinitions() {
  return [
    {
      name: "hourly_aggregation",
      displayName: "Hourly Stats Aggregation",
      description: "Aggregates event logs into hourly and daily statistics",
      cronPattern: "0 * * * *",
      schedule: "Every hour at :00",
    },
    {
      name: "daily_refresh",
      displayName: "Daily Discord Refresh",
      description: "Refreshes server stats from Discord API and cleans up old data",
      cronPattern: "0 0 * * *",
      schedule: "Daily at midnight UTC",
    },
    {
      name: "rebuild_stats",
      displayName: "Rebuild All Stats",
      description: "Deletes all aggregated stats and rebuilds from event logs. Use after schema changes.",
      cronPattern: null,
      schedule: "Manual only",
      dangerous: true,
    },
  ];
}

/**
 * Get cron job execution history from the database
 */
async function getCronJobHistory(db, limit = 50) {
  if (!db) return [];

  try {
    // First check if the table exists
    const tableCheck = await db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='cron_job_history'
    `).first();

    if (!tableCheck) {
      return [];
    }

    const result = await db.prepare(`
      SELECT *
      FROM cron_job_history
      ORDER BY started_at DESC
      LIMIT ?
    `).bind(limit).all();

    return result.results || [];
  } catch (error) {
    log.error("[Cron API] Failed to get cron job history:", error);
    return [];
  }
}

/**
 * Get the last run time for each job
 */
async function getLastRunTimes(db) {
  if (!db) return {};

  try {
    const tableCheck = await db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='cron_job_history'
    `).first();

    if (!tableCheck) {
      return {};
    }

    const result = await db.prepare(`
      SELECT job_name, 
             MAX(started_at) as last_run,
             (SELECT status FROM cron_job_history c2 
              WHERE c2.job_name = cron_job_history.job_name 
              ORDER BY started_at DESC LIMIT 1) as last_status
      FROM cron_job_history
      GROUP BY job_name
    `).all();

    const lastRuns = {};
    for (const row of result.results || []) {
      lastRuns[row.job_name] = {
        lastRun: row.last_run,
        lastStatus: row.last_status,
      };
    }

    return lastRuns;
  } catch (error) {
    log.error("[Cron API] Failed to get last run times:", error);
    return {};
  }
}

/**
 * Record a cron job execution start
 */
async function recordJobStart(db, jobName, triggeredBy, userId = null) {
  if (!db) return null;

  try {
    const result = await db.prepare(`
      INSERT INTO cron_job_history (job_name, cron_pattern, triggered_by, triggered_by_user_id, status, started_at)
      VALUES (?, ?, ?, ?, 'running', datetime('now'))
    `).bind(
      jobName,
      getCronJobDefinitions().find(j => j.name === jobName)?.cronPattern || null,
      triggeredBy,
      userId
    ).run();

    return result.meta?.last_row_id;
  } catch (error) {
    log.error("[Cron API] Failed to record job start:", error);
    return null;
  }
}

/**
 * Record a cron job completion
 */
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
      JSON.stringify(resultData),
      errorMessage,
      durationMs,
      jobId
    ).run();
  } catch (error) {
    log.error("[Cron API] Failed to record job completion:", error);
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
    log.error("[Cron API] Failed to get guilds with logs:", error);
    return [];
  }
}

/**
 * Get all guilds the bot is in
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
      log.warn(`[Cron API] Failed to fetch bot guilds: ${response.status}`);
      return [];
    }

    return await response.json();
  } catch (error) {
    log.error("[Cron API] Failed to fetch bot guilds:", error);
    return [];
  }
}

/**
 * Run the hourly aggregation job
 */
async function runHourlyAggregation(db) {
  const guilds = await getGuildsWithLogs(db);

  if (guilds.length === 0) {
    return { guildsProcessed: 0, totalHourlyPeriods: 0, totalDailyPeriods: 0 };
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
      log.error(`[Cron API] Failed to aggregate stats for ${guildId}:`, error);
    }
  }

  return results;
}

/**
 * Run the daily refresh job
 */
async function runDailyRefresh(db, botToken) {
  const guilds = await getBotGuilds(botToken);

  if (guilds.length === 0) {
    return { processed: 0, failed: 0 };
  }

  const results = {
    processed: 0,
    failed: 0,
  };

  // Refresh stats from Discord for each guild
  for (const guild of guilds) {
    try {
      const stats = await fetchGuildStatsFromDiscord(botToken, guild.id);
      
      if (stats) {
        const result = await recordServerStats(db, guild.id, stats);
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
      log.error(`[Cron API] Failed to refresh stats for ${guild.id}:`, error);
    }
  }

  // Cleanup old data
  results.prunedStats = await pruneOldStats(db);
  results.cleanup = await cleanupOldData(db);

  return results;
}

/**
 * Rebuild all aggregated stats from scratch
 * This deletes all existing aggregated data and re-aggregates from event logs
 */
async function runRebuildStats(db) {
  const results = {
    deletedHourly: 0,
    deletedDaily: 0,
    guildsProcessed: 0,
    guildsFailed: 0,
    totalHourlyPeriods: 0,
    totalDailyPeriods: 0,
  };

  try {
    // Delete all existing hourly aggregated stats
    const hourlyDelete = await db.prepare(`
      DELETE FROM aggregated_stats WHERE period_type = 'hourly'
    `).run();
    results.deletedHourly = hourlyDelete.meta?.changes || 0;

    // Delete all existing daily aggregated stats
    const dailyDelete = await db.prepare(`
      DELETE FROM aggregated_stats WHERE period_type = 'daily'
    `).run();
    results.deletedDaily = dailyDelete.meta?.changes || 0;

    log.info(`[Cron API] Deleted ${results.deletedHourly} hourly and ${results.deletedDaily} daily aggregated stats`);

    // Get all guilds that have event logs (look back further for rebuild)
    const guildResult = await db.prepare(`
      SELECT DISTINCT guild_id 
      FROM event_logs 
      WHERE created_at >= datetime('now', '-90 days')
    `).all();

    const guilds = guildResult.results?.map(r => r.guild_id) || [];

    if (guilds.length === 0) {
      log.info("[Cron API] No guilds with event logs found for rebuild");
      return results;
    }

    log.info(`[Cron API] Rebuilding stats for ${guilds.length} guilds`);

    // Re-aggregate stats for each guild
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
        log.error(`[Cron API] Failed to rebuild stats for ${guildId}:`, error);
      }
    }

    log.info(`[Cron API] Rebuild complete: ${results.guildsProcessed} guilds, ${results.totalHourlyPeriods} hourly, ${results.totalDailyPeriods} daily periods`);

  } catch (error) {
    log.error("[Cron API] Failed to rebuild stats:", error);
    throw error;
  }

  return results;
}

/**
 * GET /api/cron - Get cron job definitions and history
 */
export async function GET({ cookies, platform }) {
  const userId = cookies.get("discord_user_id");

  if (!checkIsSuperAdmin(userId, platform)) {
    return json({ error: "Unauthorized" }, { status: 403 });
  }

  const db = platform?.env?.DB;
  
  const [history, lastRuns] = await Promise.all([
    getCronJobHistory(db, 50),
    getLastRunTimes(db),
  ]);

  const definitions = getCronJobDefinitions().map(job => ({
    ...job,
    lastRun: lastRuns[job.name]?.lastRun || null,
    lastStatus: lastRuns[job.name]?.lastStatus || null,
  }));

  return json({
    jobs: definitions,
    history: history.map(h => ({
      ...h,
      result_data: h.result_data ? JSON.parse(h.result_data) : null,
    })),
  });
}

/**
 * POST /api/cron - Manually trigger a cron job
 */
export async function POST({ request, cookies, platform }) {
  const userId = cookies.get("discord_user_id");

  if (!checkIsSuperAdmin(userId, platform)) {
    return json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await request.json();
  const { jobName } = body;

  if (!jobName) {
    return json({ error: "Job name is required" }, { status: 400 });
  }

  const jobDef = getCronJobDefinitions().find(j => j.name === jobName);
  if (!jobDef) {
    return json({ error: "Unknown job name" }, { status: 400 });
  }

  const db = platform?.env?.DB;
  const botToken = platform?.env?.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;

  if (!db) {
    return json({ error: "Database not available" }, { status: 503 });
  }

  const startTime = Date.now();
  const jobId = await recordJobStart(db, jobName, 'manual', userId);

  try {
    let result;

    if (jobName === 'hourly_aggregation') {
      result = await runHourlyAggregation(db);
    } else if (jobName === 'daily_refresh') {
      if (!botToken) {
        throw new Error("Bot token not configured");
      }
      // Also run aggregation first
      const aggregationResult = await runHourlyAggregation(db);
      const refreshResult = await runDailyRefresh(db, botToken);
      result = { aggregation: aggregationResult, refresh: refreshResult };
    } else if (jobName === 'rebuild_stats') {
      result = await runRebuildStats(db);
    }

    const duration = Date.now() - startTime;
    await recordJobComplete(db, jobId, true, result, null, duration);

    log.info(`[Cron API] Manual job ${jobName} completed by user ${userId} in ${duration}ms`);

    return json({
      success: true,
      jobName,
      result,
      duration,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    await recordJobComplete(db, jobId, false, null, error.message, duration);

    log.error(`[Cron API] Manual job ${jobName} failed:`, error);

    return json({
      success: false,
      error: error.message,
      duration,
    }, { status: 500 });
  }
}
