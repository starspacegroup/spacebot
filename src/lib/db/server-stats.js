/**
 * Server statistics database functions
 * Handles recording and retrieving historical server metrics
 */

import { log } from "$lib/log.js";

/**
 * @typedef {Object} ServerStats
 * @property {string} guild_id - The Discord guild ID
 * @property {number} member_count - Total member count
 * @property {number|null} online_count - Online member count (if available)
 * @property {number|null} bot_count - Number of bots
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
    await db.prepare(`
      INSERT INTO server_stats (
        guild_id, member_count, online_count, bot_count,
        channel_count, role_count, emoji_count, boost_count, boost_level
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      guildId,
      stats.member_count || 0,
      stats.online_count ?? null,
      stats.bot_count ?? null,
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
 * @returns {Promise<{success: boolean, newCount?: number, error?: string}>}
 */
export async function updateMemberCount(db, guildId, eventType) {
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

    // Calculate new count
    const delta = eventType === 'join' ? 1 : -1;
    const newCount = Math.max(0, (latest.member_count || 0) + delta);

    // Record the new stats
    await db.prepare(`
      INSERT INTO server_stats (
        guild_id, member_count, online_count, bot_count,
        channel_count, role_count, emoji_count, boost_count, boost_level
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      guildId,
      newCount,
      null, // online_count not updated on events
      latest.bot_count,
      latest.channel_count,
      latest.role_count,
      latest.emoji_count,
      latest.boost_count,
      latest.boost_level,
    ).run();

    log.debug(`[Stats] Updated member count for ${guildId}: ${latest.member_count} -> ${newCount} (${eventType})`);
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
 * Get server statistics history for graphing
 * @param {D1Database} db - D1 database binding
 * @param {string} guildId - Guild ID
 * @param {Object} options - Query options
 * @param {string} [options.period='7d'] - Time period: '24h', '7d', '30d', '90d', '1y'
 * @param {string} [options.granularity='auto'] - Data granularity: 'hourly', 'daily', 'weekly', 'auto'
 * @returns {Promise<Array<{period: string, member_count: number, online_count?: number}>>}
 */
export async function getServerStatsHistory(db, guildId, options = {}) {
  if (!db) return [];

  const { period = "7d", granularity = "auto" } = options;

  // Calculate time range
  const periodMap = {
    "24h": "-1 day",
    "7d": "-7 days",
    "30d": "-30 days",
    "90d": "-90 days",
    "1y": "-365 days",
  };
  const timeRange = periodMap[period] || "-7 days";

  // Determine granularity based on period if auto
  let groupFormat;
  if (granularity === "auto") {
    if (period === "24h") {
      groupFormat = "%Y-%m-%d %H:00"; // Hourly
    } else if (period === "7d" || period === "30d") {
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

  try {
    const result = await db.prepare(`
      SELECT 
        strftime('${groupFormat}', recorded_at) as period,
        ROUND(AVG(member_count)) as member_count,
        ROUND(AVG(online_count)) as online_count,
        ROUND(AVG(bot_count)) as bot_count,
        MAX(recorded_at) as last_recorded
      FROM server_stats 
      WHERE guild_id = ? AND recorded_at >= datetime('now', ?)
      GROUP BY strftime('${groupFormat}', recorded_at)
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
 * @returns {Promise<Object>} - Change statistics
 */
export async function getMemberCountChanges(db, guildId) {
  if (!db) {
    return { current: 0, dayChange: 0, weekChange: 0, monthChange: 0 };
  }

  try {
    const [current, dayAgo, weekAgo, monthAgo] = await Promise.all([
      // Current count
      db.prepare(`
        SELECT member_count FROM server_stats 
        WHERE guild_id = ?
        ORDER BY recorded_at DESC
        LIMIT 1
      `).bind(guildId).first(),

      // 24 hours ago
      db.prepare(`
        SELECT member_count FROM server_stats 
        WHERE guild_id = ? AND recorded_at <= datetime('now', '-1 day')
        ORDER BY recorded_at DESC
        LIMIT 1
      `).bind(guildId).first(),

      // 7 days ago
      db.prepare(`
        SELECT member_count FROM server_stats 
        WHERE guild_id = ? AND recorded_at <= datetime('now', '-7 days')
        ORDER BY recorded_at DESC
        LIMIT 1
      `).bind(guildId).first(),

      // 30 days ago
      db.prepare(`
        SELECT member_count FROM server_stats 
        WHERE guild_id = ? AND recorded_at <= datetime('now', '-30 days')
        ORDER BY recorded_at DESC
        LIMIT 1
      `).bind(guildId).first(),
    ]);

    const currentCount = current?.member_count || 0;

    return {
      current: currentCount,
      dayChange: dayAgo?.member_count ? currentCount - dayAgo.member_count : 0,
      weekChange: weekAgo?.member_count ? currentCount - weekAgo.member_count : 0,
      monthChange: monthAgo?.member_count ? currentCount - monthAgo.member_count : 0,
    };
  } catch (error) {
    log.error("Failed to get member count changes:", error);
    return { current: 0, dayChange: 0, weekChange: 0, monthChange: 0 };
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

  const periodMap = {
    "24h": "-1 day",
    "7d": "-7 days",
    "30d": "-30 days",
    "90d": "-90 days",
    "1y": "-365 days",
    all: "-100 years",
  };
  const timeRange = periodMap[period] || "-100 years";

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
 * @returns {Promise<Object|null>} - Guild statistics
 */
export async function fetchGuildStatsFromDiscord(botToken, guildId) {
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
    
    log.debug(`[Stats] Fetched guild ${guildId}: ${memberCount} members (approximate: ${guild.approximate_member_count}, exact: ${guild.member_count})`);

    return {
      member_count: memberCount,
      online_count: guild.approximate_presence_count || null,
      channel_count: null, // Would need separate API call
      role_count: guild.roles?.length || null,
      emoji_count: guild.emojis?.length || null,
      boost_count: guild.premium_subscription_count || 0,
      boost_level: guild.premium_tier || 0,
    };
  } catch (error) {
    log.error("Failed to fetch guild stats from Discord:", error);
    return null;
  }
}
