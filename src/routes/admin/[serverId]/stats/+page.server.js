import { redirect } from "@sveltejs/kit";
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
  getAggregatedStats,
  getMemberGrowthChart,
  getVoiceActivityChart,
  runStatsAggregation,
} from "$lib/db/stats-aggregation.js";
import { EVENT_CATEGORIES } from "$lib/db/logger.js";
import { getGuildMetadata } from "$lib/db/guild-metadata.js";
import { getBoostingMembersFromCache, getRolesFromCache } from "$lib/db/guild-cache.js";
import { getLiveVoiceChannels } from "$lib/db/live-voice.js";
import {
  LIVE_UPDATE_TOKEN_TTL_SECONDS,
  signLiveUpdateAccess,
} from "$lib/live-updates.js";
import { getServerPlan, PLAN_TIERS } from "$lib/db/server-plans.js";

const STATS_CACHE_FRESH_MS = 30 * 1000;
const STATS_CACHE_STALE_MS = 15 * 60 * 1000;
const STATS_CACHE = globalThis.__spacebotStatsPageCache ||= new Map();

const PERIOD_PRESETS_DAYS = [1, 7, 30, 90, 180, 365];

function getEnv(platform, name) {
  return platform?.env?.[name] ?? (typeof process !== "undefined" ? process.env?.[name] : undefined);
}

function buildPeriodOptions(retentionDays) {
  const allowedDays = retentionDays === null || retentionDays === undefined
    ? PERIOD_PRESETS_DAYS
    : PERIOD_PRESETS_DAYS.filter((days) => days <= retentionDays);

  const normalizedDays = allowedDays.length > 0 ? allowedDays : [1];

  return normalizedDays.map((days) => ({
    days,
    value: `${days}d`,
    label: days === 1 ? "1 Day" : `${days} Days`,
  }));
}

function normalizeSelectedPeriod(requestedPeriod, periodOptions) {
  if (periodOptions.some((option) => option.value === requestedPeriod)) {
    return requestedPeriod;
  }

  if (periodOptions.some((option) => option.value === "30d")) {
    return "30d";
  }

  return periodOptions[periodOptions.length - 1]?.value || "1d";
}

/**
 * Check if user is a superadmin (defined in ADMIN_USER_IDS env var)
 */
function checkIsSuperAdmin(userId, platform) {
  if (!userId) return false;

  const adminUserIds = platform?.env?.ADMIN_USER_IDS ||
    process.env.ADMIN_USER_IDS || "";

  const superAdminIdList = adminUserIds.split(",").map((id) => id.trim())
    .filter(Boolean);

  return superAdminIdList.includes(userId);
}

