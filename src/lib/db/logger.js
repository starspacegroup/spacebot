/**
 * Database logger for Discord events
 * Handles storing and retrieving event logs from D1
 */

import { env } from "$env/dynamic/private";

/**
 * Log levels in order of verbosity (lower = less verbose)
 * @enum {number}
 */
const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

/**
 * Get the current log level from environment
 * @returns {number} -1 if not set (no logging), otherwise the level value
 */
function getLogLevel() {
  if (!env.LOG_LEVEL) return -1;
  const level = env.LOG_LEVEL.toLowerCase();
  return LOG_LEVELS[level] ?? -1;
}

/**
 * Log helper functions that respect LOG_LEVEL
 * @type {{error: (...args: any[]) => void, warn: (...args: any[]) => void, info: (...args: any[]) => void, debug: (...args: any[]) => void}}
 */
export const log = {
  error: (...args) => {
    if (getLogLevel() >= LOG_LEVELS.error) console.error(...args);
  },
  warn: (...args) => {
    if (getLogLevel() >= LOG_LEVELS.warn) console.warn(...args);
  },
  info: (...args) => {
    if (getLogLevel() >= LOG_LEVELS.info) console.info(...args);
  },
  debug: (...args) => {
    if (getLogLevel() >= LOG_LEVELS.debug) console.debug(...args);
  },
};

/**
 * @typedef {Object} EventLog
 * @property {string} guild_id - The Discord guild ID
 * @property {string} event_type - Specific event type (e.g., 'MESSAGE_CREATE')
 * @property {string} event_category - Event category (e.g., 'message')
 * @property {string|null} actor_id - User who performed the action
 * @property {string|null} actor_name - Username of the actor
 * @property {string|null} target_id - Target of the action (user, channel, etc.)
 * @property {string|null} target_name - Name of the target
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
				actor_id, actor_name, target_id, target_name,
				channel_id, channel_name, details
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).bind(
      event.guild_id,
      event.event_type,
      event.event_category,
      event.actor_id || null,
      event.actor_name || null,
      event.target_id || null,
      event.target_name || null,
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
export async function getLogs(db, guildId, options = {}) {
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

    return {
      logs: logsResult.results.map((log) => ({
        ...log,
        details: log.details ? JSON.parse(log.details) : null,
      })),
      total: countResult?.total || 0,
    };
  } catch (error) {
    log.error("Failed to fetch logs:", error);
    return { logs: [], total: 0 };
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

/**
 * Event categories and their descriptions
 */
export const EVENT_CATEGORIES = {
  member: {
    name: "Member",
    description: "Member joins, leaves, updates",
    color: "#5865F2",
    icon: "👤",
  },
  message: {
    name: "Message",
    description: "Message create, edit, delete",
    color: "#57F287",
    icon: "💬",
  },
  voice: {
    name: "Voice",
    description: "Voice channel activity",
    color: "#FEE75C",
    icon: "🎤",
  },
  channel: {
    name: "Channel",
    description: "Channel modifications",
    color: "#EB459E",
    icon: "📁",
  },
  role: {
    name: "Role",
    description: "Role changes",
    color: "#ED4245",
    icon: "🏷️",
  },
  guild: {
    name: "Server",
    description: "Server settings changes",
    color: "#9B59B6",
    icon: "⚙️",
  },
  emoji: {
    name: "Emoji",
    description: "Emoji and sticker changes",
    color: "#F1C40F",
    icon: "😀",
  },
  invite: {
    name: "Invite",
    description: "Invite creation and deletion",
    color: "#3498DB",
    icon: "🔗",
  },
  moderation: {
    name: "Moderation",
    description: "Kicks, bans, timeouts",
    color: "#E74C3C",
    icon: "🔨",
  },
  interaction: {
    name: "Interaction",
    description: "Commands and interactions",
    color: "#1ABC9C",
    icon: "⚡",
  },
  thread: {
    name: "Thread",
    description: "Thread activity",
    color: "#2ECC71",
    icon: "🧵",
  },
  reaction: {
    name: "Reaction",
    description: "Message reactions",
    color: "#E91E63",
    icon: "❤️",
  },
  event: {
    name: "Scheduled Event",
    description: "Scheduled event activity",
    color: "#7289DA",
    icon: "📅",
  },
};

/**
 * Event type descriptions
 */
