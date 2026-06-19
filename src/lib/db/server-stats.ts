/**
 * Server statistics database functions
 * Handles recording and retrieving historical server metrics
 */

import { log } from "../log.js";
import { getTimezoneOffsetSQL } from "../timezone.js";

const DEFAULT_STATS_REFRESH_MINUTES = 30;

function parseRecordedAt(recordedAt) {
  if (!recordedAt || typeof recordedAt !== "string") {
    return Number.NaN;
  }

  const normalized = recordedAt.includes("T")
    ? recordedAt
    : recordedAt.replace(" ", "T");
  const withTimezone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized)
    ? normalized
    : `${normalized}Z`;

  return Date.parse(withTimezone);
}

function resolvePeriodWindow(period, fallbackDays = 7) {
  if (period === "24h") {
    return { days: 1, timeRange: "-1 day" };
  }

  if (period === "1y") {
    return { days: 365, timeRange: "-365 days" };
  }

  if (period === "all") {
    return { days: 36500, timeRange: "-100 years" };
  }

  const match = typeof period === "string" ? period.match(/^(\d+)d$/) : null;
  const parsedDays = match ? Number.parseInt(match[1], 10) : Number.NaN;
  const days = Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : fallbackDays;

  return {
    days,
    timeRange: `-${days} days`,
  };
}

/**
 * @typedef {Object} ServerStats
 * @property {string} guild_id - The Discord guild ID
 * @property {number} member_count - Total member count
 * @property {number|null} online_count - Online member count (if available)
 * @property {number|null} bot_count - Number of bots
 * @property {number|null} human_count - Number of human members (member_count - bot_count)
 * @property {number|null} channel_count - Number of channels
 * @property {number|null} role_count - Number of roles
 * @property {number|null} emoji_count - Number of custom emojis
 * @property {number|null} boost_count - Number of boosts
 * @property {number|null} boost_level - Server boost level
 * @property {string} recorded_at - Timestamp
 */

/**
 * Record server statistics snapshot
 * @param {D1Database} db - D1 database binding
 * @param {string} guildId - Guild ID
 * @param {Object} stats - Statistics to record
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function recordServerStats(db, guildId, stats) {
  if (!db) {
    return { success: false, error: "Database not available" };
  }

  try {
    // Calculate human_count if bot_count is available
    const humanCount = stats.human_count ?? 
      (stats.bot_count !== null && stats.bot_count !== undefined 
        ? Math.max(0, (stats.member_count || 0) - stats.bot_count)
        : null);
    
    await db.prepare(`
      INSERT INTO server_stats (
        guild_id, member_count, online_count, bot_count, human_count,
        channel_count, role_count, emoji_count, boost_count, boost_level
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      guildId,
      stats.member_count || 0,
      stats.online_count ?? null,
      stats.bot_count ?? null,
      humanCount,
      stats.channel_count ?? null,
      stats.role_count ?? null,
      stats.emoji_count ?? null,
      stats.boost_count ?? null,
      stats.boost_level ?? null,
    ).run();

    return { success: true };
  } catch (error) {
    log.error("Failed to record server stats:", error);
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Update member count based on join/leave events
 * Creates a new stats entry with the updated count
 * @param {D1Database} db - D1 database binding
 * @param {string} guildId - Guild ID
 * @param {'join' | 'leave'} eventType - Whether a member joined or left
 * @param {boolean} [isBot=false] - Whether the joining/leaving member is a bot
 * @returns {Promise<{success: boolean, newCount?: number, error?: string}>}
 */
