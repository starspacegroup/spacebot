/**
 * Stats aggregation module
 * Handles building aggregated statistics from event logs
 * Smart enough to skip data that's already been processed
 */

import { log } from "../log.js";
import { getTimezoneOffsetSQL } from "../timezone.js";

/**
 * @typedef {Object} AggregationResult
 * @property {boolean} success
 * @property {number} periodsProcessed - Number of periods that were aggregated
 * @property {number} eventsProcessed - Number of events processed
 * @property {string} [error]
 */

/**
 * Get the processing checkpoint for a guild
 * @param {D1Database} db
 * @param {string} guildId
 * @param {string} checkpointType - 'hourly', 'daily', 'voice_sessions'
 * @returns {Promise<{lastEventId: number, lastProcessedAt: string|null}>}
 */
async function getCheckpoint(db, guildId, checkpointType) {
  try {
    const result = await db.prepare(`
      SELECT last_processed_event_id, last_processed_at
      FROM stats_processing_checkpoint
      WHERE guild_id = ? AND checkpoint_type = ?
    `).bind(guildId, checkpointType).first();

    return {
      lastEventId: result?.last_processed_event_id || 0,
      lastProcessedAt: result?.last_processed_at || null,
    };
  } catch {
    return { lastEventId: 0, lastProcessedAt: null };
  }
}

/**
 * Update the processing checkpoint
 * @param {D1Database} db
 * @param {string} guildId
 * @param {string} checkpointType
 * @param {number} lastEventId
 */
async function updateCheckpoint(db, guildId, checkpointType, lastEventId) {
  await db.prepare(`
    INSERT INTO stats_processing_checkpoint (guild_id, checkpoint_type, last_processed_event_id, last_processed_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(guild_id, checkpoint_type) 
    DO UPDATE SET last_processed_event_id = ?, last_processed_at = datetime('now')
  `).bind(guildId, checkpointType, lastEventId, lastEventId).run();
}

/**
 * Process voice sessions from VOICE_JOIN/VOICE_LEAVE events
 * Creates session records for accurate time tracking
 * @param {D1Database} db
 * @param {string} guildId
 * @returns {Promise<{processed: number, sessionsCreated: number, sessionsClosed: number}>}
 */
