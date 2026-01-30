/**
 * Automation database functions
 * Handles CRUD operations for automations and execution logging
 */

import { log } from "$lib/log.js";

/**
 * @typedef {Object} Automation
 * @property {number} id
 * @property {string} guild_id
 * @property {string} name
 * @property {string} description
 * @property {boolean} enabled
 * @property {string} trigger_event - Legacy: single event type (deprecated, use trigger_events)
 * @property {string[]} trigger_events - Array of event types that trigger this automation
 * @property {Object} trigger_filters - Conditions that must be met
 * @property {string} action_type - Action to perform
 * @property {Object} action_config - Action-specific configuration
 * @property {string} created_by
 * @property {string} created_at
 * @property {string} updated_at
 * @property {string} last_triggered_at
 * @property {number} trigger_count
 */

/**
 * Action types and their configurations
 */
export const ACTION_TYPES = {
  DELETE_USER_MESSAGES: {
    name: "Delete User's Messages",
    description: "Delete messages from a user",
    icon: "🗑️",
    targetUser: true,
    configSchema: {
      target_user: {
        type: "user_source",
        required: true,
        label: "Target User",
        description: "Which user's messages to delete",
      },
      channel_ids: {
        type: "channel_multi",
        required: false,
        label: "Channel(s)",
        showAllOption: true,
        default: "ALL",
      },
      max_age_days: {
        type: "number_source",
        required: false,
        label: "Delete messages from last X days",
        description: "Leave empty to delete all messages regardless of age",
        placeholder: "∞ (all time)",
        supportsOptionRef: true,
      },
      max_messages: {
        type: "number_source",
        required: false,
        label: "Max messages to delete",
        description: "Leave empty for no limit",
        placeholder: "∞",
        supportsOptionRef: true,
      },
      skip_pinned: {
        type: "boolean",
        default: true,
        label: "Skip pinned messages",
      },
    },
  },
  DELETE_MESSAGES: {
    name: "Delete Messages",
    description: "Delete messages from a user in a channel",
    icon: "🗑️",
    targetUser: true,
    configSchema: {
      target_user: {
        type: "user_source",
        required: true,
        label: "Target User",
        description: "Which user's messages to delete",
      },
      channel_ids: {
        type: "channel_multi",
        required: false,
        label: "Channel(s)",
        showAllOption: true,
        allOptionLabel: "Any Channel",
        default: "ALL",
      },
      limit: {
        type: "number",
        default: 100,
        max: 1000,
        label: "Max messages to delete",
      },
    },
  },
  SEND_MESSAGE: {
    name: "Send Message",
    description: "Send a message to a channel",
    icon: "💬",
    configSchema: {
      channel_id: { type: "channel", required: true, label: "Channel" },
      content: {
        type: "text",
        required: true,
        label: "Message content",
        supportsVariables: true,
      },
      embed: { type: "boolean", default: false, label: "Send as embed" },
    },
  },
  ADD_ROLE: {
    name: "Add Role",
    description: "Add a role to a user",
    icon: "🏷️",
    targetUser: true,
    configSchema: {
      target_user: {
        type: "user_source",
        required: true,
        label: "Target User",
        description: "Which user to add the role to",
      },
      role_id: { type: "role", required: true, label: "Role" },
    },
  },
  REMOVE_ROLE: {
    name: "Remove Role",
    description: "Remove a role from a user",
    icon: "🏷️",
    targetUser: true,
    configSchema: {
      target_user: {
        type: "user_source",
        required: true,
        label: "Target User",
        description: "Which user to remove the role from",
      },
      role_id: { type: "role", required: true, label: "Role" },
    },
  },
  KICK_MEMBER: {
    name: "Kick Member",
    description: "Kick a member from the server",
    icon: "👢",
    targetUser: true,
    configSchema: {
      target_user: {
        type: "user_source",
        required: true,
        label: "Target User",
        description: "Which user to kick",
      },
      reason: { type: "text", label: "Reason", supportsVariables: true },
    },
  },
  BAN_MEMBER: {
    name: "Ban Member",
    description: "Ban a member from the server",
    icon: "🔨",
    targetUser: true,
    configSchema: {
      target_user: {
        type: "user_source",
        required: true,
        label: "Target User",
        description: "Which user to ban",
      },
      reason: { type: "text", label: "Reason", supportsVariables: true },
      delete_days: {
        type: "number",
        default: 0,
        max: 7,
        label: "Delete message history (days)",
      },
    },
  },
  TIMEOUT_MEMBER: {
    name: "Timeout Member",
    description: "Timeout a member",
    icon: "⏰",
    targetUser: true,
    configSchema: {
      target_user: {
        type: "user_source",
        required: true,
        label: "Target User",
        description: "Which user to timeout",
      },
      duration_minutes: {
        type: "number_source",
        required: true,
        default: 60,
        label: "Duration (minutes)",
        supportsOptionRef: true,
      },
      reason: { type: "text", label: "Reason", supportsVariables: true },
    },
  },
  LOG_TO_CHANNEL: {
    name: "Log to Channel",
    description: "Send a log message to a channel with event details",
    icon: "📋",
    configSchema: {
      channel_id: { type: "channel", required: true, label: "Log channel" },
      content: {
        type: "text",
        label: "Custom message",
        supportsVariables: true,
      },
      include_details: {
        type: "boolean",
        default: true,
        label: "Include event details",
      },
    },
  },
  CREATE_THREAD: {
    name: "Create Thread",
    description: "Create a thread in a channel",
    icon: "🧵",
    configSchema: {
      channel_id: { type: "channel", required: true, label: "Channel" },
      thread_name: {
        type: "text",
        required: true,
        label: "Thread name",
        supportsVariables: true,
      },
      auto_archive_duration: {
        type: "select",
        options: [60, 1440, 4320, 10080],
        default: 1440,
        label: "Auto-archive after (minutes)",
      },
    },
  },
};

