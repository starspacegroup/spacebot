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
  fetchGuildStatsFromDiscord,
  recordServerStats,
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
export async function load({ params, cookies, platform, parent }) {
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

  // Fetch comprehensive statistics
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
  let guildMetadata = null;

  if (db) {
    try {
      // First, check if we have any member stats - if not, fetch from Discord
      const existingStats = await getLatestServerStats(db, serverId);
      log.debug(`[Stats] Existing stats for ${serverId}:`, existingStats);
      
      // Fetch from Discord if no stats exist OR if member_count is 0 (likely stale/placeholder data)
      if ((!existingStats || existingStats.member_count === 0) && botToken) {
        // No valid stats exist - fetch current stats from Discord API and save
        log.info(`[Stats] No valid stats for guild ${serverId}, fetching from Discord...`);
        const fetchResult = await fetchGuildStatsFromDiscord(botToken, serverId);
        const discordStats = fetchResult?.stats;
        log.debug(`[Stats] Discord API returned:`, discordStats);
        if (discordStats && discordStats.member_count > 0) {
          const saveResult = await recordServerStats(db, serverId, discordStats);
          log.info(`[Stats] Recorded initial stats for guild ${serverId}: ${discordStats.member_count} members, result:`, saveResult);
        } else {
          log.warn(`[Stats] Discord API returned no valid member count for ${serverId}`);
        }
      }

      // Run stats aggregation on-demand to ensure chart data exists
      // This is safe to run multiple times - it will only process new data
      try {
        const aggregationResult = await runStatsAggregation(db, serverId);
        if (aggregationResult.hourly.periodsProcessed > 0 || aggregationResult.daily.periodsProcessed > 0) {
          log.info(`[Stats] On-demand aggregation for ${serverId}: ${aggregationResult.hourly.periodsProcessed} hourly, ${aggregationResult.daily.periodsProcessed} daily periods`);
        }
      } catch (aggError) {
        log.warn(`[Stats] On-demand aggregation failed for ${serverId}:`, aggError);
        // Continue - we can still show whatever data exists
      }

      // Now fetch all statistics including aggregated data
      const timezone = parentData.timezone || null;

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
      ] = await Promise.all([
        getGuildStatistics(db, serverId, timezone),
        getActivityHeatmap(db, serverId, timezone),
        getCategoryTrends(db, serverId, timezone),
        getRecentAutomationExecutions(db, serverId, 15),
        getAutomationExecutionHistory(db, serverId, timezone),
        // Member stats from server_stats
        Promise.all([
          getLatestServerStats(db, serverId),
          getMemberCountChanges(db, serverId, timezone),
          getPeakMemberCount(db, serverId, "30d"),
        ]).then(([latest, changes, peak]) => ({ latest, changes, peak })),
        getServerStatsHistory(db, serverId, { period: "30d", granularity: "daily", timezone }),
        // Aggregated voice activity
        getVoiceActivitySummary(db, serverId, "7d"),
        // Aggregated member growth
        getMemberGrowthSummary(db, serverId, "7d"),
        // Chart data for beautiful graphs
        getMemberGrowthChart(db, serverId, "30d", timezone),
        getVoiceActivityChart(db, serverId, "30d", timezone),
        // Top users for voice, video, and screenshare
        getTopVoiceUsers(db, serverId, 10),
        getTopVideoUsers(db, serverId, 10),
        getTopScreenshareUsers(db, serverId, 10),
      ]);
      // Fetch guild metadata for boost features display
      try {
        guildMetadata = await getGuildMetadata(db, serverId);
      } catch (metaError) {
        log.warn(`[Stats] Failed to fetch guild metadata for ${serverId}:`, metaError);
      }
    } catch (error) {
      log.error("Failed to fetch statistics:", error);
    }
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
    guildMetadata,
    eventCategories: EVENT_CATEGORIES,
    user: parentData.user,
    isSuperAdmin,
  };
}
