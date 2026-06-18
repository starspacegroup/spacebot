/**
 * Shared implementations of the scheduled operational jobs.
 *
 * These were originally inlined in /api/cron/+server.js. They are extracted
 * here so both the legacy cron endpoint and the superadmin workflow runtime
 * execute the exact same code paths — workflows replace the hardcoded cron
 * scheduler without forking the job logic.
 */

import { runStatsAggregation, cleanupOldData } from "$lib/db/stats-aggregation.js";
import { recordServerStats, fetchGuildStatsFromDiscord, pruneOldStats } from "$lib/db/server-stats.js";
import { refreshGuildCache } from "$lib/db/guild-cache.js";
import { upsertGuildMetadata } from "$lib/db/guild-metadata.js";
import { log } from "$lib/log.js";

/**
 * Get all guilds that have event logs in the last 7 days.
 */
export async function getGuildsWithLogs(db) {
  if (!db) return [];

  try {
    const result = await db.prepare(`
      SELECT DISTINCT guild_id
      FROM event_logs
      WHERE created_at >= datetime('now', '-7 days')
    `).all();

    return result.results?.map(r => r.guild_id) || [];
  } catch (error) {
    log.error("[CronJobs] Failed to get guilds with logs:", error);
    return [];
  }
}

/**
 * Get all guilds the bot is in.
 */
export async function getBotGuilds(botToken) {
  if (!botToken) return [];

  try {
    const response = await fetch("https://discord.com/api/v10/users/@me/guilds", {
      headers: {
        Authorization: `Bot ${botToken}`,
      },
    });

    if (!response.ok) {
      log.warn(`[CronJobs] Failed to fetch bot guilds: ${response.status}`);
      return [];
    }

    return await response.json();
  } catch (error) {
    log.error("[CronJobs] Failed to fetch bot guilds:", error);
    return [];
  }
}

/**
 * Aggregate event logs into hourly and daily statistics for every guild with
 * recent logs.
 */
export async function runHourlyAggregation(db) {
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
      log.error(`[CronJobs] Failed to aggregate stats for ${guildId}:`, error);
    }
  }

  return results;
}

/**
 * Refresh server stats and guild metadata from Discord for every bot guild.
 * This is the stats/metadata portion of the daily refresh, exposed separately
 * so workflow steps can run it as a discrete node.
 */
export async function refreshServerStatsAndMetadata(db, botToken) {
  const guilds = await getBotGuilds(botToken);
  const results = {
    stats: { processed: 0, failed: 0 },
    metadata: { processed: 0, failed: 0 },
    guildCount: guilds.length,
  };

  for (const guild of guilds) {
    try {
      const fetchResult = await fetchGuildStatsFromDiscord(botToken, guild.id);
      if (!fetchResult) {
        results.stats.failed++;
        continue;
      }

      const saved = await recordServerStats(db, guild.id, fetchResult.stats);
      if (saved.success) results.stats.processed++;
      else results.stats.failed++;

      try {
        const metaResult = await upsertGuildMetadata(db, fetchResult.rawGuild);
        if (metaResult.success) results.metadata.processed++;
        else results.metadata.failed++;
      } catch (metaError) {
        results.metadata.failed++;
        log.warn(`[CronJobs] Metadata upsert failed for ${guild.id}:`, metaError);
      }

      // Small delay between API calls to be polite to Discord
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      results.stats.failed++;
      log.error(`[CronJobs] Failed to refresh stats for ${guild.id}:`, error);
    }
  }

  return results;
}

/**
 * Run the daily refresh job: stats + metadata + member/role cache for every
 * guild, then prune and clean up old data.
 */
