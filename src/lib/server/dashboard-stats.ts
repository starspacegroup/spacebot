import { getBuiltInCommands, getGuildCommands } from "$lib/db/commands.js";
import { getLogStats, log } from "$lib/db/logger.js";
import { getGuildSettings, normalizeLocalRunnerAssistPolicy } from "$lib/db/settings.js";
import { getGuildStatistics } from "$lib/db/statistics.js";
import { syncServerStatsIfStale } from "$lib/db/server-stats.js";
import { getMemberGrowthChart, getVoiceActivityChart, runStatsAggregation } from "$lib/db/stats-aggregation.js";
import { getAutomations } from "$lib/db/automations.js";
import { getGuildIntegrations } from "$lib/db/integrations.js";
import { getServerPlan } from "$lib/db/server-plans.js";
import { listAIJobsForGuild } from "$lib/db/ai-orchestration.js";

// Shared by the admin/[serverId] page load (cache-read path) and the
// /api/admin/[serverId]/dashboard-stats endpoint (the client-side fetch that
// replaces the old goto(invalidateAll) hotload — see that route for why).
export const DASHBOARD_CACHE_FRESH_MS = 20 * 1000;
export const DASHBOARD_CACHE_STALE_MS = 10 * 60 * 1000;
export const DASHBOARD_CACHE = (globalThis as any).__spacebotDashboardCache ||= new Map();

export function getDashboardCacheEntry(serverId) {
  const cachedEntry = DASHBOARD_CACHE.get(serverId);
  const cacheAgeMs = cachedEntry ? Date.now() - cachedEntry.cachedAt : Number.POSITIVE_INFINITY;
  return {
    cachedEntry,
    hasFreshCache: cacheAgeMs <= DASHBOARD_CACHE_FRESH_MS,
    hasStaleCache: cacheAgeMs <= DASHBOARD_CACHE_STALE_MS,
  };
}

/**
 * Fetch a channel's info from Discord API
 * @param {string} botToken - The bot token
 * @param {string} channelId - The channel ID to fetch
 * @returns {Promise<{id: string, name: string} | null>}
 */
async function getChannelInfo(botToken, channelId) {
  if (!botToken || !channelId) return null;

  try {
    const response = await fetch(
      `https://discord.com/api/v10/channels/${channelId}`,
      {
        headers: {
          Authorization: `Bot ${botToken}`,
        },
      },
    );

    if (!response.ok) return null;

    const channel = await response.json();
    return { id: channel.id, name: channel.name };
  } catch {
    return null;
  }
}

/**
 * Run the full set of Discord API calls, stats aggregation, and D1 queries
 * behind the admin dashboard's "Statistics" section, then cache the result.
 * Skips the forced multi-day repair window on aggregation and the full
 * member-list pagination on stats sync — those are interactive-load-path
 * optimizations; the background cron keeps both fully accurate over time.
 * @returns {Promise<{success: true, data: object} | {success: false, error: unknown}>}
 */
export async function fetchDashboardLiveData(db, serverId, botToken, timezone) {
  try {
    const syncedStats = await syncServerStatsIfStale(db, serverId, botToken);

    try {
      await runStatsAggregation(db, serverId, { repair: false });
    } catch (aggError) {
      log.warn(`[Dashboard] On-demand aggregation failed for ${serverId}:`, aggError);
    }

    const [
      stats,
      settings,
      guildStats,
      memberStats,
      memberGrowth,
      voiceActivity,
      builtIn,
      automationsResult,
      guildCommands,
      guildIntegrations,
      serverPlan,
    ] = await Promise.all([
      getLogStats(db, serverId),
      getGuildSettings(db, serverId),
      getGuildStatistics(db, serverId, timezone || null),
      Promise.resolve(syncedStats.latest),
      getMemberGrowthChart(db, serverId, "30d", timezone || null),
      getVoiceActivityChart(db, serverId, "30d", timezone || null),
      getBuiltInCommands(db),
      getAutomations(db, serverId, { limit: 1000 }),
      getGuildCommands(db, serverId),
      getGuildIntegrations(db, serverId),
      getServerPlan(db, serverId),
    ]);

    const allAutomations = automationsResult.automations || [];
    const activeAutomations = allAutomations.filter((a) => a.enabled).length;
    const activeCommands = guildCommands.filter((c) => c.enabled).length;
    const enabledIntegrations = guildIntegrations.filter((i) => i.guild_enabled).length;
    const featureCounts = {
      automations: { active: activeAutomations, inactive: allAutomations.length - activeAutomations, total: allAutomations.length },
      commands: { active: activeCommands, inactive: guildCommands.length - activeCommands, total: guildCommands.length },
      integrations: { active: enabledIntegrations, inactive: guildIntegrations.filter((i) => !i.guild_enabled && (i.connected_at || i.guild_enabled)).length, total: guildIntegrations.filter((i) => i.connected_at || i.guild_enabled).length },
    };
    const planLimits = {
      max_automations: serverPlan.max_automations,
      max_commands: serverPlan.max_commands,
      plan: serverPlan.plan || "free",
    };
    const localRunnerAssist = normalizeLocalRunnerAssistPolicy(settings?.permission_settings?.localRunnerAssist);

    let aiAutopilotSummary = {
      total: 0,
      pending: 0,
      running: 0,
      completed: 0,
      failed_terminal: 0,
      canceled: 0,
      latest: null,
    };
    if (localRunnerAssist.enabled) {
      const aiJobs = await listAIJobsForGuild(db, serverId, { limit: 100 });
      aiAutopilotSummary = {
        total: aiJobs.length,
        pending: aiJobs.filter((job) => job.status === "pending").length,
        running: aiJobs.filter((job) => job.status === "running").length,
        completed: aiJobs.filter((job) => job.status === "completed").length,
        failed_terminal: aiJobs.filter((job) => job.status === "failed_terminal").length,
        canceled: aiJobs.filter((job) => job.status === "canceled").length,
        latest: aiJobs[0]
          ? {
              id: aiJobs[0].id,
              correlationId: aiJobs[0].correlation_id,
              status: aiJobs[0].status,
              requestText: aiJobs[0].request_text,
              attemptCount: aiJobs[0].attempt_count,
              maxAttempts: aiJobs[0].max_attempts,
              updatedAt: aiJobs[0].updated_at,
            }
          : null,
      };
    }

    const basicStats = {
      members: memberStats?.member_count || 0,
      humanMembers: memberStats?.human_count || 0,
      totalEvents: guildStats?.events?.total || 0,
      eventsToday: guildStats?.events?.today || 0,
    };

    // Resolve the logging channel name once per live fetch and cache it —
    // doing this on every request added a Discord API round-trip even to
    // fully cached page loads.
    let loggingChannelName = null;
    if (settings?.log_channel_id && botToken) {
      const channelInfo = await getChannelInfo(botToken, settings.log_channel_id);
      loggingChannelName = channelInfo?.name ?? null;
    }

    const data = {
      logStats: stats,
      settings: {
        loggingChannelId: settings.log_channel_id || null,
        loggingChannelName,
      },
      basicStats,
      memberGrowthChartData: memberGrowth || [],
      voiceActivityChartData: voiceActivity || [],
      activityChartData: guildStats?.timeSeries?.daily || [],
      builtInCmds: builtIn || [],
      featureCounts,
      planLimits,
      localRunnerAssist,
      aiAutopilotSummary,
    };

    DASHBOARD_CACHE.set(serverId, { cachedAt: Date.now(), data });

    return { success: true, data };
  } catch (error) {
    log.error("Failed to fetch live dashboard data:", error);
    return { success: false, error };
  }
}
