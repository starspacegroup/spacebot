/**
 * Statistics database functions
 * Provides comprehensive analytics and metrics for the dashboard
 */

import { log } from "$lib/log.js";

/**
 * Get comprehensive statistics for a guild
 * @param {D1Database} db - D1 database binding
 * @param {string} guildId - Guild ID
 * @returns {Promise<Object>} - Comprehensive statistics object
 */
export async function getGuildStatistics(db, guildId) {
  if (!db) {
    return getEmptyStats();
  }

  try {
    const [
      eventStats,
      automationStats,
      commandStats,
      timeSeriesData,
      topActors,
      topChannels,
      automationPerformance,
      commandUsage,
    ] = await Promise.all([
      getEventStatistics(db, guildId),
      getAutomationStatistics(db, guildId),
      getCommandStatistics(db, guildId),
      getTimeSeriesData(db, guildId),
      getTopActors(db, guildId),
      getTopChannels(db, guildId),
      getAutomationPerformance(db, guildId),
      getCommandUsageStats(db, guildId),
    ]);

    return {
      events: eventStats,
      automations: automationStats,
      commands: commandStats,
      timeSeries: timeSeriesData,
      topActors,
      topChannels,
      automationPerformance,
      commandUsage,
    };
  } catch (error) {
    log.error("Failed to fetch guild statistics:", error);
    return getEmptyStats();
  }
}

/**
 * Get empty statistics object for fallback
 */
function getEmptyStats() {
  return {
    events: {
      total: 0,
      today: 0,
      thisWeek: 0,
      thisMonth: 0,
      byCategory: {},
      byType: [],
    },
    automations: {
      total: 0,
      active: 0,
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
    },
    commands: {
      total: 0,
      active: 0,
      totalUsage: 0,
    },
    timeSeries: {
      hourly: [],
      daily: [],
      weekly: [],
    },
    topActors: [],
    topChannels: [],
    automationPerformance: [],
    commandUsage: [],
  };
}

/**
 * Get event statistics
 */
async function getEventStatistics(db, guildId) {
  const [totalResult, todayResult, weekResult, monthResult, categoryResult, typeResult] = await Promise.all([
    // Total events
    db.prepare(`SELECT COUNT(*) as count FROM event_logs WHERE guild_id = ?`).bind(guildId).first(),
    
    // Events today
    db.prepare(`
      SELECT COUNT(*) as count FROM event_logs 
      WHERE guild_id = ? AND created_at >= datetime('now', '-1 day')
    `).bind(guildId).first(),
    
    // Events this week
    db.prepare(`
      SELECT COUNT(*) as count FROM event_logs 
      WHERE guild_id = ? AND created_at >= datetime('now', '-7 days')
    `).bind(guildId).first(),
    
    // Events this month
    db.prepare(`
      SELECT COUNT(*) as count FROM event_logs 
      WHERE guild_id = ? AND created_at >= datetime('now', '-30 days')
    `).bind(guildId).first(),
    
    // Events by category
    db.prepare(`
      SELECT event_category, COUNT(*) as count 
      FROM event_logs 
      WHERE guild_id = ?
      GROUP BY event_category
      ORDER BY count DESC
    `).bind(guildId).all(),
    
    // Top event types
    db.prepare(`
      SELECT event_type, event_category, COUNT(*) as count 
      FROM event_logs 
      WHERE guild_id = ?
      GROUP BY event_type
      ORDER BY count DESC
      LIMIT 15
    `).bind(guildId).all(),
  ]);

  return {
    total: totalResult?.count || 0,
    today: todayResult?.count || 0,
    thisWeek: weekResult?.count || 0,
    thisMonth: monthResult?.count || 0,
    byCategory: Object.fromEntries(
      (categoryResult.results || []).map((r) => [r.event_category, r.count])
    ),
    byType: typeResult.results || [],
  };
}

/**
 * Get automation statistics
 */