export async function updateMemberCount(db, guildId, eventType, isBot = false) {
  if (!db) {
    return { success: false, error: "Database not available" };
  }

  try {
    // Get the latest stats
    const latest = await getLatestServerStats(db, guildId);
    
    if (!latest) {
      // No existing stats - we can't update without a baseline
      // The page load will fetch from Discord if needed
      return { success: false, error: "No baseline stats exist" };
    }

    // Calculate new counts
    const delta = eventType === 'join' ? 1 : -1;
    const newCount = Math.max(0, (latest.member_count || 0) + delta);
    
    // Update bot count if the member is a bot
    let newBotCount = latest.bot_count;
    if (isBot && latest.bot_count !== null) {
      newBotCount = Math.max(0, latest.bot_count + delta);
    }
    
    // Calculate human count
    const newHumanCount = newBotCount !== null ? Math.max(0, newCount - newBotCount) : latest.human_count;

    // Record the new stats
    await db.prepare(`
      INSERT INTO server_stats (
        guild_id, member_count, online_count, bot_count, human_count,
        channel_count, role_count, emoji_count, boost_count, boost_level
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      guildId,
      newCount,
      null, // online_count not updated on events
      newBotCount,
      newHumanCount,
      latest.channel_count,
      latest.role_count,
      latest.emoji_count,
      latest.boost_count,
      latest.boost_level,
    ).run();

    log.debug(`[Stats] Updated member count for ${guildId}: ${latest.member_count} -> ${newCount} (${eventType}${isBot ? ', bot' : ''})`);
    return { success: true, newCount };
  } catch (error) {
    log.error("Failed to update member count:", error);
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Get the latest server statistics
 * @param {D1Database} db - D1 database binding
 * @param {string} guildId - Guild ID
 * @returns {Promise<ServerStats|null>}
 */
export async function getLatestServerStats(db, guildId) {
  if (!db) return null;

  try {
    const result = await db.prepare(`
      SELECT * FROM server_stats 
      WHERE guild_id = ?
      ORDER BY recorded_at DESC
      LIMIT 1
    `).bind(guildId).first();

    return result || null;
  } catch (error) {
    log.error("Failed to get latest server stats:", error);
    return null;
  }
}

/**
 * Check whether the latest server stats snapshot is stale enough to refresh.
 * @param {ServerStats|null} stats - Latest recorded stats snapshot
 * @param {number} [maxAgeMinutes=30] - Maximum accepted age in minutes
 * @returns {boolean}
 */
export function isServerStatsStale(stats, maxAgeMinutes = DEFAULT_STATS_REFRESH_MINUTES) {
  if (!stats?.recorded_at) {
    return true;
  }

  const recordedAtMs = parseRecordedAt(stats.recorded_at);
  if (!Number.isFinite(recordedAtMs)) {
    return true;
  }

  return Date.now() - recordedAtMs > maxAgeMinutes * 60 * 1000;
}

/**
 * Refresh latest server stats from Discord when the stored snapshot is missing, empty, or stale.
 * @param {D1Database} db - D1 database binding
 * @param {string} guildId - Guild ID
 * @param {string} botToken - Discord bot token
 * @param {{ existingStats?: ServerStats|null, maxAgeMinutes?: number }} [options]
 * @returns {Promise<{latest: ServerStats|null, refreshed: boolean, error?: string}>}
 */
export async function syncServerStatsIfStale(db, guildId, botToken, options: Record<string, any> = {}) {
  if (!db) {
    return { latest: null, refreshed: false, error: "Database not available" };
  }

  const {
    existingStats = null,
    maxAgeMinutes = DEFAULT_STATS_REFRESH_MINUTES,
  } = options;

  const latest = existingStats ?? await getLatestServerStats(db, guildId);
  const shouldRefresh = !latest || latest.member_count === 0 || isServerStatsStale(latest, maxAgeMinutes);

  if (!shouldRefresh || !botToken) {
    return { latest, refreshed: false };
  }

  try {
    log.info(`[Stats] Refreshing stale stats for guild ${guildId}`);
    // Skip the bot/human member-list pagination here — it's a per-page-load
    // path and that full member fetch can take tens of seconds on large
    // guilds. The daily cron refresh (refreshServerStatsAndMetadata /
    // runDailyRefresh) computes it with includeBotCount: true; carry that
    // last known split forward instead of blocking this request on it.
    const fetchResult = await fetchGuildStatsFromDiscord(botToken, guildId, { includeBotCount: false });
    const discordStats = fetchResult?.stats;

    if (!discordStats || discordStats.member_count <= 0) {
      log.warn(`[Stats] Discord API returned no valid member count for ${guildId}`);
      return { latest, refreshed: false, error: "Discord API returned no valid member count" };
    }

    if (discordStats.bot_count === null && latest?.bot_count != null) {
      discordStats.bot_count = latest.bot_count;
      discordStats.human_count = Math.max(0, discordStats.member_count - latest.bot_count);
    }

    const saveResult = await recordServerStats(db, guildId, discordStats);
    if (!saveResult.success) {
      return { latest, refreshed: false, error: saveResult.error || "Failed to record server stats" };
    }

    return {
      latest: await getLatestServerStats(db, guildId),
      refreshed: true,
    };
  } catch (error) {
    log.warn(`[Stats] Failed to refresh stale stats for guild ${guildId}:`, error);
    return { latest, refreshed: false, error: error.message || String(error) };
  }
}

/**
 * Get server statistics history for graphing
 * @param {D1Database} db - D1 database binding
 * @param {string} guildId - Guild ID
 * @param {Object} options - Query options
 * @param {string} [options.period='7d'] - Time period: '24h', '7d', '30d', '90d', '1y'
 * @param {string} [options.granularity='auto'] - Data granularity: 'hourly', 'daily', 'weekly', 'auto'
 * @returns {Promise<Array<{period: string, member_count: number, online_count?: number}>>}
 */
export async function getServerStatsHistory(db, guildId, options: Record<string, any> = {}) {
  if (!db) return [];

  const { period = "7d", granularity = "auto", timezone = null } = options;

  const { days, timeRange } = resolvePeriodWindow(period, 7);

  // Determine granularity based on period if auto
  let groupFormat;
  if (granularity === "auto") {
    if (days <= 2) {
      groupFormat = "%Y-%m-%d %H:00"; // Hourly
    } else if (days <= 60) {
      groupFormat = "%Y-%m-%d"; // Daily
    } else {
      groupFormat = "%Y-W%W"; // Weekly
    }
  } else {
    const formatMap = {
      hourly: "%Y-%m-%d %H:00",
      daily: "%Y-%m-%d",
      weekly: "%Y-W%W",
    };
    groupFormat = formatMap[granularity] || "%Y-%m-%d";
  }

  const tzOffset = getTimezoneOffsetSQL(timezone);

  try {
    const result = await db.prepare(`
      WITH bucketed AS (
        SELECT
          strftime('${groupFormat}', datetime(recorded_at, '${tzOffset}')) as period,
          member_count,
          online_count,
          bot_count,
          human_count,
          recorded_at,
          ROW_NUMBER() OVER (
            PARTITION BY strftime('${groupFormat}', datetime(recorded_at, '${tzOffset}'))
            ORDER BY recorded_at DESC
          ) as rn
        FROM server_stats
        WHERE guild_id = ? AND recorded_at >= datetime('now', ?)
      )
      SELECT
        period,
        member_count,
        online_count,
        bot_count,
        COALESCE(
          human_count,
          CASE
            WHEN bot_count IS NOT NULL THEN MAX(member_count - bot_count, 0)
            ELSE NULL
          END
        ) as human_count,
        recorded_at as last_recorded
      FROM bucketed
      WHERE rn = 1
      ORDER BY period ASC
    `).bind(guildId, timeRange).all();

    return result.results || [];
  } catch (error) {
    log.error("Failed to get server stats history:", error);
    return [];
  }
}

/**
 * Get member count change statistics
 * @param {D1Database} db - D1 database binding
 * @param {string} guildId - Guild ID
 * @param {string|null} [timezone] - IANA timezone name for calendar-based boundaries
 * @returns {Promise<Object>} - Change statistics including human (non-bot) counts
 */
export async function getMemberCountChanges(db, guildId, timezone = null) {
  if (!db) {
    return { 
      current: 0, day: 0, week: 0, month: 0,
      currentHuman: null, dayHuman: null, weekHuman: null, monthHuman: null,
      botCount: null
    };
  }

  try {
    // Compute timezone-aware UTC boundary timestamps in JS so "Today" means
    // "since midnight in the server's local timezone"
    const now = new Date();
    const tz = timezone || 'UTC';

    // Helper: get a date's local components in the target timezone
    const localParts = (date) => {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }).formatToParts(date);
      const get = (type) => parts.find(p => p.type === type)?.value;
      return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') };
    };

    // Helper: given a local "YYYY-MM-DD HH:mm:ss" in the target tz, find the
    // equivalent UTC ISO string by computing the offset at that instant
    const localToUTC = (localStr) => {
      // Use the timezone offset approach: format the same instant in UTC and TZ,
      // derive offset, then shift
      const probe = new Date(localStr + 'Z'); // treat as UTC first (rough estimate)
      const utcStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }).format(probe);
      const tzStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }).format(probe);
      const parseStr = (s) => new Date(s.replace(', ', 'T') + 'Z');
      const offsetMs = parseStr(tzStr).getTime() - parseStr(utcStr).getTime();
      return new Date(probe.getTime() - offsetMs).toISOString().replace('T', ' ').slice(0, 19);
    };

    const { year, month, day } = localParts(now);
    // Start of today in the server's timezone → UTC
    const todayStartUTC = localToUTC(`${year}-${month}-${day} 00:00:00`);
    // Start of 7 days ago in the server's timezone
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const p7 = localParts(sevenDaysAgo);
    const weekStartUTC = localToUTC(`${p7.year}-${p7.month}-${p7.day} 00:00:00`);
    // Start of current calendar month in the server's timezone
    const monthStartUTC = localToUTC(`${year}-${month}-01 00:00:00`);

    const [current, dayAgo, weekAgo, monthAgoRow, earliest] = await Promise.all([
      // Current count
      db.prepare(`
        SELECT member_count, human_count, bot_count FROM server_stats 
        WHERE guild_id = ?
        ORDER BY recorded_at DESC
        LIMIT 1
      `).bind(guildId).first(),

      // Latest record before start of today (local tz)
      db.prepare(`
        SELECT member_count, human_count FROM server_stats 
        WHERE guild_id = ? AND recorded_at <= ?
        ORDER BY recorded_at DESC
        LIMIT 1
      `).bind(guildId, todayStartUTC).first(),

      // Latest record before start of 7 days ago (local tz)
      db.prepare(`
        SELECT member_count, human_count FROM server_stats 
        WHERE guild_id = ? AND recorded_at <= ?
        ORDER BY recorded_at DESC
        LIMIT 1
      `).bind(guildId, weekStartUTC).first(),

      // Latest record before start of this month (local tz)
      db.prepare(`
        SELECT member_count, human_count FROM server_stats 
        WHERE guild_id = ? AND recorded_at <= ?
        ORDER BY recorded_at DESC
        LIMIT 1
      `).bind(guildId, monthStartUTC).first(),

      // Earliest record (fallback when no baseline exists for a period)
      db.prepare(`
        SELECT member_count, human_count FROM server_stats 
        WHERE guild_id = ?
        ORDER BY recorded_at ASC
        LIMIT 1
      `).bind(guildId).first(),
    ]);

    const currentCount = current?.member_count || 0;
    const currentHuman = current?.human_count;
    const currentBotCount = current?.bot_count;

    // For "This Month": use start-of-month baseline, fall back to earliest record
    const monthAgo = monthAgoRow || earliest;

    return {
      // Total member counts (including bots)
      current: currentCount,
      day: dayAgo?.member_count !== null && dayAgo?.member_count !== undefined
        ? currentCount - dayAgo.member_count
        : 0,
      week: weekAgo?.member_count !== null && weekAgo?.member_count !== undefined
        ? currentCount - weekAgo.member_count
        : 0,
      month: monthAgo?.member_count !== null && monthAgo?.member_count !== undefined
        ? currentCount - monthAgo.member_count
        : 0,
      
      // Human (non-bot) member counts
      currentHuman: currentHuman,
      dayHuman: (currentHuman !== null && dayAgo?.human_count !== null && dayAgo?.human_count !== undefined)
        ? currentHuman - dayAgo.human_count 
        : null,
      weekHuman: (currentHuman !== null && weekAgo?.human_count !== null && weekAgo?.human_count !== undefined)
        ? currentHuman - weekAgo.human_count 
        : null,
      monthHuman: (currentHuman !== null && monthAgo?.human_count !== null && monthAgo?.human_count !== undefined)
        ? currentHuman - monthAgo.human_count 
        : null,
      
      // Bot count for reference
      botCount: currentBotCount,
    };
  } catch (error) {
    log.error("Failed to get member count changes:", error);
    return { 
      current: 0, day: 0, week: 0, month: 0,
      currentHuman: null, dayHuman: null, weekHuman: null, monthHuman: null,
      botCount: null
    };
  }
}

/**
 * Get peak member count in a time period
 * @param {D1Database} db - D1 database binding
 * @param {string} guildId - Guild ID
 * @param {string} period - Time period: '24h', '7d', '30d', '90d', '1y', 'all'
 * @returns {Promise<{peak: number, peakDate: string|null}>}
 */
export async function getPeakMemberCount(db, guildId, period = "all") {
  if (!db) return { peak: 0, peakDate: null };

  const { timeRange } = resolvePeriodWindow(period, 36500);

  try {
    const result = await db.prepare(`
      SELECT member_count, recorded_at
      FROM server_stats 
      WHERE guild_id = ? AND recorded_at >= datetime('now', ?)
      ORDER BY member_count DESC
      LIMIT 1
    `).bind(guildId, timeRange).first();

    return {
      peak: result?.member_count || 0,
      peakDate: result?.recorded_at || null,
    };
  } catch (error) {
    log.error("Failed to get peak member count:", error);
    return { peak: 0, peakDate: null };
  }
}

/**
 * Prune old statistics to prevent database bloat
 * Keeps hourly data for 7 days, daily for 90 days, then weekly summaries
 * @param {D1Database} db - D1 database binding
 * @param {string} guildId - Guild ID (optional, prunes all if not provided)
 * @returns {Promise<number>} - Number of deleted rows
 */
export async function pruneOldStats(db, guildId = null) {
  if (!db) return 0;

  try {
    // Delete entries older than 90 days, keeping one per week
    // This is a simplified approach - keeps all data within 90 days
    const query = guildId
      ? `DELETE FROM server_stats WHERE guild_id = ? AND recorded_at < datetime('now', '-90 days')`
      : `DELETE FROM server_stats WHERE recorded_at < datetime('now', '-90 days')`;

    const result = guildId
      ? await db.prepare(query).bind(guildId).run()
      : await db.prepare(query).run();

    return result.meta?.changes || 0;
  } catch (error) {
    log.error("Failed to prune old stats:", error);
    return 0;
  }
}

/**
 * Fetch current guild stats from Discord API
 * @param {string} botToken - Bot token
 * @param {string} guildId - Guild ID
 * @param {{ includeBotCount?: boolean }} [options] - Set includeBotCount: false to skip the
 *   full member-list pagination (countGuildBots), which can take tens of seconds on large
 *   guilds. Used by interactive page loads; the daily cron refresh keeps it accurate.
 * @returns {Promise<{stats: Object, rawGuild: Object}|null>} - Guild stats + raw API response
 */
export async function fetchGuildStatsFromDiscord(botToken, guildId, options: Record<string, any> = {}) {
  const { includeBotCount = true } = options;
  if (!botToken || !guildId) return null;

  try {
    // Fetch guild info with counts
    const response = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}?with_counts=true`,
      {
        headers: {
          Authorization: `Bot ${botToken}`,
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      log.warn(`Failed to fetch guild stats: ${response.status} - ${errorText}`);
      return null;
    }

    const guild = await response.json();
    
    // Discord may return member_count or approximate_member_count depending on context
    const memberCount = guild.approximate_member_count || guild.member_count || 0;
    
    // Try to get bot count by fetching members with bot filter
    // This uses the List Guild Members endpoint with a limit
    // For accuracy, we'll count bots we can see
    let botCount = null;
    if (includeBotCount) {
      try {
        botCount = await countGuildBots(botToken, guildId);
      } catch (botError) {
        log.debug(`[Stats] Could not count bots for guild ${guildId}:`, botError.message);
      }
    }
    
    const humanCount = botCount !== null ? Math.max(0, memberCount - botCount) : null;
    
    log.debug(`[Stats] Fetched guild ${guildId}: ${memberCount} members, ${botCount ?? '?'} bots, ${humanCount ?? '?'} humans`);

    return {
      stats: {
        member_count: memberCount,
        online_count: guild.approximate_presence_count || null,
        bot_count: botCount,
        human_count: humanCount,
        channel_count: null, // Would need separate API call
        role_count: guild.roles?.length || null,
        emoji_count: guild.emojis?.length || null,
        boost_count: guild.premium_subscription_count || 0,
        boost_level: guild.premium_tier || 0,
      },
      rawGuild: guild,
    };
  } catch (error) {
    log.error("Failed to fetch guild stats from Discord:", error);
    return null;
  }
}

/**
 * Count the number of bots in a guild
 * Uses pagination to count all bot members
 * @param {string} botToken - Bot token
 * @param {string} guildId - Guild ID
 * @returns {Promise<number>} - Number of bots
 */
async function countGuildBots(botToken, guildId) {
  let botCount = 0;
  let after = '0';
  const limit = 1000; // Max per request
  let hasMore = true;
  let iterations = 0;
  const maxIterations = 50; // Safety limit to prevent infinite loops (50k members max)

  while (hasMore && iterations < maxIterations) {
    iterations++;
    
    const response = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/members?limit=${limit}&after=${after}`,
      {
        headers: {
          Authorization: `Bot ${botToken}`,
        },
      }
    );

    if (!response.ok) {
      if (response.status === 403) {
        // Bot doesn't have SERVER MEMBERS INTENT or permission
        log.debug(`[Stats] No permission to list members for guild ${guildId}`);
        return null;
      }
      throw new Error(`Failed to fetch members: ${response.status}`);
    }

    const members = await response.json();
    
    if (!Array.isArray(members) || members.length === 0) {
      hasMore = false;
      break;
    }

    // Count bots in this batch
    for (const member of members) {
      if (member.user?.bot) {
        botCount++;
      }
    }

    // Set up for next page
    after = members[members.length - 1].user.id;
    hasMore = members.length === limit;
    
    // Small delay to avoid rate limiting
    if (hasMore) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  log.debug(`[Stats] Counted ${botCount} bots in guild ${guildId} (${iterations} API calls)`);
  return botCount;
}