async function processVoiceSessions(db, guildId) {
  const checkpoint = await getCheckpoint(db, guildId, "voice_sessions");
  
  // Get unprocessed voice events
  const events = await db.prepare(`
    SELECT id, event_type, actor_id, channel_id, channel_name, created_at
    FROM event_logs
    WHERE guild_id = ? 
      AND id > ?
      AND event_type IN ('VOICE_JOIN', 'VOICE_LEAVE', 'VOICE_MOVE')
    ORDER BY id ASC
    LIMIT 1000
  `).bind(guildId, checkpoint.lastEventId).all();

  if (!events.results?.length) {
    return { processed: 0, sessionsCreated: 0, sessionsClosed: 0 };
  }

  let sessionsCreated = 0;
  let sessionsClosed = 0;
  let lastEventId = checkpoint.lastEventId;

  for (const event of events.results) {
    lastEventId = event.id;

    if (event.event_type === "VOICE_JOIN") {
      // Create a new session
      await db.prepare(`
        INSERT INTO voice_sessions (guild_id, user_id, channel_id, channel_name, joined_at, join_event_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        guildId,
        event.actor_id,
        event.channel_id,
        event.channel_name,
        event.created_at,
        event.id
      ).run();
      sessionsCreated++;
    } else if (event.event_type === "VOICE_LEAVE") {
      // Close the most recent open session for this user
      const result = await db.prepare(`
        UPDATE voice_sessions
        SET 
          left_at = ?,
          leave_event_id = ?,
          duration_seconds = CAST((julianday(?) - julianday(joined_at)) * 86400 AS INTEGER)
        WHERE guild_id = ? 
          AND user_id = ? 
          AND left_at IS NULL
          AND id = (
            SELECT id FROM voice_sessions 
            WHERE guild_id = ? AND user_id = ? AND left_at IS NULL
            ORDER BY joined_at DESC
            LIMIT 1
          )
      `).bind(
        event.created_at,
        event.id,
        event.created_at,
        guildId,
        event.actor_id,
        guildId,
        event.actor_id
      ).run();
      
      if (result.meta?.changes > 0) {
        sessionsClosed++;
      }
    } else if (event.event_type === "VOICE_MOVE") {
      // Close old session and create new one
      // First close the existing session
      await db.prepare(`
        UPDATE voice_sessions
        SET 
          left_at = ?,
          duration_seconds = CAST((julianday(?) - julianday(joined_at)) * 86400 AS INTEGER)
        WHERE guild_id = ? 
          AND user_id = ? 
          AND left_at IS NULL
      `).bind(event.created_at, event.created_at, guildId, event.actor_id).run();
      sessionsClosed++;

      // Then create new session in new channel
      await db.prepare(`
        INSERT INTO voice_sessions (guild_id, user_id, channel_id, channel_name, joined_at, join_event_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        guildId,
        event.actor_id,
        event.channel_id,
        event.channel_name,
        event.created_at,
        event.id
      ).run();
      sessionsCreated++;
    }
  }

  // Update checkpoint
  await updateCheckpoint(db, guildId, "voice_sessions", lastEventId);

  return {
    processed: events.results.length,
    sessionsCreated,
    sessionsClosed,
  };
}

/**
 * Build hourly aggregated statistics for a guild
 * @param {D1Database} db
 * @param {string} guildId
 * @returns {Promise<AggregationResult>}
 */
export async function buildHourlyStats(db, guildId) {
  if (!db) {
    return { success: false, periodsProcessed: 0, eventsProcessed: 0, error: "Database not available" };
  }

  try {
    // First, process any new voice sessions
    await processVoiceSessions(db, guildId);

    // Get the last fully processed hour
    const lastAggregated = await db.prepare(`
      SELECT MAX(period_end) as last_period
      FROM aggregated_stats
      WHERE guild_id = ? AND period_type = 'hourly'
    `).bind(guildId).first();

    // Determine start time for aggregation
    // If no previous data, start from the earliest available event (up to 90 days back)
    let startTime;
    if (lastAggregated?.last_period) {
      startTime = lastAggregated.last_period;
    } else {
      // Get the earliest event within the retention window
      const earliest = await db.prepare(`
        SELECT MIN(created_at) as earliest
        FROM event_logs
        WHERE guild_id = ? AND created_at >= datetime('now', '-90 days')
      `).bind(guildId).first();
      
      startTime = earliest?.earliest || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    }

    // Get hours that need processing (completed hours only, not the current hour)
    const hoursToProcess = await db.prepare(`
      SELECT DISTINCT 
        strftime('%Y-%m-%d %H:00:00', created_at) as period_start,
        strftime('%Y-%m-%d %H:00:00', created_at, '+1 hour') as period_end
      FROM event_logs
      WHERE guild_id = ? 
        AND created_at >= ?
        AND created_at < strftime('%Y-%m-%d %H:00:00', 'now')
      ORDER BY period_start ASC
    `).bind(guildId, startTime).all();

    if (!hoursToProcess.results?.length) {
      return { success: true, periodsProcessed: 0, eventsProcessed: 0 };
    }

    let totalEventsProcessed = 0;
    let periodsProcessed = 0;

    for (const period of hoursToProcess.results) {
      // Check if this period already exists
      const existing = await db.prepare(`
        SELECT id FROM aggregated_stats
        WHERE guild_id = ? AND period_type = 'hourly' AND period_start = ?
      `).bind(guildId, period.period_start).first();

      if (existing) {
        continue; // Skip already processed periods
      }

      // Aggregate member events
      const memberStats = await db.prepare(`
        SELECT 
          SUM(CASE WHEN event_type = 'MEMBER_JOIN' THEN 1 ELSE 0 END) as joins,
          SUM(CASE WHEN event_type = 'MEMBER_LEAVE' THEN 1 ELSE 0 END) as leaves
        FROM event_logs
        WHERE guild_id = ? 
          AND created_at >= ? 
          AND created_at < ?
          AND event_type IN ('MEMBER_JOIN', 'MEMBER_LEAVE')
      `).bind(guildId, period.period_start, period.period_end).first();

      // Aggregate voice activity from sessions
      const voiceStats = await db.prepare(`
        SELECT 
          COUNT(DISTINCT user_id) as unique_users,
          SUM(
            CASE 
              WHEN left_at IS NULL THEN 
                CAST((julianday(?) - julianday(MAX(joined_at, ?))) * 86400 AS INTEGER)
              WHEN left_at > ? AND joined_at < ? THEN
                CAST((julianday(MIN(left_at, ?)) - julianday(MAX(joined_at, ?))) * 86400 AS INTEGER)
              ELSE 0
            END
          ) as total_seconds
        FROM voice_sessions
        WHERE guild_id = ?
          AND joined_at < ?
          AND (left_at IS NULL OR left_at > ?)
      `).bind(
        period.period_end, period.period_start,
        period.period_start, period.period_end,
        period.period_end, period.period_start,
        guildId,
        period.period_end, period.period_start
      ).first();

      // Calculate peak concurrent voice users
      // First get the baseline: how many users were already in VC at the start of this period
      // Then layer on join/leave deltas within the period to find the true peak
      const baseline = await db.prepare(`
        SELECT COUNT(*) as count
        FROM voice_sessions
        WHERE guild_id = ?
          AND joined_at < ?
          AND (left_at IS NULL OR left_at >= ?)
      `).bind(guildId, period.period_start, period.period_start).first();

      const baselineCount = baseline?.count || 0;

      const peakConcurrent = await db.prepare(`
        WITH voice_events AS (
          SELECT 
            created_at as event_time,
            CASE 
              WHEN event_type = 'VOICE_JOIN' THEN 1
              WHEN event_type = 'VOICE_LEAVE' THEN -1
              ELSE 0
            END as delta
          FROM event_logs
          WHERE guild_id = ?
            AND created_at >= ?
            AND created_at < ?
            AND event_type IN ('VOICE_JOIN', 'VOICE_LEAVE')
        ),
        running_count AS (
          SELECT 
            event_time,
            ? + SUM(delta) OVER (ORDER BY event_time ROWS UNBOUNDED PRECEDING) as concurrent
          FROM voice_events
        )
        SELECT COALESCE(MAX(concurrent), ?) as peak
        FROM running_count
      `).bind(guildId, period.period_start, period.period_end, baselineCount, baselineCount).first();

      // Aggregate message activity
      const messageStats = await db.prepare(`
        SELECT 
          COUNT(*) as count,
          COUNT(DISTINCT actor_id) as unique_users
        FROM event_logs
        WHERE guild_id = ? 
          AND created_at >= ? 
          AND created_at < ?
          AND event_type = 'MESSAGE_CREATE'
      `).bind(guildId, period.period_start, period.period_end).first();

      // Total events
      const totalEvents = await db.prepare(`
        SELECT COUNT(*) as count, MAX(id) as last_id
        FROM event_logs
        WHERE guild_id = ? 
          AND created_at >= ? 
          AND created_at < ?
      `).bind(guildId, period.period_start, period.period_end).first();

      // Insert aggregated stats
      await db.prepare(`
        INSERT INTO aggregated_stats (
          guild_id, period_type, period_start, period_end,
          member_joins, member_leaves, member_net_change,
          voice_total_seconds, voice_unique_users, voice_peak_concurrent,
          message_count, message_unique_users,
          total_events, last_event_id
        ) VALUES (?, 'hourly', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        guildId,
        period.period_start,
        period.period_end,
        memberStats?.joins || 0,
        memberStats?.leaves || 0,
        (memberStats?.joins || 0) - (memberStats?.leaves || 0),
        voiceStats?.total_seconds || 0,
        voiceStats?.unique_users || 0,
        peakConcurrent?.peak || 0,
        messageStats?.count || 0,
        messageStats?.unique_users || 0,
        totalEvents?.count || 0,
        totalEvents?.last_id || null
      ).run();

      totalEventsProcessed += totalEvents?.count || 0;
      periodsProcessed++;
    }

    return { success: true, periodsProcessed, eventsProcessed: totalEventsProcessed };
  } catch (error) {
    log.error(`Failed to build hourly stats for ${guildId}:`, error);
    return { success: false, periodsProcessed: 0, eventsProcessed: 0, error: error.message || String(error) };
  }
}

/**
 * Build daily aggregated statistics by rolling up hourly data
 * @param {D1Database} db
 * @param {string} guildId
 * @returns {Promise<AggregationResult>}
 */
export async function buildDailyStats(db, guildId) {
  if (!db) {
    return { success: false, periodsProcessed: 0, eventsProcessed: 0, error: "Database not available" };
  }

  try {
    // Get the last fully processed day
    const lastAggregated = await db.prepare(`
      SELECT MAX(period_end) as last_period
      FROM aggregated_stats
      WHERE guild_id = ? AND period_type = 'daily'
    `).bind(guildId).first();

    // Get days that have hourly data and aren't today
    const daysToProcess = await db.prepare(`
      SELECT 
        strftime('%Y-%m-%d 00:00:00', period_start) as day_start,
        strftime('%Y-%m-%d 00:00:00', period_start, '+1 day') as day_end,
        COUNT(*) as hour_count
      FROM aggregated_stats
      WHERE guild_id = ? 
        AND period_type = 'hourly'
        AND period_start >= COALESCE(?, datetime('now', '-90 days'))
        AND period_start < strftime('%Y-%m-%d 00:00:00', 'now')
      GROUP BY strftime('%Y-%m-%d', period_start)
      HAVING hour_count >= 1
      ORDER BY day_start ASC
    `).bind(guildId, lastAggregated?.last_period).all();

    if (!daysToProcess.results?.length) {
      return { success: true, periodsProcessed: 0, eventsProcessed: 0 };
    }

    let periodsProcessed = 0;

    for (const day of daysToProcess.results) {
      // Check if this day already exists
      const existing = await db.prepare(`
        SELECT id FROM aggregated_stats
        WHERE guild_id = ? AND period_type = 'daily' AND period_start = ?
      `).bind(guildId, day.day_start).first();

      if (existing) {
        continue;
      }

      // Roll up hourly stats into daily
      const dayStats = await db.prepare(`
        SELECT 
          SUM(member_joins) as member_joins,
          SUM(member_leaves) as member_leaves,
          SUM(voice_total_seconds) as voice_total_seconds,
          MAX(voice_unique_users) as voice_unique_users,
          MAX(voice_peak_concurrent) as voice_peak_concurrent,
          SUM(message_count) as message_count,
          MAX(message_unique_users) as message_unique_users,
          SUM(total_events) as total_events,
          MAX(last_event_id) as last_event_id
        FROM aggregated_stats
        WHERE guild_id = ? 
          AND period_type = 'hourly'
          AND period_start >= ?
          AND period_start < ?
      `).bind(guildId, day.day_start, day.day_end).first();

      // Insert daily aggregation
      await db.prepare(`
        INSERT INTO aggregated_stats (
          guild_id, period_type, period_start, period_end,
          member_joins, member_leaves, member_net_change,
          voice_total_seconds, voice_unique_users, voice_peak_concurrent,
          message_count, message_unique_users,
          total_events, last_event_id
        ) VALUES (?, 'daily', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        guildId,
        day.day_start,
        day.day_end,
        dayStats?.member_joins || 0,
        dayStats?.member_leaves || 0,
        (dayStats?.member_joins || 0) - (dayStats?.member_leaves || 0),
        dayStats?.voice_total_seconds || 0,
        dayStats?.voice_unique_users || 0,
        dayStats?.voice_peak_concurrent || 0,
        dayStats?.message_count || 0,
        dayStats?.message_unique_users || 0,
        dayStats?.total_events || 0,
        dayStats?.last_event_id || null
      ).run();

      periodsProcessed++;
    }

    return { success: true, periodsProcessed, eventsProcessed: 0 };
  } catch (error) {
    log.error(`Failed to build daily stats for ${guildId}:`, error);
    return { success: false, periodsProcessed: 0, eventsProcessed: 0, error: error.message || String(error) };
  }
}

/**
 * Run full stats aggregation for a guild
 * @param {D1Database} db
 * @param {string} guildId
 * @returns {Promise<{hourly: AggregationResult, daily: AggregationResult}>}
 */
export async function runStatsAggregation(db, guildId) {
  const hourly = await buildHourlyStats(db, guildId);
  const daily = await buildDailyStats(db, guildId);
  
  return { hourly, daily };
}

/**
 * Get aggregated stats for display
 * @param {D1Database} db
 * @param {string} guildId
 * @param {Object} options
 * @param {'hourly'|'daily'} options.periodType
 * @param {string} options.startDate - ISO date string
 * @param {string} options.endDate - ISO date string
 * @returns {Promise<Array>}
 */
export async function getAggregatedStats(db, guildId, options = {}) {
  if (!db) return [];

  const { periodType = "daily", startDate, endDate } = options;

  let query = `
    SELECT * FROM aggregated_stats
    WHERE guild_id = ? AND period_type = ?
  `;
  const params = [guildId, periodType];

  if (startDate) {
    query += " AND period_start >= ?";
    params.push(startDate);
  }

  if (endDate) {
    query += " AND period_end <= ?";
    params.push(endDate);
  }

  query += " ORDER BY period_start ASC";

  try {
    const result = await db.prepare(query).bind(...params).all();
    return result.results || [];
  } catch (error) {
    log.error("Failed to get aggregated stats:", error);
    return [];
  }
}

/**
 * Get voice activity summary
 * @param {D1Database} db
 * @param {string} guildId
 * @param {'24h'|'7d'|'30d'} period
 * @returns {Promise<Object>}
 */
export async function getVoiceActivitySummary(db, guildId, period = "7d") {
  if (!db) {
    return { totalSeconds: 0, totalMinutes: 0, totalHours: 0, uniqueUsers: 0, avgSessionMinutes: 0 };
  }

  const periodMap = {
    "24h": "-1 day",
    "7d": "-7 days",
    "30d": "-30 days",
  };
  const timeRange = periodMap[period] || "-7 days";

  try {
    // Get from aggregated stats if available
    const aggregated = await db.prepare(`
      SELECT 
        SUM(voice_total_seconds) as total_seconds,
        MAX(voice_unique_users) as unique_users
      FROM aggregated_stats
      WHERE guild_id = ? 
        AND period_type = 'hourly'
        AND period_start >= datetime('now', ?)
    `).bind(guildId, timeRange).first();

    // Get session stats for more detail
    const sessions = await db.prepare(`
      SELECT 
        COUNT(*) as session_count,
        COUNT(DISTINCT user_id) as unique_users,
        AVG(duration_seconds) as avg_duration
      FROM voice_sessions
      WHERE guild_id = ? 
        AND joined_at >= datetime('now', ?)
        AND duration_seconds IS NOT NULL
    `).bind(guildId, timeRange).first();

    const totalSeconds = aggregated?.total_seconds || 0;

    return {
      totalSeconds,
      totalMinutes: Math.round(totalSeconds / 60),
      totalHours: Math.round(totalSeconds / 3600 * 10) / 10,
      uniqueUsers: sessions?.unique_users || aggregated?.unique_users || 0,
      sessionCount: sessions?.session_count || 0,
      avgSessionMinutes: Math.round((sessions?.avg_duration || 0) / 60),
    };
  } catch (error) {
    log.error("Failed to get voice activity summary:", error);
    return { totalSeconds: 0, totalMinutes: 0, totalHours: 0, uniqueUsers: 0, avgSessionMinutes: 0 };
  }
}

/**
 * Get member growth summary
 * @param {D1Database} db
 * @param {string} guildId
 * @param {'24h'|'7d'|'30d'} period
 * @returns {Promise<Object>}
 */
export async function getMemberGrowthSummary(db, guildId, period = "7d") {
  if (!db) {
    return { joins: 0, leaves: 0, netChange: 0, dailyAverage: 0 };
  }

  const periodMap = {
    "24h": { sql: "-1 day", days: 1 },
    "7d": { sql: "-7 days", days: 7 },
    "30d": { sql: "-30 days", days: 30 },
  };
  const { sql: timeRange, days } = periodMap[period] || periodMap["7d"];

  try {
    const stats = await db.prepare(`
      SELECT 
        SUM(member_joins) as joins,
        SUM(member_leaves) as leaves,
        SUM(member_net_change) as net_change
      FROM aggregated_stats
      WHERE guild_id = ? 
        AND period_type = 'hourly'
        AND period_start >= datetime('now', ?)
    `).bind(guildId, timeRange).first();

    const joins = stats?.joins || 0;
    const leaves = stats?.leaves || 0;
    const netChange = stats?.net_change || (joins - leaves);

    return {
      joins,
      leaves,
      netChange,
      dailyAverage: Math.round((netChange / days) * 10) / 10,
    };
  } catch (error) {
    log.error("Failed to get member growth summary:", error);
    return { joins: 0, leaves: 0, netChange: 0, dailyAverage: 0 };
  }
}

/**
 * Clean up old voice sessions and aggregated data
 * @param {D1Database} db
 * @param {string} [guildId] - Optional guild ID, cleans all if not provided
 * @returns {Promise<{sessionsDeleted: number, aggregatesDeleted: number}>}
 */
export async function cleanupOldData(db, guildId = null) {
  if (!db) return { sessionsDeleted: 0, aggregatesDeleted: 0 };

  try {
    // Delete completed voice sessions older than 90 days
    const sessionsQuery = guildId
      ? `DELETE FROM voice_sessions WHERE guild_id = ? AND left_at IS NOT NULL AND left_at < datetime('now', '-90 days')`
      : `DELETE FROM voice_sessions WHERE left_at IS NOT NULL AND left_at < datetime('now', '-90 days')`;
    
    const sessionsResult = guildId
      ? await db.prepare(sessionsQuery).bind(guildId).run()
      : await db.prepare(sessionsQuery).run();

    // Delete hourly aggregates older than 30 days (daily summaries are sufficient)
    const hourlyQuery = guildId
      ? `DELETE FROM aggregated_stats WHERE guild_id = ? AND period_type = 'hourly' AND period_start < datetime('now', '-30 days')`
      : `DELETE FROM aggregated_stats WHERE period_type = 'hourly' AND period_start < datetime('now', '-30 days')`;
    
    const hourlyResult = guildId
      ? await db.prepare(hourlyQuery).bind(guildId).run()
      : await db.prepare(hourlyQuery).run();

    return {
      sessionsDeleted: sessionsResult.meta?.changes || 0,
      aggregatesDeleted: hourlyResult.meta?.changes || 0,
    };
  } catch (error) {
    log.error("Failed to cleanup old data:", error);
    return { sessionsDeleted: 0, aggregatesDeleted: 0 };
  }
}

/**
 * Get global member growth data across all guilds (for superadmin)
 * @param {D1Database} db
 * @param {'7d'|'30d'} period
 * @returns {Promise<Array<{date: string, joins: number, leaves: number, netChange: number}>>}
 */
export async function getGlobalMemberGrowthChart(db, period = "30d") {
  if (!db) return [];

  const days = period === "7d" ? 7 : 30;
  const timeRange = period === "7d" ? "-7 days" : "-30 days";

  try {
    const result = await db.prepare(`
      SELECT 
        date(period_start) as date,
        SUM(member_joins) as joins,
        SUM(member_leaves) as leaves,
        SUM(member_net_change) as net_change
      FROM aggregated_stats
      WHERE period_type = 'daily'
        AND period_start >= datetime('now', ?)
      GROUP BY date(period_start)
      ORDER BY date ASC
    `).bind(timeRange).all();

    const rawData = (result.results || []).map(row => ({
      date: row.date,
      joins: row.joins || 0,
      leaves: row.leaves || 0,
      netChange: row.net_change || 0,
    }));

    // Add today's partial data from hourly aggregations
    const today = getTodayDateString();
    const todayStats = await getTodayPartialStats(db, null);
    rawData.push({
      date: today,
      joins: todayStats.member_joins,
      leaves: todayStats.member_leaves,
      netChange: todayStats.member_net_change,
    });

    return fillDateGaps(rawData, days, { joins: 0, leaves: 0, netChange: 0 });
  } catch (error) {
    log.error("Failed to get global member growth chart:", error);
    return [];
  }
}

/**
 * Get global voice activity data across all guilds (for superadmin)
 * @param {D1Database} db
 * @param {'7d'|'30d'} period
 * @returns {Promise<Array<{date: string, totalMinutes: number, uniqueUsers: number}>>}
 */
export async function getGlobalVoiceActivityChart(db, period = "30d") {
  if (!db) return [];

  const days = period === "7d" ? 7 : 30;
  const timeRange = period === "7d" ? "-7 days" : "-30 days";

  try {
    const result = await db.prepare(`
      SELECT 
        date(period_start) as date,
        SUM(voice_total_seconds) as total_seconds,
        SUM(voice_unique_users) as unique_users
      FROM aggregated_stats
      WHERE period_type = 'daily'
        AND period_start >= datetime('now', ?)
      GROUP BY date(period_start)
      ORDER BY date ASC
    `).bind(timeRange).all();

    const rawData = (result.results || []).map(row => ({
      date: row.date,
      totalMinutes: Math.round((row.total_seconds || 0) / 60),
      totalHours: Math.round((row.total_seconds || 0) / 3600 * 10) / 10,
      uniqueUsers: row.unique_users || 0,
    }));

    // Add today's partial data from hourly aggregations
    const today = getTodayDateString();
    const todayStats = await getTodayPartialStats(db, null);
    const todaySeconds = todayStats.voice_total_seconds;
    rawData.push({
      date: today,
      totalMinutes: Math.round(todaySeconds / 60),
      totalHours: Math.round(todaySeconds / 3600 * 10) / 10,
      uniqueUsers: todayStats.voice_unique_users,
    });

    return fillDateGaps(rawData, days, { totalMinutes: 0, totalHours: 0, uniqueUsers: 0 });
  } catch (error) {
    log.error("Failed to get global voice activity chart:", error);
    return [];
  }
}

/**
 * Get global totals across all guilds (for superadmin)
 * @param {D1Database} db
 * @param {'7d'|'30d'} period
 * @returns {Promise<Object>}
 */
export async function getGlobalStatsSummary(db, period = "30d") {
  if (!db) return {
    memberJoins: 0,
    memberLeaves: 0,
    memberNetChange: 0,
    voiceTotalHours: 0,
    voiceUniqueUsers: 0,
    totalMessages: 0,
    totalEvents: 0,
  };

  const timeRange = period === "30d" ? "-30 days" : "-7 days";

  try {
    const result = await db.prepare(`
      SELECT 
        SUM(member_joins) as member_joins,
        SUM(member_leaves) as member_leaves,
        SUM(member_net_change) as member_net_change,
        SUM(voice_total_seconds) as voice_total_seconds,
        SUM(voice_unique_users) as voice_unique_users,
        SUM(message_count) as message_count,
        SUM(total_events) as total_events
      FROM aggregated_stats
      WHERE period_type = 'daily'
        AND period_start >= datetime('now', ?)
    `).bind(timeRange).first();

    return {
      memberJoins: result?.member_joins || 0,
      memberLeaves: result?.member_leaves || 0,
      memberNetChange: result?.member_net_change || 0,
      voiceTotalHours: Math.round((result?.voice_total_seconds || 0) / 3600 * 10) / 10,
      voiceUniqueUsers: result?.voice_unique_users || 0,
      totalMessages: result?.message_count || 0,
      totalEvents: result?.total_events || 0,
    };
  } catch (error) {
    log.error("Failed to get global stats summary:", error);
    return {
      memberJoins: 0,
      memberLeaves: 0,
      memberNetChange: 0,
      voiceTotalHours: 0,
      voiceUniqueUsers: 0,
      totalMessages: 0,
      totalEvents: 0,
    };
  }
}

/**
 * Get today's date as YYYY-MM-DD string, adjusted for timezone
 * @param {string|null} timezone - IANA timezone name
 * @returns {string}
 */
function getTodayDateString(timezone = null) {
  if (!timezone) return new Date().toISOString().split('T')[0];
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    return parts; // en-CA gives YYYY-MM-DD format
  } catch {
    return new Date().toISOString().split('T')[0];
  }
}

/**
 * Get today's partial stats from hourly aggregations for a specific guild
 * @param {D1Database} db
 * @param {string|null} guildId - Guild ID, or null for global stats
 * @returns {Promise<{voice_total_seconds: number, voice_unique_users: number, voice_peak_concurrent: number, member_joins: number, member_leaves: number, member_net_change: number, message_count: number, message_unique_users: number, total_events: number}>}
 */
async function getTodayPartialStats(db, guildId = null) {
  const empty = {
    voice_total_seconds: 0,
    voice_unique_users: 0,
    voice_peak_concurrent: 0,
    member_joins: 0,
    member_leaves: 0,
    member_net_change: 0,
    message_count: 0,
    message_unique_users: 0,
    total_events: 0,
  };

  try {
    const guildFilter = guildId ? "AND guild_id = ?" : "";
    const params = guildId
      ? [guildId]
      : [];

    // Get stats from completed hourly aggregations for today
    const aggregated = await db.prepare(`
      SELECT 
        COALESCE(SUM(voice_total_seconds), 0) as voice_total_seconds,
        COALESCE(MAX(voice_unique_users), 0) as voice_unique_users,
        COALESCE(MAX(voice_peak_concurrent), 0) as voice_peak_concurrent,
        COALESCE(SUM(member_joins), 0) as member_joins,
        COALESCE(SUM(member_leaves), 0) as member_leaves,
        COALESCE(SUM(member_net_change), 0) as member_net_change,
        COALESCE(SUM(message_count), 0) as message_count,
        COALESCE(MAX(message_unique_users), 0) as message_unique_users,
        COALESCE(SUM(total_events), 0) as total_events
      FROM aggregated_stats
      WHERE period_type = 'hourly'
        AND period_start >= strftime('%Y-%m-%d 00:00:00', 'now')
        AND period_start < strftime('%Y-%m-%d 00:00:00', 'now', '+1 day')
        ${guildFilter}
    `).bind(...params).first();

    // Also count raw events from the current (incomplete) hour that haven't
    // been aggregated yet, so the chart stays in sync with the overview card.
    const currentHour = await db.prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN event_type = 'MEMBER_JOIN' THEN 1 ELSE 0 END), 0) as member_joins,
        COALESCE(SUM(CASE WHEN event_type = 'MEMBER_LEAVE' THEN 1 ELSE 0 END), 0) as member_leaves,
        COALESCE(SUM(CASE WHEN event_type = 'MESSAGE_CREATE' THEN 1 ELSE 0 END), 0) as message_count,
        COUNT(*) as total_events
      FROM event_logs
      WHERE created_at >= strftime('%Y-%m-%d %H:00:00', 'now')
        ${guildFilter}
    `).bind(...params).first();

    const result = aggregated || empty;
    if (currentHour) {
      result.member_joins += currentHour.member_joins || 0;
      result.member_leaves += currentHour.member_leaves || 0;
      result.member_net_change = result.member_joins - result.member_leaves;
      result.message_count += currentHour.message_count || 0;
      result.total_events += currentHour.total_events || 0;
    }

    return result;
  } catch (error) {
    log.error("Failed to get today's partial stats:", error);
    return empty;
  }
}

/**
 * Fill date gaps in chart data, ensuring every day in the range has an entry
 * @param {Array<Object>} data - Array of objects with a 'date' property (YYYY-MM-DD)
 * @param {number} days - Number of days to cover
 * @param {Object} defaults - Default values for missing days
 * @param {string|null} timezone - IANA timezone name for "today" calculation
 * @returns {Array<Object>} - Data with gaps filled
 */
function fillDateGaps(data, days, defaults = {}, timezone = null) {
  const todayStr = getTodayDateString(timezone);
  const today = new Date(todayStr + 'T00:00:00Z');
  const dateMap = new Map();
  
  // Index existing data by date
  for (const row of data) {
    dateMap.set(row.date, row);
  }
  
  const filled = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    
    if (dateMap.has(dateStr)) {
      filled.push(dateMap.get(dateStr));
    } else {
      filled.push({ date: dateStr, ...defaults });
    }
  }
  
  return filled;
}

/**
 * Get member growth chart data for a specific server
 * @param {D1Database} db
 * @param {string} guildId
 * @param {'7d'|'30d'} period
 * @returns {Promise<Array<{date: string, joins: number, leaves: number, netChange: number}>>}
 */
export async function getMemberGrowthChart(db, guildId, period = "30d", timezone = null) {
  if (!db || !guildId) return [];

  const days = period === "7d" ? 7 : 30;
  const timeRange = period === "7d" ? "-7 days" : "-30 days";
  const tzOffset = getTimezoneOffsetSQL(timezone);

  try {
    const result = await db.prepare(`
      SELECT 
        date(datetime(period_start, '${tzOffset}')) as date,
        member_joins as joins,
        member_leaves as leaves,
        member_net_change as net_change
      FROM aggregated_stats
      WHERE guild_id = ?
        AND period_type = 'daily'
        AND period_start >= datetime('now', ?)
      ORDER BY date ASC
    `).bind(guildId, timeRange).all();

    const rawData = (result.results || []).map(row => ({
      date: row.date,
      joins: row.joins || 0,
      leaves: row.leaves || 0,
      netChange: row.net_change || 0,
    }));

    // Add today's partial data from hourly aggregations
    const today = getTodayDateString(timezone);
    const todayStats = await getTodayPartialStats(db, guildId);
    rawData.push({
      date: today,
      joins: todayStats.member_joins,
      leaves: todayStats.member_leaves,
      netChange: todayStats.member_net_change,
    });

    // Fill in missing dates with zero values so the chart is continuous
    return fillDateGaps(rawData, days, { joins: 0, leaves: 0, netChange: 0 }, timezone);
  } catch (error) {
    log.error(`Failed to get member growth chart for guild ${guildId}:`, error);
    return [];
  }
}

/**
 * Get voice activity chart data for a specific server
 * @param {D1Database} db
 * @param {string} guildId
 * @param {'7d'|'30d'} period
 * @returns {Promise<Array<{date: string, totalMinutes: number, totalHours: number, uniqueUsers: number}>>}
 */
export async function getVoiceActivityChart(db, guildId, period = "30d", timezone = null) {
  if (!db || !guildId) return [];

  const days = period === "7d" ? 7 : 30;
  const timeRange = period === "7d" ? "-7 days" : "-30 days";
  const tzOffset = getTimezoneOffsetSQL(timezone);

  try {
    const result = await db.prepare(`
      SELECT 
        date(datetime(period_start, '${tzOffset}')) as date,
        voice_total_seconds as total_seconds,
        voice_unique_users as unique_users,
        voice_peak_concurrent as peak_concurrent
      FROM aggregated_stats
      WHERE guild_id = ?
        AND period_type = 'daily'
        AND period_start >= datetime('now', ?)
      ORDER BY date ASC
    `).bind(guildId, timeRange).all();

    const rawData = (result.results || []).map(row => ({
      date: row.date,
      totalMinutes: Math.round((row.total_seconds || 0) / 60),
      totalHours: Math.round((row.total_seconds || 0) / 3600 * 10) / 10,
      uniqueUsers: row.unique_users || 0,
      peakConcurrent: row.peak_concurrent || 0,
    }));

    // Add today's partial data from hourly aggregations
    const today = getTodayDateString(timezone);
    const todayStats = await getTodayPartialStats(db, guildId);
    const todaySeconds = todayStats.voice_total_seconds;
    rawData.push({
      date: today,
      totalMinutes: Math.round(todaySeconds / 60),
      totalHours: Math.round(todaySeconds / 3600 * 10) / 10,
      uniqueUsers: todayStats.voice_unique_users,
      peakConcurrent: todayStats.voice_peak_concurrent,
    });

    // Fill in missing dates with zero values so the chart is continuous
    return fillDateGaps(rawData, days, { totalMinutes: 0, totalHours: 0, uniqueUsers: 0, peakConcurrent: 0 }, timezone);
  } catch (error) {
    log.error(`Failed to get voice activity chart for guild ${guildId}:`, error);
    return [];
  }
}
