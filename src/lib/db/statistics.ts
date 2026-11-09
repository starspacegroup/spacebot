/**
 * Statistics database functions
 * Provides comprehensive analytics and metrics for the dashboard
 */

import { failed } from './load-failed.js';
import { log } from '../log.js';
import { getTimezoneOffsetSQL } from '../timezone.js';
import { enrichRowsWithActorAvatars } from './avatar-enrichment.js';

function parsePeriodDays(period, fallbackDays = 30) {
	if (period === '24h') return 1;

	const match = typeof period === 'string' ? period.match(/^(\d+)d$/) : null;
	if (!match) return fallbackDays;

	const days = Number.parseInt(match[1], 10);
	if (!Number.isFinite(days) || days < 1) return fallbackDays;

	return days;
}

/**
 * Get comprehensive statistics for a guild
 * @param {D1Database} db - D1 database binding
 * @param {string} guildId - Guild ID
 * @returns {Promise<Object>} - Comprehensive statistics object
 */
export async function getGuildStatistics(db, guildId, timezone = null, period = '30d') {
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
			getTimeSeriesData(db, guildId, timezone, period),
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
		log.error('Failed to fetch guild statistics:', error);
		// Flagged so the page does not cache zeros and show them as real numbers.
		return { ...getEmptyStats(), loadFailed: true };
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
export async function getEventStatistics(db, guildId) {
	// One pass over the server's events. This used to be ten separate queries, five of
	// which each read every event the server has ever logged; together they could trip
	// D1's "overloaded" limit and blank the whole Statistics page.
	const NOT_BOT = `NOT (
          actor_is_bot = 1
          OR LOWER(actor_name) LIKE '%bot%'
          OR LOWER(actor_name) LIKE '%disboard%'
          OR LOWER(actor_name) LIKE '%github%'
          OR LOWER(actor_name) LIKE '%mee6%'
          OR LOWER(actor_name) LIKE '%dyno%'
        )`;
	const { results } = await db
		.prepare(
			`SELECT
         event_category,
         event_type,
         COUNT(*) AS count,
         SUM(CASE WHEN ${NOT_BOT} THEN 1 ELSE 0 END) AS non_bot_count,
         SUM(CASE WHEN created_at >= datetime('now', '-1 day') THEN 1 ELSE 0 END) AS today,
         SUM(CASE WHEN created_at >= datetime('now', '-1 day') AND ${NOT_BOT} THEN 1 ELSE 0 END) AS today_non_bot,
         SUM(CASE WHEN created_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS week,
         SUM(CASE WHEN created_at >= datetime('now', '-7 days') AND ${NOT_BOT} THEN 1 ELSE 0 END) AS week_non_bot,
         SUM(CASE WHEN created_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END) AS month,
         SUM(CASE WHEN created_at >= datetime('now', '-30 days') AND ${NOT_BOT} THEN 1 ELSE 0 END) AS month_non_bot
       FROM event_logs
       WHERE guild_id = ?
       GROUP BY event_category, event_type`
		)
		.bind(guildId)
		.all();

	const rows = results || [];
	const sum = (key: string) => rows.reduce((n, r) => n + (r[key] || 0), 0);
	const byCategory = new Map<any, { count: number; nonBot: number }>();
	for (const r of rows) {
		const c = byCategory.get(r.event_category) ?? { count: 0, nonBot: 0 };
		c.count += r.count || 0;
		c.nonBot += r.non_bot_count || 0;
		byCategory.set(r.event_category, c);
	}
	const categories = [...byCategory.entries()].sort((a, b) => b[1].count - a[1].count);
	// One row per category and type; the top types are summed per type across categories.
	const byType = new Map<any, any>();
	for (const r of rows) {
		const t = byType.get(r.event_type) ?? {
			event_type: r.event_type,
			event_category: r.event_category,
			count: 0,
			non_bot_count: 0,
		};
		t.count += r.count || 0;
		t.non_bot_count += r.non_bot_count || 0;
		byType.set(r.event_type, t);
	}

	return {
		total: sum('count'),
		today: sum('today'),
		thisWeek: sum('week'),
		thisMonth: sum('month'),
		totalNonBot: sum('non_bot_count'),
		todayNonBot: sum('today_non_bot'),
		thisWeekNonBot: sum('week_non_bot'),
		thisMonthNonBot: sum('month_non_bot'),
		byCategory: Object.fromEntries(categories.map(([k, v]) => [k, v.count])),
		byCategoryNonBot: Object.fromEntries(categories.map(([k, v]) => [k, v.nonBot])),
		byType: [...byType.values()].sort((a, b) => b.count - a.count).slice(0, 20),
	};
}

/**
 * Get automation statistics
 */
async function getAutomationStatistics(db, guildId) {
	const [totalResult, activeResult, executionsResult] = await Promise.all([
		// Total automations
		db
			.prepare(`SELECT COUNT(*) as count FROM automations WHERE guild_id = ?`)
			.bind(guildId)
			.first(),

		// Active automations
		db
			.prepare(`SELECT COUNT(*) as count FROM automations WHERE guild_id = ? AND enabled = 1`)
			.bind(guildId)
			.first(),

		// Execution stats
		db
			.prepare(
				`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed
      FROM automation_logs 
      WHERE guild_id = ?
    `
			)
			.bind(guildId)
			.first(),
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
		db
			.prepare(`SELECT COUNT(*) as count FROM commands WHERE guild_id = ?`)
			.bind(guildId)
			.first(),

		// Active commands
		db
			.prepare(`SELECT COUNT(*) as count FROM commands WHERE guild_id = ? AND enabled = 1`)
			.bind(guildId)
			.first(),

		// Total usage
		db
			.prepare(`SELECT SUM(use_count) as total FROM commands WHERE guild_id = ?`)
			.bind(guildId)
			.first(),
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
async function getTimeSeriesData(db, guildId, timezone = null, period = '30d') {
	const days = parsePeriodDays(period, 30);
	const weeklyDays = Math.max(14, Math.min(days, 84));
	const tzOffset = getTimezoneOffsetSQL(timezone);

	const [hourlyResult, dailyResult, weeklyResult, dailyNonBotResult] = await Promise.all([
		// Hourly (last 24 hours) - shift to local timezone
		db
			.prepare(
				`
      SELECT 
        strftime('%Y-%m-%d %H:00', datetime(created_at, '${tzOffset}')) as period,
        COUNT(*) as count
      FROM event_logs 
      WHERE guild_id = ? AND created_at >= datetime('now', '-24 hours')
      GROUP BY strftime('%Y-%m-%d %H:00', datetime(created_at, '${tzOffset}'))
      ORDER BY period ASC
    `
			)
			.bind(guildId)
			.all(),

		// Daily (selected range) - shift to local timezone
		db
			.prepare(
				`
      SELECT 
        strftime('%Y-%m-%d', datetime(created_at, '${tzOffset}')) as period,
        COUNT(*) as count
      FROM event_logs 
      WHERE guild_id = ? AND created_at >= datetime('now', ?)
      GROUP BY strftime('%Y-%m-%d', datetime(created_at, '${tzOffset}'))
      ORDER BY period ASC
    `
			)
			.bind(guildId, `-${days} days`)
			.all(),

		// Weekly (bounded selected range) - shift to local timezone
		db
			.prepare(
				`
      SELECT 
        strftime('%Y-W%W', datetime(created_at, '${tzOffset}')) as period,
        COUNT(*) as count
      FROM event_logs 
      WHERE guild_id = ? AND created_at >= datetime('now', ?)
      GROUP BY strftime('%Y-W%W', datetime(created_at, '${tzOffset}'))
      ORDER BY period ASC
    `
			)
			.bind(guildId, `-${weeklyDays} days`)
			.all(),

		// Daily non-bot (selected range) - shift to local timezone
		db
			.prepare(
				`
      SELECT 
        strftime('%Y-%m-%d', datetime(created_at, '${tzOffset}')) as period,
        COUNT(*) as count
      FROM event_logs 
      WHERE guild_id = ? AND created_at >= datetime('now', ?)
        AND NOT (
          actor_is_bot = 1 
          OR LOWER(actor_name) LIKE '%bot%'
          OR LOWER(actor_name) LIKE '%disboard%'
          OR LOWER(actor_name) LIKE '%github%'
          OR LOWER(actor_name) LIKE '%mee6%'
          OR LOWER(actor_name) LIKE '%dyno%'
        )
      GROUP BY strftime('%Y-%m-%d', datetime(created_at, '${tzOffset}'))
      ORDER BY period ASC
      `
			)
			.bind(guildId, `-${days} days`)
			.all(),
	]);

	// Merge daily and dailyNonBot into array with both counts
	const dailyMap = new Map();
	for (const d of dailyResult.results || []) {
		dailyMap.set(d.period, { period: d.period, count: d.count, non_bot_count: 0 });
	}
	for (const d of dailyNonBotResult.results || []) {
		if (dailyMap.has(d.period)) {
			dailyMap.get(d.period).non_bot_count = d.count;
		} else {
			dailyMap.set(d.period, { period: d.period, count: 0, non_bot_count: d.count });
		}
	}
	const dailyMerged = Array.from(dailyMap.values()).sort((a, b) =>
		a.period.localeCompare(b.period)
	);

	return {
		hourly: hourlyResult.results || [],
		daily: dailyMerged,
		weekly: weeklyResult.results || [],
	};
}

/**
 * Get top actors (users who triggered events)
 */
async function getTopActors(db, guildId) {
	const result = await db
		.prepare(
			`
    SELECT 
      actor_id,
      actor_name,
      actor_is_bot,
      (
        SELECT l.actor_avatar
        FROM event_logs l
        WHERE l.guild_id = ?
          AND l.actor_id = event_logs.actor_id
          AND l.actor_avatar IS NOT NULL
        ORDER BY l.created_at DESC, l.id DESC
        LIMIT 1
      ) as actor_avatar,
      (
        SELECT COALESCE(l.actor_discriminator, '0')
        FROM event_logs l
        WHERE l.guild_id = ?
          AND l.actor_id = event_logs.actor_id
        ORDER BY l.created_at DESC, l.id DESC
        LIMIT 1
      ) as actor_discriminator,
      COUNT(*) as event_count,
      COUNT(DISTINCT event_type) as event_types
    FROM event_logs 
    WHERE guild_id = ? 
      AND actor_id IS NOT NULL
    GROUP BY actor_id
    ORDER BY event_count DESC
    LIMIT 20
  `
		)
		.bind(guildId, guildId, guildId)
		.all();

	return enrichRowsWithActorAvatars(db, guildId, result.results || []);
}

/**
 * Get top channels by activity
 */
async function getTopChannels(db, guildId) {
	const result = await db
		.prepare(
			`
    SELECT 
      channel_id,
      channel_name,
      COUNT(*) as event_count,
      SUM(CASE 
        WHEN actor_is_bot = 1 THEN 0
        WHEN LOWER(actor_name) LIKE '%bot%' THEN 0
        WHEN LOWER(actor_name) LIKE '%disboard%' THEN 0
        WHEN LOWER(actor_name) LIKE '%github%' THEN 0
        WHEN LOWER(actor_name) LIKE '%mee6%' THEN 0
        WHEN LOWER(actor_name) LIKE '%dyno%' THEN 0
        ELSE 1 
      END) as non_bot_count,
      COUNT(DISTINCT event_type) as event_types
    FROM event_logs 
    WHERE guild_id = ? AND channel_id IS NOT NULL
    GROUP BY channel_id
    ORDER BY event_count DESC
    LIMIT 15
  `
		)
		.bind(guildId)
		.all();

	return result.results || [];
}

/**
 * Get automation performance metrics
 */
async function getAutomationPerformance(db, guildId) {
	const result = await db
		.prepare(
			`
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
  `
		)
		.bind(guildId)
		.all();

	return result.results || [];
}

/**
 * Get daily execution history for each automation (last 14 days)
 * @param {D1Database} db - D1 database binding
 * @param {string} guildId - Guild ID
 * @returns {Promise<Object>} - Map of automation_id to array of daily execution counts
 */
export async function getAutomationExecutionHistory(db, guildId, timezone = null) {
	if (!db) return {};

	const tzOffset = getTimezoneOffsetSQL(timezone);

	try {
		const result = await db
			.prepare(
				`
      SELECT 
        automation_id,
        DATE(datetime(created_at, '${tzOffset}')) as date,
        COUNT(*) as count
      FROM automation_logs
      WHERE guild_id = ? AND created_at >= datetime('now', '-14 days')
      GROUP BY automation_id, DATE(datetime(created_at, '${tzOffset}'))
      ORDER BY automation_id, date ASC
    `
			)
			.bind(guildId)
			.all();

		// Group by automation_id
		const historyMap = {};
		for (const row of result.results || []) {
			if (!historyMap[row.automation_id]) {
				historyMap[row.automation_id] = [];
			}
			historyMap[row.automation_id].push({
				date: row.date,
				value: row.count,
			});
		}

		return historyMap;
	} catch (error) {
		log.error('Failed to fetch automation execution history:', error);
		return failed({});
	}
}

/**
 * Get command usage statistics
 */
async function getCommandUsageStats(db, guildId) {
	const result = await db
		.prepare(
			`
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
  `
		)
		.bind(guildId)
		.all();

	return result.results || [];
}

/**
 * Get activity heatmap data (events by hour of day and day of week)
 * @param {D1Database} db - D1 database binding
 * @param {string} guildId - Guild ID
 * @returns {Promise<Array>} - Heatmap data array
 */
export async function getActivityHeatmap(db, guildId, timezone = null, period = '30d') {
	if (!db) return [];

	const days = parsePeriodDays(period, 30);
	const tzOffset = getTimezoneOffsetSQL(timezone);

	try {
		const result = await db
			.prepare(
				`
      SELECT 
        CAST(strftime('%w', datetime(created_at, '${tzOffset}')) AS INTEGER) as day_of_week,
        CAST(strftime('%H', datetime(created_at, '${tzOffset}')) AS INTEGER) as hour,
        COUNT(*) as count,
        SUM(CASE 
          WHEN actor_is_bot = 1 THEN 0
          WHEN LOWER(actor_name) LIKE '%bot%' THEN 0
          WHEN LOWER(actor_name) LIKE '%disboard%' THEN 0
          WHEN LOWER(actor_name) LIKE '%github%' THEN 0
          WHEN LOWER(actor_name) LIKE '%mee6%' THEN 0
          WHEN LOWER(actor_name) LIKE '%dyno%' THEN 0
          ELSE 1 
        END) as non_bot_count
      FROM event_logs 
      WHERE guild_id = ? AND created_at >= datetime('now', ?)
      GROUP BY day_of_week, hour
      ORDER BY day_of_week, hour
    `
			)
			.bind(guildId, `-${days} days`)
			.all();

		return result.results || [];
	} catch (error) {
		log.error('Failed to fetch activity heatmap:', error);
		return failed([]);
	}
}

/**
 * Get event category breakdown with trends
 * @param {D1Database} db - D1 database binding
 * @param {string} guildId - Guild ID
 * @returns {Promise<Array>} - Category trends
 */
export async function getCategoryTrends(db, guildId, timezone = null, period = '14d') {
	if (!db) return [];

	const days = parsePeriodDays(period, 14);
	const tzOffset = getTimezoneOffsetSQL(timezone);

	try {
		const result = await db
			.prepare(
				`
      SELECT 
        event_category,
        strftime('%Y-%m-%d', datetime(created_at, '${tzOffset}')) as date,
        COUNT(*) as count
      FROM event_logs 
      WHERE guild_id = ? AND created_at >= datetime('now', ?)
      GROUP BY event_category, strftime('%Y-%m-%d', datetime(created_at, '${tzOffset}'))
      ORDER BY date ASC, event_category
    `
			)
			.bind(guildId, `-${days} days`)
			.all();

		return result.results || [];
	} catch (error) {
		log.error('Failed to fetch category trends:', error);
		return failed([]);
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
		const result = await db
			.prepare(
				`
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
    `
			)
			.bind(guildId, limit)
			.all();

		return result.results || [];
	} catch (error) {
		log.error('Failed to fetch recent automation executions:', error);
		return [];
	}
}

/**
 * Get top voice users (users with most voice activity)
 * @param {D1Database} db - D1 database binding
 * @param {string} guildId - Guild ID
 * @param {number} limit - Number of results
 * @param {'7d'|'30d'} period - Time range to evaluate
 * @returns {Promise<Array>} - Top voice users
 */
export async function getTopVoiceUsers(db, guildId, limit = 20, period = '30d') {
	if (!db) return [];

	const days = parsePeriodDays(period, 30);
	const timeRange = `-${days} days`;

	try {
		// Voice time comes from voice_sessions, the same place as the leaderboard, profiles and
		// the charts, so every screen shows the same number. Time before the window is cut off.
		const result = await db
			.prepare(
				`
      WITH clipped AS (
        SELECT
          user_id,
          is_bot,
          join_event_id,
          COALESCE(left_at, datetime('now')) AS ended,
          MAX(CAST((julianday(MIN(COALESCE(left_at, datetime('now')), datetime('now')))
                  - julianday(MAX(joined_at, datetime('now', ?)))) * 86400 AS INTEGER), 0) AS secs
        FROM voice_sessions
        WHERE guild_id = ?
          AND joined_at < datetime('now')
          AND (left_at IS NULL OR left_at > datetime('now', ?))
      )
      SELECT
        user_id as actor_id,
        (
          SELECT COALESCE(NULLIF(l.actor_name, ''), NULLIF(l.target_name, ''), 'Unknown member')
          FROM event_logs l
          WHERE l.guild_id = ?
            AND COALESCE(l.actor_id, l.target_id) = clipped.user_id
            AND l.event_type IN ('VOICE_JOIN', 'VOICE_LEAVE', 'VOICE_MOVE')
          ORDER BY l.created_at DESC, l.id DESC
          LIMIT 1
        ) as actor_name,
        MAX(COALESCE(is_bot, (SELECT e.actor_is_bot FROM event_logs e WHERE e.id = clipped.join_event_id), 0)) as actor_is_bot,
        (
          SELECT COALESCE(l.actor_avatar, l.target_avatar)
          FROM event_logs l
          WHERE l.guild_id = ?
            AND COALESCE(l.actor_id, l.target_id) = clipped.user_id
            AND COALESCE(l.actor_avatar, l.target_avatar) IS NOT NULL
          ORDER BY l.created_at DESC, l.id DESC
          LIMIT 1
        ) as actor_avatar,
        (
          SELECT COALESCE(l.actor_discriminator, '0')
          FROM event_logs l
          WHERE l.guild_id = ?
            AND COALESCE(l.actor_id, l.target_id) = clipped.user_id
          ORDER BY l.created_at DESC, l.id DESC
          LIMIT 1
        ) as actor_discriminator,
        SUM(secs) as total_seconds,
        MAX(ended) as last_active
      FROM clipped
      GROUP BY user_id
      HAVING total_seconds > 0
      ORDER BY total_seconds DESC
      LIMIT ?
    `
			)
			.bind(timeRange, guildId, timeRange, guildId, guildId, guildId, limit)
			.all();

		return enrichRowsWithActorAvatars(db, guildId, result.results || []);
	} catch (error) {
		log.error('Failed to fetch top voice users:', error);
		return failed([]);
	}
}

/**
 * Get top video users (users who use camera most)
 * @param {D1Database} db - D1 database binding
 * @param {string} guildId - Guild ID
 * @param {number} limit - Number of results
 * @returns {Promise<Array>} - Top video users
 */
export async function getTopVideoUsers(db, guildId, limit = 20, period = '30d') {
	if (!db) return [];

	const days = parsePeriodDays(period, 30);
	const timeRange = `-${days} days`;

	try {
		const result = await db
			.prepare(
				`
      WITH video_events AS (
        SELECT
          actor_id,
          actor_name,
          actor_is_bot,
          event_type,
          created_at,
          LEAD(event_type) OVER (PARTITION BY actor_id ORDER BY created_at) as next_event_type,
          LEAD(created_at) OVER (PARTITION BY actor_id ORDER BY created_at) as next_event_time
        FROM event_logs
        WHERE guild_id = ?
          AND actor_id IS NOT NULL
          AND event_type IN ('VOICE_VIDEO_START', 'VOICE_VIDEO_STOP', 'VOICE_LEAVE', 'VOICE_MOVE')
          AND created_at >= datetime('now', ?)
      )
      SELECT
        actor_id,
        actor_name,
        actor_is_bot,
        (
          SELECT l.actor_avatar
          FROM event_logs l
          WHERE l.guild_id = ?
            AND l.actor_id = video_events.actor_id
            AND l.actor_avatar IS NOT NULL
          ORDER BY l.created_at DESC, l.id DESC
          LIMIT 1
        ) as actor_avatar,
        (
          SELECT COALESCE(l.actor_discriminator, '0')
          FROM event_logs l
          WHERE l.guild_id = ?
            AND l.actor_id = video_events.actor_id
          ORDER BY l.created_at DESC, l.id DESC
          LIMIT 1
        ) as actor_discriminator,
        ROUND(SUM(
          CASE
            WHEN event_type = 'VOICE_VIDEO_START' AND next_event_type IN ('VOICE_VIDEO_STOP', 'VOICE_LEAVE', 'VOICE_MOVE')
            THEN (julianday(next_event_time) - julianday(created_at)) * 86400
            WHEN event_type = 'VOICE_VIDEO_START' AND next_event_type IS NULL
            THEN MIN((julianday('now') - julianday(created_at)) * 86400, 86400)
            ELSE 0
          END
        ), 0) as total_seconds,
        MAX(created_at) as last_active
      FROM video_events
      GROUP BY actor_id
      HAVING total_seconds > 0
      ORDER BY total_seconds DESC
      LIMIT ?
    `
			)
			.bind(guildId, timeRange, guildId, guildId, limit)
			.all();

		return enrichRowsWithActorAvatars(db, guildId, result.results || []);
	} catch (error) {
		log.error('Failed to fetch top video users:', error);
		return failed([]);
	}
}

/**
 * Get top screenshare users (users who share screen most)
 * @param {D1Database} db - D1 database binding
 * @param {string} guildId - Guild ID
 * @param {number} limit - Number of results
 * @returns {Promise<Array>} - Top screenshare users
 */
export async function getTopScreenshareUsers(db, guildId, limit = 20, period = '30d') {
	if (!db) return [];

	const days = parsePeriodDays(period, 30);
	const timeRange = `-${days} days`;

	try {
		const result = await db
			.prepare(
				`
      WITH stream_events AS (
        SELECT
          actor_id,
          actor_name,
          actor_is_bot,
          event_type,
          created_at,
          LEAD(event_type) OVER (PARTITION BY actor_id ORDER BY created_at) as next_event_type,
          LEAD(created_at) OVER (PARTITION BY actor_id ORDER BY created_at) as next_event_time
        FROM event_logs
        WHERE guild_id = ?
          AND actor_id IS NOT NULL
          AND event_type IN ('VOICE_STREAM_START', 'VOICE_STREAM_STOP', 'VOICE_LEAVE', 'VOICE_MOVE')
          AND created_at >= datetime('now', ?)
      )
      SELECT
        actor_id,
        actor_name,
        actor_is_bot,
        (
          SELECT l.actor_avatar
          FROM event_logs l
          WHERE l.guild_id = ?
            AND l.actor_id = stream_events.actor_id
            AND l.actor_avatar IS NOT NULL
          ORDER BY l.created_at DESC, l.id DESC
          LIMIT 1
        ) as actor_avatar,
        (
          SELECT COALESCE(l.actor_discriminator, '0')
          FROM event_logs l
          WHERE l.guild_id = ?
            AND l.actor_id = stream_events.actor_id
          ORDER BY l.created_at DESC, l.id DESC
          LIMIT 1
        ) as actor_discriminator,
        ROUND(SUM(
          CASE
            WHEN event_type = 'VOICE_STREAM_START' AND next_event_type IN ('VOICE_STREAM_STOP', 'VOICE_LEAVE', 'VOICE_MOVE')
            THEN (julianday(next_event_time) - julianday(created_at)) * 86400
            WHEN event_type = 'VOICE_STREAM_START' AND next_event_type IS NULL
            THEN MIN((julianday('now') - julianday(created_at)) * 86400, 86400)
            ELSE 0
          END
        ), 0) as total_seconds,
        MAX(created_at) as last_active
      FROM stream_events
      GROUP BY actor_id
      HAVING total_seconds > 0
      ORDER BY total_seconds DESC
      LIMIT ?
    `
			)
			.bind(guildId, timeRange, guildId, guildId, limit)
			.all();

		return enrichRowsWithActorAvatars(db, guildId, result.results || []);
	} catch (error) {
		log.error('Failed to fetch top screenshare users:', error);
		return failed([]);
	}
}