export const EVENT_TYPES = {
  // Member events
  MEMBER_JOIN: { category: "member", description: "Member joined the server" },
  MEMBER_LEAVE: { category: "member", description: "Member left the server" },
  MEMBER_UPDATE: { category: "member", description: "Member was updated" },
  MEMBER_BAN: { category: "moderation", description: "Member was banned" },
  MEMBER_UNBAN: { category: "moderation", description: "Member was unbanned" },
  MEMBER_KICK: { category: "moderation", description: "Member was kicked" },
  MEMBER_TIMEOUT: {
    category: "moderation",
    description: "Member was timed out",
  },

  // Message events
  MESSAGE_CREATE: { category: "message", description: "Message was sent" },
  MESSAGE_UPDATE: { category: "message", description: "Message was edited" },
  MESSAGE_DELETE: { category: "message", description: "Message was deleted" },
  MESSAGE_BULK_DELETE: {
    category: "message",
    description: "Messages were bulk deleted",
  },

  // Voice events
  VOICE_JOIN: { category: "voice", description: "Joined voice channel" },
  VOICE_LEAVE: { category: "voice", description: "Left voice channel" },
  VOICE_MOVE: {
    category: "voice",
    description: "Moved between voice channels",
  },
  // Self mute/unmute (user mutes themselves)
  VOICE_SELF_MUTE: {
    category: "voice",
    description: "User muted themselves",
  },
  VOICE_SELF_UNMUTE: {
    category: "voice",
    description: "User unmuted themselves",
  },
  // Server mute/unmute (moderator action)
  VOICE_SERVER_MUTE: {
    category: "voice",
    description: "User was server muted by moderator",
  },
  VOICE_SERVER_UNMUTE: {
    category: "voice",
    description: "User was server unmuted by moderator",
  },
  // Self deafen/undeafen
  VOICE_SELF_DEAFEN: {
    category: "voice",
    description: "User deafened themselves",
  },
  VOICE_SELF_UNDEAFEN: {
    category: "voice",
    description: "User undeafened themselves",
  },
  // Server deafen/undeafen (moderator action)
  VOICE_SERVER_DEAFEN: {
    category: "voice",
    description: "User was server deafened by moderator",
  },
  VOICE_SERVER_UNDEAFEN: {
    category: "voice",
    description: "User was server undeafened by moderator",
  },
  // Streaming
  VOICE_STREAM_START: { category: "voice", description: "Started streaming" },
  VOICE_STREAM_STOP: { category: "voice", description: "Stopped streaming" },
  // Video
  VOICE_VIDEO_START: { category: "voice", description: "Started video" },
  VOICE_VIDEO_STOP: { category: "voice", description: "Stopped video" },
  // Stage channel events
  VOICE_STAGE_SUPPRESS: {
    category: "voice",
    description: "User was suppressed in stage channel",
  },
  VOICE_STAGE_UNSUPPRESS: {
    category: "voice",
    description: "User was made speaker in stage channel",
  },
  VOICE_STAGE_REQUEST_TO_SPEAK: {
    category: "voice",
    description: "User requested to speak in stage channel",
  },
  VOICE_STAGE_REQUEST_CANCELLED: {
    category: "voice",
    description: "User cancelled request to speak in stage channel",
  },

  // Channel events
  CHANNEL_CREATE: { category: "channel", description: "Channel was created" },
  CHANNEL_DELETE: { category: "channel", description: "Channel was deleted" },
  CHANNEL_UPDATE: { category: "channel", description: "Channel was updated" },
  CHANNEL_PINS_UPDATE: {
    category: "channel",
    description: "Channel pins were updated",
  },

  // Role events
  ROLE_CREATE: { category: "role", description: "Role was created" },
  ROLE_DELETE: { category: "role", description: "Role was deleted" },
  ROLE_UPDATE: { category: "role", description: "Role was updated" },
  MEMBER_ROLE_ADD: {
    category: "role",
    description: "Role was added to member",
  },
  MEMBER_ROLE_REMOVE: {
    category: "role",
    description: "Role was removed from member",
  },

  // Guild events
  GUILD_UPDATE: {
    category: "guild",
    description: "Server settings were updated",
  },

  // Emoji events
  EMOJI_CREATE: { category: "emoji", description: "Emoji was created" },
  EMOJI_DELETE: { category: "emoji", description: "Emoji was deleted" },
  EMOJI_UPDATE: { category: "emoji", description: "Emoji was updated" },
  STICKER_CREATE: { category: "emoji", description: "Sticker was created" },
  STICKER_DELETE: { category: "emoji", description: "Sticker was deleted" },
  STICKER_UPDATE: { category: "emoji", description: "Sticker was updated" },

  // Invite events
  INVITE_CREATE: { category: "invite", description: "Invite was created" },
  INVITE_DELETE: { category: "invite", description: "Invite was deleted" },

  // Thread events
  THREAD_CREATE: { category: "thread", description: "Thread was created" },
  THREAD_DELETE: { category: "thread", description: "Thread was deleted" },
  THREAD_UPDATE: { category: "thread", description: "Thread was updated" },
  THREAD_MEMBER_ADD: {
    category: "thread",
    description: "Member joined thread",
  },
  THREAD_MEMBER_REMOVE: {
    category: "thread",
    description: "Member left thread",
  },

  // Reaction events
  REACTION_ADD: { category: "reaction", description: "Reaction was added" },
  REACTION_REMOVE: {
    category: "reaction",
    description: "Reaction was removed",
  },
  REACTION_REMOVE_ALL: {
    category: "reaction",
    description: "All reactions were removed",
  },

  // Interaction events
  COMMAND_USE: {
    category: "interaction",
    description: "Slash command was used",
  },
  BUTTON_CLICK: { category: "interaction", description: "Button was clicked" },
  MODAL_SUBMIT: { category: "interaction", description: "Modal was submitted" },
  SELECT_MENU_USE: {
    category: "interaction",
    description: "Select menu was used",
  },
  CONTEXT_MENU_USE: {
    category: "interaction",
    description: "Context menu command was used",
  },
  AUTOCOMPLETE_USE: {
    category: "interaction",
    description: "Autocomplete was triggered",
  },

  // Scheduled event events
  SCHEDULED_EVENT_CREATE: {
    category: "event",
    description: "Scheduled event was created",
  },
  SCHEDULED_EVENT_DELETE: {
    category: "event",
    description: "Scheduled event was deleted",
  },
  SCHEDULED_EVENT_UPDATE: {
    category: "event",
    description: "Scheduled event was updated",
  },
  SCHEDULED_EVENT_USER_ADD: {
    category: "event",
    description: "User subscribed to scheduled event",
  },
  SCHEDULED_EVENT_USER_REMOVE: {
    category: "event",
    description: "User unsubscribed from scheduled event",
  },
};
