/**
 * Database logger for Discord events
 * Handles storing and retrieving event logs from D1
 */

import { log } from "../log.js";
import { enrichRowsWithActorAvatars } from "./avatar-enrichment.js";
import {
  DISCORD_EVENT_CATEGORIES,
  DISCORD_EVENT_TYPES,
} from "../discord/event-metadata.js";

// Re-export the unified log utility for other modules
export { log };

/**
 * @typedef {Object} EventLog
 * @property {string} guild_id - The Discord guild ID
 * @property {string} event_type - Specific event type (e.g., 'MESSAGE_CREATE')
 * @property {string} event_category - Event category (e.g., 'message')
 * @property {string|null} actor_id - User who performed the action
 * @property {string|null} actor_name - Username of the actor
 * @property {boolean|null} actor_is_bot - Whether the actor is a bot
 * @property {string|null} actor_avatar - Avatar hash of the actor
 * @property {string|null} actor_discriminator - Discriminator of the actor (for default avatar calculation)
 * @property {string|null} target_id - Target of the action (user, channel, etc.)
 * @property {string|null} target_name - Name of the target
 * @property {string|null} target_avatar - Avatar hash of the target
 * @property {string|null} channel_id - Channel where event occurred
 * @property {string|null} channel_name - Name of the channel
 * @property {Object|null} details - Additional event-specific data
 */

/**
 * Log an event to the database
 * @param {D1Database} db - D1 database binding
 * @param {EventLog} event - Event data to log
 * @returns {Promise<{success: boolean, error?: string}>} - Result with success status and optional error
 */