export async function runDailyRefresh(db, botToken) {
  const guilds = await getBotGuilds(botToken);

  if (guilds.length === 0) {
    return { stats: { processed: 0, failed: 0 }, cache: { processed: 0, failed: 0, skipped: 0 } };
  }

  const results: {
    stats: { processed: number; failed: number };
    cache: {
      processed: number;
      failed: number;
      skipped: number;
      totalMembers: number;
      totalRoles: number;
      totalBots: number;
      totalHumans: number;
    };
    prunedStats?: any;
    cleanup?: any;
    metadata?: { processed: number; failed: number };
  } = {
    stats: {
      processed: 0,
      failed: 0,
    },
    cache: {
      processed: 0,
      failed: 0,
      skipped: 0,
      totalMembers: 0,
      totalRoles: 0,
      totalBots: 0,
      totalHumans: 0,
    },
  };

  const metadataResults = { processed: 0, failed: 0 };

  // Refresh stats, metadata, and cache from Discord for each guild
  for (const guild of guilds) {
    try {
      // 1. Refresh basic server stats + guild metadata
      const fetchResult = await fetchGuildStatsFromDiscord(botToken, guild.id);

      if (fetchResult) {
        const result = await recordServerStats(db, guild.id, fetchResult.stats);
        if (result.success) {
          results.stats.processed++;
        } else {
          results.stats.failed++;
        }

        try {
          const metaResult = await upsertGuildMetadata(db, fetchResult.rawGuild);
          if (metaResult.success) {
            metadataResults.processed++;
          } else {
            metadataResults.failed++;
          }
        } catch (metaError) {
          metadataResults.failed++;
          log.warn(`[CronJobs] Metadata upsert failed for ${guild.id}:`, metaError);
        }
      } else {
        results.stats.failed++;
      }

      // Small delay between API calls
      await new Promise(resolve => setTimeout(resolve, 100));

      // 2. Refresh member and role cache (comprehensive data)
      try {
        const cacheResult: any = await refreshGuildCache(db, botToken, guild.id);

        if (cacheResult.success) {
          results.cache.processed++;
          results.cache.totalMembers += cacheResult.members?.count || 0;
          results.cache.totalRoles += cacheResult.roles?.count || 0;
          results.cache.totalBots += cacheResult.members?.botCount || 0;
          results.cache.totalHumans += cacheResult.members?.humanCount || 0;
        } else if (cacheResult.error?.includes("Intent") || cacheResult.error?.includes("permission")) {
          // Server Members Intent not enabled or missing permissions - skip but don't count as failure
          results.cache.skipped++;
          log.debug(`[CronJobs] Cache refresh skipped for ${guild.id}: ${cacheResult.error}`);
        } else {
          results.cache.failed++;
          log.warn(`[CronJobs] Cache refresh failed for ${guild.id}: ${cacheResult.error}`);
        }
      } catch (cacheError) {
        results.cache.failed++;
        log.error(`[CronJobs] Cache refresh error for ${guild.id}:`, cacheError);
      }

      // Delay between guilds to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      results.stats.failed++;
      log.error(`[CronJobs] Failed to refresh data for ${guild.id}:`, error);
    }
  }

  // Cleanup old data
  results.prunedStats = await pruneOldStats(db);
  results.cleanup = await cleanupOldData(db);
  results.metadata = metadataResults;

  log.info(`[CronJobs] Daily refresh complete: ${results.stats.processed} stats, ${metadataResults.processed} metadata, ${results.cache.processed} caches (${results.cache.totalMembers} members, ${results.cache.totalRoles} roles)`);

  return results;
}

/**
 * Refresh member and role cache for all guilds without updating stats.
 */
export async function runCacheRefresh(db, botToken) {
  const guilds = await getBotGuilds(botToken);

  if (guilds.length === 0) {
    return { processed: 0, failed: 0, skipped: 0 };
  }

  const results = {
    processed: 0,
    failed: 0,
    skipped: 0,
    totalMembers: 0,
    totalRoles: 0,
    totalBots: 0,
    totalHumans: 0,
    guilds: [],
  };

  for (const guild of guilds) {
    try {
      const cacheResult: any = await refreshGuildCache(db, botToken, guild.id);

      const guildResult: {
        id: any;
        name: any;
        success: boolean;
        members: any;
        roles: any;
        bots: any;
        humans: any;
        error: any;
        skipped?: boolean;
      } = {
        id: guild.id,
        name: guild.name,
        success: cacheResult.success,
        members: cacheResult.members?.count || 0,
        roles: cacheResult.roles?.count || 0,
        bots: cacheResult.members?.botCount || 0,
        humans: cacheResult.members?.humanCount || 0,
        error: cacheResult.error || null,
      };

      if (cacheResult.success) {
        results.processed++;
        results.totalMembers += guildResult.members;
        results.totalRoles += guildResult.roles;
        results.totalBots += guildResult.bots;
        results.totalHumans += guildResult.humans;
      } else if (cacheResult.error?.includes("Intent") || cacheResult.error?.includes("permission")) {
        results.skipped++;
        guildResult.skipped = true;
      } else {
        results.failed++;
      }

      results.guilds.push(guildResult);

      // Delay between guilds to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      results.failed++;
      results.guilds.push({
        id: guild.id,
        name: guild.name,
        success: false,
        error: error.message,
      });
      log.error(`[CronJobs] Cache refresh error for ${guild.id}:`, error);
    }
  }

  log.info(`[CronJobs] Cache refresh complete: ${results.processed} guilds, ${results.totalMembers} members, ${results.totalRoles} roles`);

  return results;
}