/**
 * Filter types that can be applied to triggers
 * Each filter has an applicableEvents array to define which event types it applies to
 * Use "*" to apply to all events, or specify event type prefixes/exact matches
 */
export const FILTER_TYPES = {
  channel_id: {
    type: "channel",
    label: "In Channel(s)",
    description: "Only trigger in this channel",
    applicableEvents: [
      "MESSAGE_",
      "VOICE_",
      "THREAD_",
      "REACTION_",
      "CHANNEL_PINS_UPDATE",
    ],
  },
  not_channel_id: {
    type: "channel",
    label: "Not In Channel(s)",
    description: "Don't trigger in this channel",
    applicableEvents: [
      "MESSAGE_",
      "VOICE_",
      "THREAD_",
      "REACTION_",
      "CHANNEL_PINS_UPDATE",
    ],
  },
  actor_has_role: {
    type: "role",
    label: "Actor Has Role",
    description: "Actor must have this role",
    applicableEvents: ["*"], // All events have an actor
  },
  actor_missing_role: {
    type: "role",
    label: "Actor Missing Role",
    description: "Actor must NOT have this role",
    applicableEvents: ["*"], // All events have an actor
  },
  target_has_role: {
    type: "role",
    label: "Target Has Role",
    description: "Target must have this role",
    applicableEvents: [
      "MEMBER_BAN",
      "MEMBER_UNBAN",
      "MEMBER_KICK",
      "MEMBER_TIMEOUT",
      "MEMBER_ROLE_ADD",
      "MEMBER_ROLE_REMOVE",
    ],
  },
  content_contains: {
    type: "text",
    label: "Content Contains",
    description: "Message content must contain text",
    applicableEvents: ["MESSAGE_CREATE", "MESSAGE_UPDATE"],
  },
  content_regex: {
    type: "text",
    label: "Content Matches Regex",
    description: "Message content matches pattern",
    applicableEvents: ["MESSAGE_CREATE", "MESSAGE_UPDATE"],
  },
  bot_filter: {
    type: "select",
    label: "Bot Filter",
    description: "Filter by bot status",
    options: [
      { value: "any", label: "Any (Bots & Humans)" },
      { value: "only_bots", label: "Only Bots" },
      { value: "only_humans", label: "Only Humans" },
    ],
    default: "any",
    applicableEvents: ["MESSAGE_", "MEMBER_JOIN", "MEMBER_LEAVE", "REACTION_"],
  },
  min_account_age_days: {
    type: "number",
    label: "Min Account Age (days)",
    description: "Account must be at least X days old",
    applicableEvents: ["MEMBER_JOIN"],
  },
  max_account_age_days: {
    type: "number",
    label: "Max Account Age (days)",
    description: "Account must be less than X days old",
    applicableEvents: ["MEMBER_JOIN"],
  },
};