async function getAutomationStatistics(db, guildId) {
  const [totalResult, activeResult, executionsResult] = await Promise.all([
    // Total automations
    db.prepare(`SELECT COUNT(*) as count FROM automations WHERE guild_id = ?`).bind(guildId).first(),
    
    // Active automations
    db.prepare(`SELECT COUNT(*) as count FROM automations WHERE guild_id = ? AND enabled = 1`).bind(guildId).first(),
    
    // Execution stats
    db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed
      FROM automation_logs 
      WHERE guild_id = ?
    `).bind(guildId).first(),
  ]);

  return {
    total: totalResult?.count || 0,
    active: activeResult?.count || 0,
    totalExecutions: executionsResult?.total || 0,
    successfulExecutions: executionsResult?.successful || 0,
    failedExecutions: executionsResult?.failed || 0,
  };
}

/**
 * Get command statistics
 */
async function getCommandStatistics(db, guildId) {
  const [totalResult, activeResult, usageResult] = await Promise.all([
    // Total commands
    db.prepare(`SELECT COUNT(*) as count FROM commands WHERE guild_id = ?`).bind(guildId).first(),
    
    // Active commands
    db.prepare(`SELECT COUNT(*) as count FROM commands WHERE guild_id = ? AND enabled = 1`).bind(guildId).first(),
    
    // Total usage
    db.prepare(`SELECT SUM(use_count) as total FROM commands WHERE guild_id = ?`).bind(guildId).first(),
  ]);

  return {
    total: totalResult?.count || 0,
    active: activeResult?.count || 0,
    totalUsage: usageResult?.total || 0,
  };
}

/**
 * Get time series data for charts
 */
async function getTimeSeriesData(db, guildId) {
  const [hourlyResult, dailyResult, weeklyResult] = await Promise.all([
    // Hourly (last 24 hours)
    db.prepare(`
      SELECT 
        strftime('%Y-%m-%d %H:00', created_at) as period,
        COUNT(*) as count
      FROM event_logs 
      WHERE guild_id = ? AND created_at >= datetime('now', '-24 hours')
      GROUP BY strftime('%Y-%m-%d %H:00', created_at)
      ORDER BY period ASC
    `).bind(guildId).all(),
    
    // Daily (last 30 days)
    db.prepare(`
      SELECT 
        strftime('%Y-%m-%d', created_at) as period,
        COUNT(*) as count
      FROM event_logs 
      WHERE guild_id = ? AND created_at >= datetime('now', '-30 days')
      GROUP BY strftime('%Y-%m-%d', created_at)
      ORDER BY period ASC
    `).bind(guildId).all(),
    
    // Weekly (last 12 weeks)
    db.prepare(`
      SELECT 
        strftime('%Y-W%W', created_at) as period,
        COUNT(*) as count
      FROM event_logs 
      WHERE guild_id = ? AND created_at >= datetime('now', '-84 days')
      GROUP BY strftime('%Y-W%W', created_at)
      ORDER BY period ASC
    `).bind(guildId).all(),
  ]);

  return {
    hourly: hourlyResult.results || [],
    daily: dailyResult.results || [],
    weekly: weeklyResult.results || [],
  };
}

/**
 * Get top actors (users who triggered events)
 */
async function getTopActors(db, guildId) {
  const result = await db.prepare(`
    SELECT 
      actor_id,
      actor_name,
      COUNT(*) as event_count,
      COUNT(DISTINCT event_type) as event_types
    FROM event_logs 
    WHERE guild_id = ? AND actor_id IS NOT NULL
    GROUP BY actor_id
    ORDER BY event_count DESC
    LIMIT 10
  `).bind(guildId).all();

  return result.results || [];
}

/**
 * Get top channels by activity
 */
async function getTopChannels(db, guildId) {
  const result = await db.prepare(`
    SELECT 
      channel_id,
      channel_name,
      COUNT(*) as event_count,
      COUNT(DISTINCT event_type) as event_types
    FROM event_logs 
    WHERE guild_id = ? AND channel_id IS NOT NULL
    GROUP BY channel_id
    ORDER BY event_count DESC
    LIMIT 10
  `).bind(guildId).all();

  return result.results || [];
}

/**
 * Get automation performance metrics
 */
async function getAutomationPerformance(db, guildId) {
  const result = await db.prepare(`
    SELECT 
      a.id,
      a.name,
      a.trigger_count,
      a.last_triggered_at,
      COUNT(al.id) as log_count,
      SUM(CASE WHEN al.success = 1 THEN 1 ELSE 0 END) as success_count,
      AVG(al.execution_time_ms) as avg_execution_time
    FROM automations a
    LEFT JOIN automation_logs al ON a.id = al.automation_id
    WHERE a.guild_id = ?
    GROUP BY a.id
    ORDER BY a.trigger_count DESC
    LIMIT 10
  `).bind(guildId).all();

  return result.results || [];
}

/**
 * Get command usage statistics
 */
async function getCommandUsageStats(db, guildId) {
  const result = await db.prepare(`
    SELECT 
      id,
      name,
      description,
      use_count,
      last_used_at,
      enabled
    FROM commands 
    WHERE guild_id = ?
    ORDER BY use_count DESC
    LIMIT 10
  `).bind(guildId).all();

  return result.results || [];
}

/**
 * Get activity heatmap data (events by hour of day and day of week)
 * @param {D1Database} db - D1 database binding
 * @param {string} guildId - Guild ID
 * @returns {Promise<Array>} - Heatmap data array
 */
export async function getActivityHeatmap(db, guildId) {
  if (!db) return [];

  try {
    const result = await db.prepare(`
      SELECT 
        CAST(strftime('%w', created_at) AS INTEGER) as day_of_week,
        CAST(strftime('%H', created_at) AS INTEGER) as hour,
        COUNT(*) as count
      FROM event_logs 
      WHERE guild_id = ? AND created_at >= datetime('now', '-30 days')
      GROUP BY day_of_week, hour
      ORDER BY day_of_week, hour
    `).bind(guildId).all();

    return result.results || [];
  } catch (error) {
    log.error("Failed to fetch activity heatmap:", error);
    return [];
  }
}

/**
 * Get event category breakdown with trends
 * @param {D1Database} db - D1 database binding
 * @param {string} guildId - Guild ID
 * @returns {Promise<Array>} - Category trends
 */
export async function getCategoryTrends(db, guildId) {
  if (!db) return [];

  try {
    const result = await db.prepare(`
      SELECT 
        event_category,
        strftime('%Y-%m-%d', created_at) as date,
        COUNT(*) as count
      FROM event_logs 
      WHERE guild_id = ? AND created_at >= datetime('now', '-14 days')
      GROUP BY event_category, date
      ORDER BY date ASC, event_category
    `).bind(guildId).all();

    return result.results || [];
  } catch (error) {
    log.error("Failed to fetch category trends:", error);
    return [];
  }
}

/**
 * Get recent automation executions
 * @param {D1Database} db - D1 database binding
 * @param {string} guildId - Guild ID
 * @param {number} limit - Number of results
 * @returns {Promise<Array>} - Recent executions
 */
export async function getRecentAutomationExecutions(db, guildId, limit = 10) {
  if (!db) return [];

  try {
    const result = await db.prepare(`
      SELECT 
        al.id,
        al.automation_id,
        a.name as automation_name,
        al.trigger_event,
        al.success,
        al.error_message,
        al.execution_time_ms,
        al.created_at
      FROM automation_logs al
      JOIN automations a ON al.automation_id = a.id
      WHERE al.guild_id = ?
      ORDER BY al.created_at DESC
      LIMIT ?
    `).bind(guildId, limit).all();

    return result.results || [];
  } catch (error) {
    log.error("Failed to fetch recent automation executions:", error);
    return [];
  }
}