/**
 * Delete all aggregated stats (hourly + daily). Destructive — used by the
 * rebuild flow and exposed as a discrete workflow operation behind approval.
 */
export async function deleteAggregatedStats(db) {
  const hourlyDelete = await db.prepare(`
    DELETE FROM aggregated_stats WHERE period_type = 'hourly'
  `).run();
  const dailyDelete = await db.prepare(`
    DELETE FROM aggregated_stats WHERE period_type = 'daily'
  `).run();

  const results = {
    deletedHourly: hourlyDelete.meta?.changes || 0,
    deletedDaily: dailyDelete.meta?.changes || 0,
  };
  log.info(`[CronJobs] Deleted ${results.deletedHourly} hourly and ${results.deletedDaily} daily aggregated stats`);
  return results;
}

/**
 * Rebuild all aggregated stats from scratch: deletes existing aggregates and
 * re-aggregates from event logs (90-day lookback).
 */
export async function runRebuildStats(db) {
  const results = {
    deletedHourly: 0,
    deletedDaily: 0,
    guildsProcessed: 0,
    guildsFailed: 0,
    totalHourlyPeriods: 0,
    totalDailyPeriods: 0,
  };

  try {
    const deleted = await deleteAggregatedStats(db);
    results.deletedHourly = deleted.deletedHourly;
    results.deletedDaily = deleted.deletedDaily;

    // Get all guilds that have event logs (look back further for rebuild)
    const guildResult = await db.prepare(`
      SELECT DISTINCT guild_id
      FROM event_logs
      WHERE created_at >= datetime('now', '-90 days')
    `).all();

    const guilds = guildResult.results?.map(r => r.guild_id) || [];

    if (guilds.length === 0) {
      log.info("[CronJobs] No guilds with event logs found for rebuild");
      return results;
    }

    log.info(`[CronJobs] Rebuilding stats for ${guilds.length} guilds`);

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
        log.error(`[CronJobs] Failed to rebuild stats for ${guildId}:`, error);
      }
    }

    log.info(`[CronJobs] Rebuild complete: ${results.guildsProcessed} guilds, ${results.totalHourlyPeriods} hourly, ${results.totalDailyPeriods} daily periods`);
  } catch (error) {
    log.error("[CronJobs] Failed to rebuild stats:", error);
    throw error;
  }

  return results;
}

/**
 * Sanity-check the aggregates against source event logs. Read-only; returns a
 * summary so workflow runs (e.g. post-rebuild verification) can assert health.
 */
export async function verifyAggregateIntegrity(db) {
  const [aggregates, sources] = await Promise.all([
    db.prepare(`
      SELECT period_type, COUNT(*) AS periods, COUNT(DISTINCT guild_id) AS guilds
      FROM aggregated_stats
      GROUP BY period_type
    `).all(),
    db.prepare(`
      SELECT COUNT(*) AS events, COUNT(DISTINCT guild_id) AS guilds
      FROM event_logs
      WHERE created_at >= datetime('now', '-7 days')
    `).first(),
  ]);

  const byPeriod: Record<string, { periods: number; guilds: number }> = {};
  for (const row of aggregates.results || []) {
    byPeriod[row.period_type] = { periods: Number(row.periods), guilds: Number(row.guilds) };
  }

  const sourceGuilds = Number(sources?.guilds || 0);
  const aggregatedGuilds = Math.max(byPeriod.hourly?.guilds || 0, byPeriod.daily?.guilds || 0);

  return {
    aggregates: byPeriod,
    recentSource: { events: Number(sources?.events || 0), guilds: sourceGuilds },
    coverageOk: sourceGuilds === 0 || aggregatedGuilds > 0,
  };
}