/**
 * Check if a filter applies to a given event type
 * @param {Object} filterInfo - The filter configuration object
 * @param {string} eventType - The event type to check
 * @returns {boolean} - Whether the filter applies to the event type
 */
export function filterAppliesToEvent(filterInfo, eventType) {
  if (!filterInfo.applicableEvents || !eventType) {
    return true; // If no restrictions, apply to all
  }

  for (const pattern of filterInfo.applicableEvents) {
    if (pattern === "*") {
      return true;
    }
    // Check if it's a prefix match (ends with _) or exact match
    if (pattern.endsWith("_")) {
      if (eventType.startsWith(pattern)) {
        return true;
      }
    } else if (eventType === pattern) {
      return true;
    }
  }

  return false;
}

/**
 * Get filters applicable to a specific event type
 * @param {string} eventType - The event type
 * @returns {Object} - Filtered FILTER_TYPES object
 */
export function getFiltersForEvent(eventType) {
  const applicableFilters = {};
  for (const [filterKey, filterInfo] of Object.entries(FILTER_TYPES)) {
    if (filterAppliesToEvent(filterInfo, eventType)) {
      applicableFilters[filterKey] = filterInfo;
    }
  }
  return applicableFilters;
}

/**
 * Template variables available for use in automation messages
 */
export const TEMPLATE_VARIABLES = {
  "user.id": "Actor's Discord ID",
  "user.name": "Actor's username",
  "user.mention": "Mention the actor",
  "user.tag": "Actor's tag (username#0000)",
  "target.id": "Target's Discord ID",
  "target.name": "Target's username",
  "target.mention": "Mention the target",
  "channel.id": "Channel ID",
  "channel.name": "Channel name",
  "channel.mention": "Mention the channel",
  "guild.id": "Server ID",
  "guild.name": "Server name",
  "trigger.event": "Event type that triggered",
  "trigger.category": "Event category",
  "trigger.time": "When the event occurred",
};

/**
 * User source options for automations
 * These define which user to target in user-related actions
 */
export const AUTOMATION_USER_SOURCES = {
  actor: {
    value: "actor",
    label: "Event Actor",
    description: "The user who triggered the event",
  },
  target: {
    value: "target",
    label: "Event Target",
    description: "The user who was the target of the event (if any)",
  },
};

/**
 * User source options for commands
 * These define which user to target in user-related actions
 * Dynamic options are added based on command options
 */
export const COMMAND_USER_SOURCES = {
  invoker: {
    value: "invoker",
    label: "Command Invoker",
    description: "The user who ran the command",
  },
};

/**
 * Create a new automation
 * @param {D1Database} db
 * @param {Partial<Automation>} automation
 * @returns {Promise<{success: boolean, id?: number, error?: string}>}
 */
