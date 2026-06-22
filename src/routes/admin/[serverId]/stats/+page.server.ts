import { redirect } from "@sveltejs/kit";
import { EVENT_CATEGORIES } from "$lib/db/logger.js";
import { getGuildMetadata } from "$lib/db/guild-metadata.js";
import { getServerPlan, PLAN_TIERS } from "$lib/db/server-plans.js";
import {
  LIVE_UPDATE_TOKEN_TTL_SECONDS,
  signLiveUpdateAccess,
} from "$lib/live-updates.js";
import { getStatsCacheEntry, statsCacheKey } from "$lib/server/stats-page-data.js";

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

  const db = (platform as any)?.env?.DB;

  const plan = db
    ? await getServerPlan(db, serverId)
    : { plan: "free", ...PLAN_TIERS.free, guild_id: serverId };
  const statsRetentionDays = plan?.stats_retention_days ?? PLAN_TIERS.free.stats_retention_days;
  const periodOptions = buildPeriodOptions(statsRetentionDays);
  const selectedPeriod = normalizeSelectedPeriod(url.searchParams.get("period"), periodOptions);
  const selectedPeriodOption = periodOptions.find((option) => option.value === selectedPeriod) || periodOptions[0];
  const timezone = parentData.timezone || null;

  // Cheap, always-fresh — used for the per-server accent theme in the root
  // layout, so it shouldn't wait on the cache/hotload cycle below.
  const guildMetadata = db ? await getGuildMetadata(db, serverId) : null;

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

  // Heavy stats (Discord API calls, stats aggregation, ~18 D1 queries) are
  // never fetched inline here. A warm cache (written by the
  // /api/admin/[serverId]/stats-data endpoint) is served directly; a cold
  // cache renders a shell immediately and the client fetches that endpoint
  // itself, showing loading skeletons in the meantime — see +page.svelte.
  const { cachedEntry, hasFreshCache, hasStaleCache } = getStatsCacheEntry(statsCacheKey(serverId, selectedPeriod, timezone));
  if (hasStaleCache && cachedEntry?.data) {
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
    cachedRoles = cachedEntry.data.cachedRoles;
    liveVoiceSnapshot = cachedEntry.data.liveVoiceSnapshot;
    loadMeta = {
      source: "cache",
      needsHotload: false,
      isStale: !hasFreshCache,
      updatedAt: new Date(cachedEntry.cachedAt).toISOString(),
    };
  } else if (db) {
    // Only signal a hotload when one can actually succeed (db present),
    // otherwise the page would show loading skeletons forever.
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