/** @type {import('./$types').PageServerLoad} */
export async function load({ params, cookies, platform, parent, url }) {
  const { serverId } = params;

  // Validate that serverId is a Discord snowflake (numeric string, 17-20 digits)
  if (!/^\d{17,20}$/.test(serverId)) {
    throw redirect(302, "/admin");
  }

  // Get parent layout data
  const parentData = await parent();

  // Check if user is logged in
  if (!parentData.isLoggedIn || !parentData.user) {
    throw redirect(302, "/login");
  }

  const userId = cookies.get("discord_user_id");
  const isSuperAdmin = checkIsSuperAdmin(userId, platform);

  // Get admin guilds from parent
  const adminGuilds = parentData.adminGuilds || [];
  
  // Check if user has access to this server
  const hasAccessToServer = isSuperAdmin ||
    adminGuilds.some((g) => g.id === serverId);

  if (!hasAccessToServer) {
    throw redirect(302, "/admin");
  }

  // Get guild info
  const guild = adminGuilds.find((g) => g.id === serverId);

  // Get database and bot token
  const db = platform?.env?.DB;
  const botToken = platform?.env?.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;

  const plan = db
    ? await getServerPlan(db, serverId)
    : { plan: "free", ...PLAN_TIERS.free, guild_id: serverId };
  const statsRetentionDays = plan?.stats_retention_days ?? PLAN_TIERS.free.stats_retention_days;
  const periodOptions = buildPeriodOptions(statsRetentionDays);
  const selectedPeriod = normalizeSelectedPeriod(url.searchParams.get("period"), periodOptions);
  const selectedPeriodOption = periodOptions.find((option) => option.value === selectedPeriod) || periodOptions[0];
  const timezone = parentData.timezone || null;
  const forceHotload = url.searchParams.get("hotload") === "1";
  const cacheKey = `${serverId}:${selectedPeriod}:${timezone || "utc"}`;
  const cachedEntry = STATS_CACHE.get(cacheKey);
  const cacheAgeMs = cachedEntry ? Date.now() - cachedEntry.cachedAt : Number.POSITIVE_INFINITY;
  const hasFreshCache = cacheAgeMs <= STATS_CACHE_FRESH_MS;
  const hasStaleCache = cacheAgeMs <= STATS_CACHE_STALE_MS;

  // Fetch comprehensive statistics
  let loadMeta = {
    source: "live",
    needsHotload: false,
    isStale: false,
    updatedAt: null,
  };
  let statistics = null;
  let heatmapData = [];
  let categoryTrends = [];
  let recentExecutions = [];
  let automationHistory = {};
  let memberStats = null;
  let memberHistory = [];
  let voiceActivity = null;
  let memberGrowth = null;
  let memberGrowthChartData = [];
  let voiceActivityChartData = [];
  let topVoiceUsers = [];
  let topVideoUsers = [];
  let topScreenshareUsers = [];
  let topBoosters = [];
  let guildMetadata = null;
  let cachedRoles = [];
  let liveUpdatesAuth = null;
  let liveVoiceSnapshot = {
    channels: [],
    totalUsers: 0,
    totalChannels: 0,
    activeCameras: 0,
    activeStreams: 0,
    updatedAt: null,
  };

  if (!forceHotload && hasStaleCache && cachedEntry?.data) {
    statistics = cachedEntry.data.statistics;
    heatmapData = cachedEntry.data.heatmapData;
    categoryTrends = cachedEntry.data.categoryTrends;
    recentExecutions = cachedEntry.data.recentExecutions;
    automationHistory = cachedEntry.data.automationHistory;
    memberStats = cachedEntry.data.memberStats;
    memberHistory = cachedEntry.data.memberHistory;
    voiceActivity = cachedEntry.data.voiceActivity;
    memberGrowth = cachedEntry.data.memberGrowth;
    memberGrowthChartData = cachedEntry.data.memberGrowthChartData;
    voiceActivityChartData = cachedEntry.data.voiceActivityChartData;
    topVoiceUsers = cachedEntry.data.topVoiceUsers;
    topVideoUsers = cachedEntry.data.topVideoUsers;
    topScreenshareUsers = cachedEntry.data.topScreenshareUsers;
    topBoosters = cachedEntry.data.topBoosters;
    guildMetadata = cachedEntry.data.guildMetadata;
    cachedRoles = cachedEntry.data.cachedRoles;
    liveVoiceSnapshot = cachedEntry.data.liveVoiceSnapshot;
    loadMeta = {
      source: "cache",
      needsHotload: false,
      isStale: !hasFreshCache,
      updatedAt: new Date(cachedEntry.cachedAt).toISOString(),
    };
  }

  const shouldFetchLive = db && (forceHotload || !hasStaleCache);
  if (shouldFetchLive) {
    try {
      const existingStats = await getLatestServerStats(db, serverId);
      log.debug(`[Stats] Existing stats for ${serverId}:`, existingStats);
      const syncedStats = await syncServerStatsIfStale(db, serverId, botToken, { existingStats });

      // Never block initial render on aggregation. Read available data immediately.
      try {
        runStatsAggregation(db, serverId)
          .then((aggregationResult) => {
            if (aggregationResult.hourly.periodsProcessed > 0 || aggregationResult.daily.periodsProcessed > 0) {
              log.info(`[Stats] On-demand aggregation for ${serverId}: ${aggregationResult.hourly.periodsProcessed} hourly, ${aggregationResult.daily.periodsProcessed} daily periods`);
            }
          })
          .catch((aggError) => {
            log.warn(`[Stats] On-demand aggregation failed for ${serverId}:`, aggError);
          });
      } catch (aggError) {
        log.warn(`[Stats] On-demand aggregation failed for ${serverId}:`, aggError);
      }

      [
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
      ] = await Promise.all([
        getGuildStatistics(db, serverId, timezone, selectedPeriod),
        getActivityHeatmap(db, serverId, timezone, selectedPeriod),
        getCategoryTrends(db, serverId, timezone, selectedPeriod),
        getRecentAutomationExecutions(db, serverId, 15),
        getAutomationExecutionHistory(db, serverId, timezone),
        // Member stats from server_stats
        Promise.all([
          Promise.resolve(syncedStats.latest ?? existingStats),
          getMemberCountChanges(db, serverId, timezone),
          getPeakMemberCount(db, serverId, selectedPeriod),
        ]).then(([latest, changes, peak]) => ({ latest, changes, peak })),
        getServerStatsHistory(db, serverId, { period: selectedPeriod, granularity: "daily", timezone }),
        // Aggregated voice activity
        getVoiceActivitySummary(db, serverId, selectedPeriod),
        // Aggregated member growth
        getMemberGrowthSummary(db, serverId, selectedPeriod),
        // Chart data for beautiful graphs
        getMemberGrowthChart(db, serverId, selectedPeriod, timezone),
        getVoiceActivityChart(db, serverId, selectedPeriod, timezone),
        // Top users for voice, video, and screenshare
        getTopVoiceUsers(db, serverId, 10, selectedPeriod),
        getTopVideoUsers(db, serverId, 10, selectedPeriod),
        getTopScreenshareUsers(db, serverId, 10, selectedPeriod),
        // Current active boosters from members cache
        getBoostingMembersFromCache(db, serverId, 50),
      ]);
      // Fetch guild metadata for boost features display
      try {
        guildMetadata = await getGuildMetadata(db, serverId);
      } catch (metaError) {
        log.warn(`[Stats] Failed to fetch guild metadata for ${serverId}:`, metaError);
      }
      // Fetch cached roles for roles panel
      try {
        cachedRoles = await getRolesFromCache(db, serverId);
      } catch (rolesError) {
        log.warn(`[Stats] Failed to fetch cached roles for ${serverId}:`, rolesError);
      }
      try {
        liveVoiceSnapshot = await getLiveVoiceChannels(db, serverId);
      } catch (liveVoiceError) {
        log.warn(`[Stats] Failed to fetch live voice snapshot for ${serverId}:`, liveVoiceError);
      }

      STATS_CACHE.set(cacheKey, {
        cachedAt: Date.now(),
        data: {
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
          guildMetadata,
          cachedRoles,
          liveVoiceSnapshot,
        },
      });

      loadMeta = {
        source: forceHotload ? "hotload" : "live",
        needsHotload: false,
        isStale: false,
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      log.error("Failed to fetch statistics:", error);
      if (forceHotload) {
        loadMeta = {
          source: "error",
          needsHotload: false,
          isStale: false,
          updatedAt: null,
        };
      }
    }
  } else if (!hasStaleCache) {
    loadMeta = {
      source: "shell",
      needsHotload: true,
      isStale: false,
      updatedAt: null,
    };
  }

  const liveUpdateSecret = getEnv(platform, "INTERNAL_API_KEY") || getEnv(platform, "DISCORD_BOT_TOKEN");
  const liveUpdateUserId = userId || parentData.user?.id;
  if (liveUpdateSecret && liveUpdateUserId) {
    const expiresAt = Math.floor(Date.now() / 1000) + LIVE_UPDATE_TOKEN_TTL_SECONDS;
    liveUpdatesAuth = {
      userId: liveUpdateUserId,
      expiresAt,
      signature: await signLiveUpdateAccess(serverId, liveUpdateUserId, expiresAt, liveUpdateSecret),
    };
  }

  return {
    serverId,
    guild,
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
    guildMetadata,
    cachedRoles,
    liveUpdatesAuth,
    liveVoiceSnapshot,
    plan,
    statsRetentionDays,
    periodOptions,
    selectedPeriod,
    selectedPeriodDays: selectedPeriodOption?.days || 1,
    selectedPeriodLabel: selectedPeriodOption?.label || "1 Day",
    loadMeta,
    eventCategories: EVENT_CATEGORIES,
    user: parentData.user,
    isSuperAdmin,
  };
}