export async function createAutomation(db, automation) {
  if (!db) {
    return { success: false, error: "Database not available" };
  }

  try {
    // Support both single trigger_event and multiple trigger_events
    const triggerEvents = automation.trigger_events ||
      (automation.trigger_event ? [automation.trigger_event] : []);
    // For backwards compatibility, store first event in trigger_event
    const primaryTrigger = triggerEvents[0] || null;

    // Clean action_config to avoid circular references
    let cleanActionConfig = {};
    if (automation.action_config) {
      // Deep clone to strip any reactive wrappers
      if (automation.action_config.actions) {
        cleanActionConfig.actions = automation.action_config.actions.map(
          (action) => ({
            type: action.type,
            config: { ...action.config },
          }),
        );
      }
      // Copy other properties
      for (const [key, value] of Object.entries(automation.action_config)) {
        if (key !== "actions") {
          cleanActionConfig[key] = value;
        }
      }
    }

    const result = await db.prepare(`
      INSERT INTO automations (
        guild_id, name, description, enabled,
        trigger_event, trigger_events, trigger_filters,
        action_type, action_config,
        created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      automation.guild_id,
      automation.name,
      automation.description || null,
      automation.enabled !== false ? 1 : 0,
      primaryTrigger,
      JSON.stringify(triggerEvents),
      automation.trigger_filters
        ? JSON.stringify(automation.trigger_filters)
        : null,
      automation.action_type,
      JSON.stringify(cleanActionConfig),
      automation.created_by || null,
    ).run();

    return { success: true, id: result.meta?.last_row_id };
  } catch (error) {
    log.error("Failed to create automation:", error);
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Update an existing automation
 * @param {D1Database} db
 * @param {number} id
 * @param {Partial<Automation>} updates
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function updateAutomation(db, id, updates) {
  if (!db) {
    return { success: false, error: "Database not available" };
  }

  try {
    const fields = [];
    const values = [];

    if (updates.name !== undefined) {
      fields.push("name = ?");
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      fields.push("description = ?");
      values.push(updates.description);
    }
    if (updates.enabled !== undefined) {
      fields.push("enabled = ?");
      values.push(updates.enabled ? 1 : 0);
    }
    if (updates.trigger_events !== undefined) {
      // Handle multiple triggers
      const triggerEvents = Array.isArray(updates.trigger_events)
        ? updates.trigger_events
        : [updates.trigger_events];
      fields.push("trigger_events = ?");
      values.push(JSON.stringify(triggerEvents));
      // Also update legacy trigger_event field for backwards compatibility
      fields.push("trigger_event = ?");
      values.push(triggerEvents[0] || null);
    } else if (updates.trigger_event !== undefined) {
      // Legacy single trigger update - also update trigger_events
      fields.push("trigger_event = ?");
      values.push(updates.trigger_event);
      fields.push("trigger_events = ?");
      values.push(JSON.stringify([updates.trigger_event]));
    }
    if (updates.trigger_filters !== undefined) {
      fields.push("trigger_filters = ?");
      values.push(
        updates.trigger_filters
          ? JSON.stringify(updates.trigger_filters)
          : null,
      );
    }
    if (updates.action_type !== undefined) {
      fields.push("action_type = ?");
      values.push(updates.action_type);
    }
    if (updates.action_config !== undefined || updates.actions !== undefined) {
      fields.push("action_config = ?");
      // If we have a new actions array, store it in action_config
      // Create a clean copy to avoid circular references from reactive state
      const actionConfig = updates.action_config
        ? JSON.parse(JSON.stringify(updates.action_config))
        : {};
      if (updates.actions !== undefined) {
        // Deep clone actions to strip any reactive wrappers or circular refs
        actionConfig.actions = updates.actions.map((action) => ({
          type: action.type,
          config: { ...action.config },
        }));
      }
      values.push(JSON.stringify(actionConfig));
    }

    fields.push("updated_at = CURRENT_TIMESTAMP");
    values.push(id);

    await db.prepare(`
      UPDATE automations SET ${fields.join(", ")} WHERE id = ?
    `).bind(...values).run();

    return { success: true };
  } catch (error) {
    log.error("Failed to update automation:", error);
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Delete an automation
 * @param {D1Database} db
 * @param {number} id
 * @param {string} guildId - Ensure deletion is for correct guild
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deleteAutomation(db, id, guildId) {
  if (!db) {
    return { success: false, error: "Database not available" };
  }

  try {
    await db.prepare(`
      DELETE FROM automations WHERE id = ? AND guild_id = ?
    `).bind(id, guildId).run();

    return { success: true };
  } catch (error) {
    log.error("Failed to delete automation:", error);
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Get a single automation by ID
 * @param {D1Database} db
 * @param {number} id
 * @param {string} guildId
 * @returns {Promise<Automation|null>}
 */
export async function getAutomation(db, id, guildId) {
  if (!db) return null;

  try {
    const result = await db.prepare(`
      SELECT * FROM automations WHERE id = ? AND guild_id = ?
    `).bind(id, guildId).first();

    if (!result) return null;

    const parsed = {
      ...result,
      enabled: !!result.enabled,
      trigger_filters: result.trigger_filters
        ? JSON.parse(result.trigger_filters)
        : null,
      action_config: result.action_config
        ? JSON.parse(result.action_config)
        : {},
    };

    // Parse trigger_events array, falling back to single trigger_event
    if (result.trigger_events) {
      parsed.trigger_events = JSON.parse(result.trigger_events);
    } else if (result.trigger_event) {
      parsed.trigger_events = [result.trigger_event];
    } else {
      parsed.trigger_events = [];
    }

    // Parse actions array if present, or construct from legacy single action
    if (parsed.action_config?.actions) {
      parsed.actions = parsed.action_config.actions;
    } else if (
      parsed.action_type && parsed.action_type !== "NONE" &&
      parsed.action_type !== "MULTIPLE"
    ) {
      // Legacy format: convert single action to array
      parsed.actions = [{
        type: parsed.action_type,
        config: parsed.action_config || {},
      }];
    } else {
      parsed.actions = [];
    }

    return parsed;
  } catch (error) {
    log.error("Failed to get automation:", error);
    return null;
  }
}

/**
 * Get all automations for a guild
 * @param {D1Database} db
 * @param {string} guildId
 * @param {Object} options
 * @returns {Promise<{automations: Automation[], total: number}>}
 */
export async function getAutomations(db, guildId, options = {}) {
  if (!db) {
    return { automations: [], total: 0 };
  }

  const { limit = 50, offset = 0, eventType, enabled } = options;

  try {
    let whereClause = "WHERE guild_id = ?";
    const params = [guildId];

    if (eventType) {
      whereClause += " AND trigger_event = ?";
      params.push(eventType);
    }

    if (enabled !== undefined) {
      whereClause += " AND enabled = ?";
      params.push(enabled ? 1 : 0);
    }

    const countResult = await db.prepare(`
      SELECT COUNT(*) as total FROM automations ${whereClause}
    `).bind(...params).first();

    const results = await db.prepare(`
      SELECT * FROM automations ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all();

    return {
      automations: (results.results || []).map((a) => {
        const parsed = {
          ...a,
          enabled: !!a.enabled,
          trigger_filters: a.trigger_filters
            ? JSON.parse(a.trigger_filters)
            : null,
          action_config: a.action_config ? JSON.parse(a.action_config) : {},
        };
        // Parse trigger_events array, falling back to single trigger_event
        if (a.trigger_events) {
          parsed.trigger_events = JSON.parse(a.trigger_events);
        } else if (a.trigger_event) {
          parsed.trigger_events = [a.trigger_event];
        } else {
          parsed.trigger_events = [];
        }
        return parsed;
      }),
      total: countResult?.total || 0,
    };
  } catch (error) {
    log.error("Failed to get automations:", error);
    return { automations: [], total: 0 };
  }
}

/**
 * Get automations that should trigger for a specific event
 * @param {D1Database} db
 * @param {string} guildId
 * @param {string} eventType
 * @returns {Promise<Automation[]>}
 */
export async function getTriggeredAutomations(db, guildId, eventType) {
  if (!db) return [];

  try {
    // Query automations where eventType is in the trigger_events array
    // Also check legacy trigger_event for backwards compatibility
    const results = await db.prepare(`
      SELECT * FROM automations 
      WHERE guild_id = ? AND enabled = 1
        AND (
          trigger_event = ?
          OR EXISTS (
            SELECT 1 FROM json_each(trigger_events) 
            WHERE json_each.value = ?
          )
        )
    `).bind(guildId, eventType, eventType).all();

    log.debug(
      `[DB] getTriggeredAutomations for ${eventType}: found ${
        results.results?.length || 0
      } automations`,
    );

    return (results.results || []).map((a) => {
      const parsed = {
        ...a,
        enabled: !!a.enabled,
        trigger_filters: a.trigger_filters
          ? JSON.parse(a.trigger_filters)
          : null,
        action_config: a.action_config ? JSON.parse(a.action_config) : {},
      };
      // Parse trigger_events array
      if (a.trigger_events) {
        parsed.trigger_events = JSON.parse(a.trigger_events);
      } else if (a.trigger_event) {
        parsed.trigger_events = [a.trigger_event];
      } else {
        parsed.trigger_events = [];
      }
      log.debug(
        `[DB] Automation "${a.name}" has triggers: ${
          JSON.stringify(parsed.trigger_events)
        }`,
      );
      return parsed;
    });
  } catch (error) {
    log.error("Failed to get triggered automations:", error);
    return [];
  }
}

/**
 * Log automation execution
 * @param {D1Database} db
 * @param {Object} log
 * @returns {Promise<{success: boolean}>}
 */
export async function logAutomationExecution(db, log) {
  if (!db) return { success: false };

  try {
    await db.prepare(`
      INSERT INTO automation_logs (
        automation_id, guild_id, trigger_event,
        trigger_data, action_result, success, error_message, execution_time_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      log.automation_id,
      log.guild_id,
      log.trigger_event,
      log.trigger_data ? JSON.stringify(log.trigger_data) : null,
      log.action_result ? JSON.stringify(log.action_result) : null,
      log.success ? 1 : 0,
      log.error_message || null,
      log.execution_time_ms || null,
    ).run();

    // Update automation trigger stats
    await db.prepare(`
      UPDATE automations 
      SET trigger_count = trigger_count + 1, last_triggered_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(log.automation_id).run();

    return { success: true };
  } catch (error) {
    log.error("Failed to log automation execution:", error);
    return { success: false };
  }
}

/**
 * Get automation execution logs
 * @param {D1Database} db
 * @param {string} guildId
 * @param {Object} options
 * @returns {Promise<{logs: Array, total: number}>}
 */
export async function getAutomationLogs(db, guildId, options = {}) {
  if (!db) return { logs: [], total: 0 };

  const { limit = 50, offset = 0, automationId, success } = options;

  try {
    let whereClause = "WHERE al.guild_id = ?";
    const params = [guildId];

    if (automationId) {
      whereClause += " AND al.automation_id = ?";
      params.push(automationId);
    }

    if (success !== undefined) {
      whereClause += " AND al.success = ?";
      params.push(success ? 1 : 0);
    }

    const countResult = await db.prepare(`
      SELECT COUNT(*) as total FROM automation_logs al ${whereClause}
    `).bind(...params).first();

    const results = await db.prepare(`
      SELECT al.*, a.name as automation_name 
      FROM automation_logs al
      LEFT JOIN automations a ON al.automation_id = a.id
      ${whereClause}
      ORDER BY al.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all();

    return {
      logs: (results.results || []).map((log) => ({
        ...log,
        success: !!log.success,
        trigger_data: log.trigger_data ? JSON.parse(log.trigger_data) : null,
        action_result: log.action_result ? JSON.parse(log.action_result) : null,
      })),
      total: countResult?.total || 0,
    };
  } catch (error) {
    log.error("Failed to get automation logs:", error);
    return { logs: [], total: 0 };
  }
}

/**
 * Toggle automation enabled state
 * @param {D1Database} db
 * @param {number} id
 * @param {string} guildId
 * @param {boolean} enabled
 * @returns {Promise<{success: boolean}>}
 */
export async function toggleAutomation(db, id, guildId, enabled) {
  if (!db) return { success: false };

  try {
    await db.prepare(`
      UPDATE automations SET enabled = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND guild_id = ?
    `).bind(enabled ? 1 : 0, id, guildId).run();

    return { success: true };
  } catch (error) {
    log.error("Failed to toggle automation:", error);
    return { success: false };
  }
}
