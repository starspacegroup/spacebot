import { log } from "$lib/db/logger.js";
import {
  getGuildStatistics,
  getActivityHeatmap,
  getCategoryTrends,
  getRecentAutomationExecutions,
  getAutomationExecutionHistory,
  getTopVoiceUsers,
  getTopVideoUsers,
  getTopScreenshareUsers,
} from "$lib/db/statistics.js";
import {
  getServerStatsHistory,
  getMemberCountChanges,
  getPeakMemberCount,
  getLatestServerStats,
  syncServerStatsIfStale,
} from "$lib/db/server-stats.js";
import {
  getVoiceActivitySummary,
  getMemberGrowthSummary,
  getMemberGrowthChart,
  getVoiceActivityChart,
  runStatsAggregation,
} from "$lib/db/stats-aggregation.js";
import { getBoostingMembersFromCache, getRolesFromCache } from "$lib/db/guild-cache.js";
import { getLiveVoiceChannels } from "$lib/db/live-voice.js";

// Shared by the admin/[serverId]/stats page load (cache-read path) and the
// /api/admin/[serverId]/stats-data endpoint (the client-side fetch that
// replaces the old goto(invalidateAll) hotload — see that route for why).
export const STATS_CACHE_FRESH_MS = 30 * 1000;
export const STATS_CACHE_STALE_MS = 15 * 60 * 1000;
export const STATS_CACHE = (globalThis as any).__spacebotStatsPageCache ||= new Map();

export function statsCacheKey(serverId, selectedPeriod, timezone) {
  return `${serverId}:${selectedPeriod}:${timezone || "utc"}`;
}

export function getStatsCacheEntry(cacheKey) {
  const cachedEntry = STATS_CACHE.get(cacheKey);
  const cacheAgeMs = cachedEntry ? Date.now() - cachedEntry.cachedAt : Number.POSITIVE_INFINITY;
  return {
    cachedEntry,
    hasFreshCache: cacheAgeMs <= STATS_CACHE_FRESH_MS,
    hasStaleCache: cacheAgeMs <= STATS_CACHE_STALE_MS,
  };
}

/**
 * Run the full set of Discord API calls, stats aggregation, and ~18 D1
 * queries behind the per-server Statistics page, then cache the result.
 * Skips the forced multi-day repair window on aggregation — that's an
 * interactive-load-path optimization; the background cron keeps it fully
 * accurate over time.
 */
export async function fetchStatsPageLiveData(db, serverId, botToken, timezone, selectedPeriod) {
  try {
    const existingStats = await getLatestServerStats(db, serverId);
    const syncedStats = await syncServerStatsIfStale(db, serverId, botToken, { existingStats });

    try {
      const aggregationResult = await runStatsAggregation(db, serverId, { repair: false });
      if (aggregationResult.hourly.periodsProcessed > 0 || aggregationResult.daily.periodsProcessed > 0) {
        log.info(`[Stats] On-demand aggregation for ${serverId}: ${aggregationResult.hourly.periodsProcessed} hourly, ${aggregationResult.daily.periodsProcessed} daily periods`);
      }
    } catch (aggError) {
      log.warn(`[Stats] On-demand aggregation failed for ${serverId}:`, aggError);
    }

    const [
      statistics,
      heatmapData,
      categoryTrends,
      recentExecutions,
      automationHistory,
      memberStats,
      memberHistory,
      voiceActivity,
      memberGrowth,
      memberGrowthChartData,
      voiceActivityChartData,
      topVoiceUsers,
      topVideoUsers,
      topScreenshareUsers,
      topBoosters,
      cachedRoles,
      liveVoiceSnapshot,
    ] = await Promise.all([
      getGuildStatistics(db, serverId, timezone, selectedPeriod),
      getActivityHeatmap(db, serverId, timezone, selectedPeriod),
      getCategoryTrends(db, serverId, timezone, selectedPeriod),
      getRecentAutomationExecutions(db, serverId, 15),
      getAutomationExecutionHistory(db, serverId, timezone),
      Promise.all([
        Promise.resolve(syncedStats.latest ?? existingStats),
        getMemberCountChanges(db, serverId, timezone),
        getPeakMemberCount(db, serverId, selectedPeriod),
      ]).then(([latest, changes, peak]) => ({ latest, changes, peak })),
      getServerStatsHistory(db, serverId, { period: selectedPeriod, granularity: "daily", timezone }),
      getVoiceActivitySummary(db, serverId, selectedPeriod),
      getMemberGrowthSummary(db, serverId, selectedPeriod),
      getMemberGrowthChart(db, serverId, selectedPeriod, timezone),
      getVoiceActivityChart(db, serverId, selectedPeriod, timezone),
      getTopVoiceUsers(db, serverId, 10, selectedPeriod),
      getTopVideoUsers(db, serverId, 10, selectedPeriod),
      getTopScreenshareUsers(db, serverId, 10, selectedPeriod),
      getBoostingMembersFromCache(db, serverId, 50),
      getRolesFromCache(db, serverId).catch((rolesError) => {
        log.warn(`[Stats] Failed to fetch cached roles for ${serverId}:`, rolesError);
        return [];
      }),
      getLiveVoiceChannels(db, serverId).catch((liveVoiceError) => {
        log.warn(`[Stats] Failed to fetch live voice snapshot for ${serverId}:`, liveVoiceError);
        return {
          channels: [],
          totalUsers: 0,
          totalChannels: 0,
          activeCameras: 0,
          activeStreams: 0,
          updatedAt: null,
        };
      }),
    ]);

    const data = {
      statistics,
      heatmapData,
      categoryTrends,
      recentExecutions,
      automationHistory,
      memberStats,
      memberHistory,
      voiceActivity,
      memberGrowth,
      memberGrowthChartData,
      voiceActivityChartData,
      topVoiceUsers,
      topVideoUsers,
      topScreenshareUsers,
      topBoosters,
      cachedRoles,
      liveVoiceSnapshot,
    };

    STATS_CACHE.set(statsCacheKey(serverId, selectedPeriod, timezone), { cachedAt: Date.now(), data });

    return { success: true, data };
  } catch (error) {
    log.error("Failed to fetch statistics:", error);
    return { success: false, error };
  }
}