export async function logEvent(db, event) {
  if (!db) {
    log.warn("Database not available, skipping event log");
    return { success: false, error: "Database not available" };
  }

  try {
    await db.prepare(`
			INSERT INTO event_logs (
				guild_id, event_type, event_category,
				actor_id, actor_name, actor_is_bot, actor_avatar, actor_discriminator,
				target_id, target_name, target_avatar,
				channel_id, channel_name, details
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).bind(
      event.guild_id,
      event.event_type,
      event.event_category,
      event.actor_id || null,
      event.actor_name || null,
      event.actor_is_bot ? 1 : 0,
      event.actor_avatar || null,
      event.actor_discriminator || '0',
      event.target_id || null,
      event.target_name || null,
      event.target_avatar || null,
      event.channel_id || null,
      event.channel_name || null,
      event.details ? JSON.stringify(event.details) : null,
    ).run();

    return { success: true };
  } catch (error) {
    log.error("Failed to log event:", error);
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Get logs for a specific guild with pagination and filtering
 * @param {D1Database} db - D1 database binding
 * @param {string} guildId - Guild ID to fetch logs for
 * @param {Object} options - Query options
 * @param {number} [options.limit=50] - Number of logs to return
 * @param {number} [options.offset=0] - Offset for pagination
 * @param {string} [options.category] - Filter by event category
 * @param {string} [options.eventType] - Filter by specific event type
 * @param {string} [options.actorId] - Filter by actor
 * @param {string} [options.startDate] - Filter by start date
 * @param {string} [options.endDate] - Filter by end date
 * @param {string} [options.search] - Search in actor/target names
 * @param {string} [options.sortOrder] - Sort order: 'asc' or 'desc' (default: 'desc')
 * @returns {Promise<{logs: Array, total: number}>}
 */
export async function getLogs(db, guildId, options: Record<string, any> = {}) {
  if (!db) {
    return { logs: [], total: 0 };
  }

  const {
    limit = 50,
    offset = 0,
    category,
    eventType,
    actorId,
    startDate,
    endDate,
    search,
    sortOrder = "desc",
  } = options;

  let whereClause = "WHERE guild_id = ?";
  const params = [guildId];

  if (category) {
    whereClause += " AND event_category = ?";
    params.push(category);
  }

  if (eventType) {
    whereClause += " AND event_type = ?";
    params.push(eventType);
  }

  if (actorId) {
    whereClause += " AND actor_id = ?";
    params.push(actorId);
  }

  if (startDate) {
    whereClause += " AND created_at >= ?";
    params.push(startDate);
  }

  if (endDate) {
    whereClause += " AND created_at <= ?";
    params.push(endDate);
  }

  if (search) {
    whereClause +=
      " AND (actor_name LIKE ? OR target_name LIKE ? OR channel_name LIKE ?)";
    const searchPattern = `%${search}%`;
    params.push(searchPattern, searchPattern, searchPattern);
  }

  // Validate sortOrder to prevent SQL injection
  const orderDirection = sortOrder === "asc" ? "ASC" : "DESC";

  try {
    // Get total count
    const countResult = await db.prepare(`
			SELECT COUNT(*) as total FROM event_logs ${whereClause}
		`).bind(...params).first();

    // Get paginated logs
    const logsResult = await db.prepare(`
			SELECT * FROM event_logs 
			${whereClause}
			ORDER BY created_at ${orderDirection}
			LIMIT ? OFFSET ?
		`).bind(...params, limit, offset).all();

    const parsedLogs = (logsResult.results || []).map((log) => ({
        ...log,
        details: log.details ? JSON.parse(log.details) : null,
      }));

    const actorEnrichedLogs = await enrichRowsWithActorAvatars(db, guildId, parsedLogs, {
      idField: "actor_id",
      avatarField: "actor_avatar",
      nameField: "actor_name",
      discriminatorField: "actor_discriminator",
    });

    const fullyEnrichedLogs = await enrichRowsWithActorAvatars(db, guildId, actorEnrichedLogs, {
      idField: "target_id",
      avatarField: "target_avatar",
      nameField: "target_name",
      discriminatorField: null,
    });

    return {
      logs: fullyEnrichedLogs,
      total: countResult?.total || 0,
    };
  } catch (error) {
    log.error("Failed to fetch logs:", error);
    return { logs: [], total: 0 };
  }
}

/**
 * Get distinct GitHub repositories seen for a guild.
 * Uses event log payloads to keep options aligned with real incoming webhook traffic.
 *
 * @param {D1Database} db - D1 database binding
 * @param {string} guildId - Guild ID
 * @param {number} [limit=200] - Max repositories to return
 * @returns {Promise<string[]>}
 */
export async function getGuildGitHubRepositories(db, guildId, limit = 200) {
  if (!db || !guildId) return [];

  try {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.floor(limit))) : 200;
    const { results } = await db.prepare(`
      SELECT DISTINCT TRIM(json_extract(details, '$.repo')) AS repo
      FROM event_logs
      WHERE guild_id = ?
        AND event_category = 'github'
        AND details IS NOT NULL
        AND json_extract(details, '$.repo') IS NOT NULL
        AND TRIM(json_extract(details, '$.repo')) != ''
      ORDER BY LOWER(repo) ASC
      LIMIT ?
    `).bind(guildId, safeLimit).all();

    return (results || [])
      .map((row) => row.repo)
      .filter((repo) => typeof repo === 'string' && repo.length > 0);
  } catch (error) {
    log.error('Failed to fetch GitHub repositories for guild:', error);
    return [];
  }
}

/**
 * Get log statistics for a guild
 * @param {D1Database} db - D1 database binding
 * @param {string} guildId - Guild ID
 * @returns {Promise<Object>} - Statistics object
 */
export async function getLogStats(db, guildId) {
  if (!db) {
    return { totalEvents: 0, byCategory: {}, recentActivity: [] };
  }

  try {
    // Total events
    const totalResult = await db.prepare(`
			SELECT COUNT(*) as total FROM event_logs WHERE guild_id = ?
		`).bind(guildId).first();

    // Events by category
    const categoryResult = await db.prepare(`
			SELECT event_category, COUNT(*) as count 
			FROM event_logs 
			WHERE guild_id = ?
			GROUP BY event_category
		`).bind(guildId).all();

    // Events in last 24 hours by hour
    const recentResult = await db.prepare(`
			SELECT 
				strftime('%Y-%m-%d %H:00', created_at) as hour,
				COUNT(*) as count
			FROM event_logs 
			WHERE guild_id = ? AND created_at >= datetime('now', '-24 hours')
			GROUP BY strftime('%Y-%m-%d %H:00', created_at)
			ORDER BY hour DESC
		`).bind(guildId).all();

    // Top event types
    const topEventsResult = await db.prepare(`
			SELECT event_type, COUNT(*) as count 
			FROM event_logs 
			WHERE guild_id = ?
			GROUP BY event_type
			ORDER BY count DESC
			LIMIT 10
		`).bind(guildId).all();

    return {
      totalEvents: totalResult?.total || 0,
      byCategory: Object.fromEntries(
        (categoryResult.results || []).map((r) => [r.event_category, r.count]),
      ),
      recentActivity: recentResult.results || [],
      topEvents: topEventsResult.results || [],
    };
  } catch (error) {
    log.error("Failed to fetch log stats:", error);
    return {
      totalEvents: 0,
      byCategory: {},
      recentActivity: [],
      topEvents: [],
    };
  }
}

/**
 * Get guild settings
 * @param {D1Database} db - D1 database binding
 * @param {string} guildId - Guild ID
 * @returns {Promise<Object|null>}
 */
export async function getGuildSettings(db, guildId) {
  if (!db) return null;

  try {
    const result = await db.prepare(`
			SELECT * FROM guild_settings WHERE guild_id = ?
		`).bind(guildId).first();

    if (result) {
      return {
        ...result,
        excluded_channels: result.excluded_channels
          ? JSON.parse(result.excluded_channels)
          : [],
        excluded_categories: result.excluded_categories
          ? JSON.parse(result.excluded_categories)
          : [],
      };
    }
    return null;
  } catch (error) {
    log.error("Failed to get guild settings:", error);
    return null;
  }
}

/**
 * Update guild settings
 * @param {D1Database} db - D1 database binding
 * @param {string} guildId - Guild ID
 * @param {Object} settings - Settings to update
 * @returns {Promise<boolean>}
 */
export async function updateGuildSettings(db, guildId, settings) {
  if (!db) return false;

  try {
    await db.prepare(`
			INSERT INTO guild_settings (guild_id, logging_enabled, log_channel_id, excluded_channels, excluded_categories)
			VALUES (?, ?, ?, ?, ?)
			ON CONFLICT(guild_id) DO UPDATE SET
				logging_enabled = excluded.logging_enabled,
				log_channel_id = excluded.log_channel_id,
				excluded_channels = excluded.excluded_channels,
				excluded_categories = excluded.excluded_categories,
				updated_at = CURRENT_TIMESTAMP
		`).bind(
      guildId,
      settings.logging_enabled ?? 1,
      settings.log_channel_id || null,
      settings.excluded_channels
        ? JSON.stringify(settings.excluded_channels)
        : null,
      settings.excluded_categories
        ? JSON.stringify(settings.excluded_categories)
        : null,
    ).run();

    return true;
  } catch (error) {
    log.error("Failed to update guild settings:", error);
    return false;
  }
}

/**
 * Get a single log entry by ID
 * @param {D1Database} db - D1 database binding
 * @param {number} logId - Log entry ID
 * @param {string} guildId - Guild ID (for security verification)
 * @returns {Promise<Object|null>} - Log entry or null if not found
 */
export async function getLogById(db, logId, guildId) {
  if (!db) {
    return null;
  }

  try {
    const result = await db.prepare(`
			SELECT * FROM event_logs 
			WHERE id = ? AND guild_id = ?
		`).bind(logId, guildId).first();

    if (!result) {
      return null;
    }

    return {
      ...result,
      details: result.details ? JSON.parse(result.details) : null,
    };
  } catch (error) {
    log.error("Failed to fetch log by ID:", error);
    return null;
  }
}

/**
 * Delete old logs (retention policy)
 * @param {D1Database} db - D1 database binding
 * @param {number} daysToKeep - Number of days to retain logs
 * @returns {Promise<number>} - Number of deleted rows
 */
export async function pruneOldLogs(db, daysToKeep = 30) {
  if (!db) return 0;

  try {
    const result = await db.prepare(`
			DELETE FROM event_logs 
			WHERE created_at < datetime('now', '-' || ? || ' days')
		`).bind(daysToKeep).run();

    return result.meta?.changes || 0;
  } catch (error) {
    log.error("Failed to prune old logs:", error);
    return 0;
  }
}

export const EVENT_CATEGORIES = DISCORD_EVENT_CATEGORIES;
export const EVENT_TYPES = DISCORD_EVENT_TYPES;
