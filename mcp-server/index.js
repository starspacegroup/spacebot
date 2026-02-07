/**
 * SpaceBot MCP Server
 * 
 * Model Context Protocol server that provides read access to:
 * - Event logs
 * - Automations
 * - Commands
 * - Server settings
 * - Server statistics
 * - Aggregated activity metrics
 * 
 * This server connects to the SpaceBot D1 database via the Cloudflare API.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Configuration - load from environment
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const D1_DATABASE_ID = process.env.D1_DATABASE_ID || "6bce735c-2dca-43cd-9911-2eef7062377a";
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

// ============================================================================
// Schema Documentation - These constants help provide accurate answers about
// what SpaceBot can do
// ============================================================================

/**
 * Available trigger events for automations
 */
const TRIGGER_EVENTS = {
  MESSAGE_CREATE: "When a message is sent",
  MESSAGE_UPDATE: "When a message is edited",
  MESSAGE_DELETE: "When a message is deleted",
  MEMBER_JOIN: "When a member joins the server",
  MEMBER_LEAVE: "When a member leaves the server",
  MEMBER_BAN: "When a member is banned",
  MEMBER_UNBAN: "When a member is unbanned",
  MEMBER_KICK: "When a member is kicked",
  MEMBER_TIMEOUT: "When a member is timed out",
  MEMBER_UPDATE: "When a member is updated (nickname, roles, etc.)",
  MEMBER_ROLE_ADD: "When a role is added to a member",
  MEMBER_ROLE_REMOVE: "When a role is removed from a member",
  ROLE_CREATE: "When a role is created",
  ROLE_UPDATE: "When a role is updated",
  ROLE_DELETE: "When a role is deleted",
  CHANNEL_CREATE: "When a channel is created",
  CHANNEL_UPDATE: "When a channel is updated",
  CHANNEL_DELETE: "When a channel is deleted",
  VOICE_JOIN: "When a member joins a voice channel",
  VOICE_LEAVE: "When a member leaves a voice channel",
  VOICE_MOVE: "When a member moves between voice channels",
  REACTION_ADD: "When a reaction is added to a message",
  REACTION_REMOVE: "When a reaction is removed from a message",
  THREAD_CREATE: "When a thread is created",
  SLASH_COMMAND_USE: "When a slash command is used",
  SLASH_COMMAND_RESPONSE: "When a bot responds to a slash command",
};

/**
 * Available action types for automations and commands
 */
const ACTION_TYPES = {
  SEND_MESSAGE: {
    name: "Send Message",
    description: "Send a message to a channel",
    configFields: ["channel_id", "content", "embed"],
  },
  SEND_DM: {
    name: "Send DM",
    description: "Send a direct message to a user",
    configFields: ["target_user", "content", "embed"],
  },
  ADD_ROLE: {
    name: "Add Role(s)",
    description: "Add one or more roles to a user",
    configFields: ["target_user", "role_ids"],
  },
  REMOVE_ROLE: {
    name: "Remove Role(s)",
    description: "Remove one or more roles from a user",
    configFields: ["target_user", "role_ids"],
  },
  KICK_MEMBER: {
    name: "Kick Member",
    description: "Kick a member from the server",
    configFields: ["target_user", "reason"],
  },
  BAN_MEMBER: {
    name: "Ban Member",
    description: "Ban a member from the server",
    configFields: ["target_user", "reason", "delete_days"],
  },
  TIMEOUT_MEMBER: {
    name: "Timeout Member",
    description: "Timeout a member for a duration",
    configFields: ["target_user", "duration_minutes", "reason"],
  },
  DELETE_MESSAGE: {
    name: "Delete Message",
    description: "Delete the triggering message",
    configFields: [],
  },
  DELETE_USER_MESSAGES: {
    name: "Delete User's Messages",
    description: "Delete multiple messages from a user",
    configFields: ["target_user", "channel_ids", "max_age_days", "max_messages"],
  },
  LOG_TO_CHANNEL: {
    name: "Log to Channel",
    description: "Send a log message with event details",
    configFields: ["channel_id", "content", "include_details"],
  },
  CREATE_THREAD: {
    name: "Create Thread",
    description: "Create a thread in a channel",
    configFields: ["channel_id", "thread_name", "auto_archive_duration"],
  },
  ADD_REACTION: {
    name: "Add Reaction",
    description: "Add a reaction emoji to the triggering message",
    configFields: ["emoji"],
  },
  CALL_WEBHOOK: {
    name: "Call Webhook",
    description: "Send data to an external webhook endpoint",
    configFields: ["webhook_id", "payload_template", "include_event_data"],
  },
};

/**
 * Available filter types for automation triggers
 */
const FILTER_TYPES = {
  channel_id: "Only trigger in specific channel(s)",
  not_channel_id: "Don't trigger in specific channel(s)",
  actor_has_role: "Actor must have a specific role",
  actor_missing_role: "Actor must NOT have a specific role",
  target_has_role: "Target must have a specific role",
  actor_id: "Only trigger for specific user(s)",
  not_actor_id: "Don't trigger for specific user(s)",
  content_contains: "Message must contain specific text",
  content_regex: "Message must match a regex pattern",
  bot_filter: "Filter by bot status (any/only_bots/only_humans)",
  min_account_age_days: "Account must be at least X days old",
  max_account_age_days: "Account must be less than X days old",
  target_bot_id: "Filter by which bot responded",
  command_name: "Filter by specific command used",
  command_result: "Filter by success/failure",
};

/**
 * Template variables available in automations
 */
const TEMPLATE_VARIABLES = {
  "user.id": "Actor's Discord ID",
  "user.name": "Actor's username",
  "user.mention": "Mention the actor (@user)",
  "target.id": "Target's Discord ID",
  "target.name": "Target's username",
  "target.mention": "Mention the target",
  "channel.id": "Channel ID",
  "channel.name": "Channel name",
  "channel.mention": "Mention the channel (#channel)",
  "guild.id": "Server ID",
  "guild.name": "Server name",
  "trigger.event": "Event type that triggered",
};

/**
 * Command option types (Discord slash command parameters)
 */
const COMMAND_OPTION_TYPES = {
  3: { name: "STRING", description: "Text input" },
  4: { name: "INTEGER", description: "Whole number" },
  5: { name: "BOOLEAN", description: "True/False choice" },
  6: { name: "USER", description: "Select a user" },
  7: { name: "CHANNEL", description: "Select a channel" },
  8: { name: "ROLE", description: "Select a role" },
  9: { name: "MENTIONABLE", description: "User or role" },
  10: { name: "NUMBER", description: "Decimal number" },
  11: { name: "ATTACHMENT", description: "File upload" },
};

/**
 * Execute a query against the D1 database via Cloudflare API
 */
async function executeD1Query(sql, params = []) {
  if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_API_TOKEN) {
    throw new Error("Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN environment variables");
  }

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${D1_DATABASE_ID}/query`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sql,
        params,
      }),
    }
  );

  const data = await response.json();
  
  if (!data.success) {
    throw new Error(`D1 query failed: ${JSON.stringify(data.errors)}`);
  }

  return data.result[0];
}

/**
 * Get event logs for a guild
 */
async function getEventLogs(guildId, options = {}) {
  const { limit = 50, offset = 0, category, eventType } = options;
  
  let sql = "SELECT * FROM event_logs WHERE guild_id = ?";
  const params = [guildId];

  if (category) {
    sql += " AND event_category = ?";
    params.push(category);
  }

  if (eventType) {
    sql += " AND event_type = ?";
    params.push(eventType);
  }

  sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const result = await executeD1Query(sql, params);
  
  return result.results.map(log => ({
    ...log,
    details: log.details ? JSON.parse(log.details) : null,
  }));
}

/**
 * Get log statistics for a guild
 */
async function getLogStats(guildId) {
  const totalResult = await executeD1Query(
    "SELECT COUNT(*) as total FROM event_logs WHERE guild_id = ?",
    [guildId]
  );

  const categoryResult = await executeD1Query(
    `SELECT event_category, COUNT(*) as count 
     FROM event_logs WHERE guild_id = ?
     GROUP BY event_category`,
    [guildId]
  );

  const recentResult = await executeD1Query(
    `SELECT event_type, COUNT(*) as count 
     FROM event_logs WHERE guild_id = ?
     GROUP BY event_type ORDER BY count DESC LIMIT 10`,
    [guildId]
  );

  return {
    totalEvents: totalResult.results[0]?.total || 0,
    byCategory: Object.fromEntries(
      categoryResult.results.map(r => [r.event_category, r.count])
    ),
    topEventTypes: recentResult.results,
  };
}

/**
 * Get automations for a guild
 */
async function getAutomations(guildId, options = {}) {
  const { enabledOnly = false, limit = 100 } = options;
  
  let sql = "SELECT * FROM automations WHERE guild_id = ?";
  const params = [guildId];

  if (enabledOnly) {
    sql += " AND enabled = 1";
  }

  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);

  const result = await executeD1Query(sql, params);
  
  return result.results.map(automation => ({
    ...automation,
    trigger_events: automation.trigger_events ? JSON.parse(automation.trigger_events) : 
                    (automation.trigger_event ? [automation.trigger_event] : []),
    trigger_filters: automation.trigger_filters ? JSON.parse(automation.trigger_filters) : {},
    action_config: automation.action_config ? JSON.parse(automation.action_config) : {},
  }));
}

/**
 * Get a single automation by ID
 */
async function getAutomation(automationId, guildId) {
  const result = await executeD1Query(
    "SELECT * FROM automations WHERE id = ? AND guild_id = ?",
    [automationId, guildId]
  );

  if (!result.results.length) {
    return null;
  }

  const automation = result.results[0];
  return {
    ...automation,
    trigger_events: automation.trigger_events ? JSON.parse(automation.trigger_events) : 
                    (automation.trigger_event ? [automation.trigger_event] : []),
    trigger_filters: automation.trigger_filters ? JSON.parse(automation.trigger_filters) : {},
    action_config: automation.action_config ? JSON.parse(automation.action_config) : {},
  };
}

/**
 * Get automation execution logs
 */
async function getAutomationLogs(guildId, options = {}) {
  const { automationId, limit = 50 } = options;
  
  let sql = "SELECT * FROM automation_logs WHERE guild_id = ?";
  const params = [guildId];

  if (automationId) {
    sql += " AND automation_id = ?";
    params.push(automationId);
  }

  sql += " ORDER BY executed_at DESC LIMIT ?";
  params.push(limit);

  const result = await executeD1Query(sql, params);
  
  return result.results.map(log => ({
    ...log,
    trigger_data: log.trigger_data ? JSON.parse(log.trigger_data) : null,
    result_data: log.result_data ? JSON.parse(log.result_data) : null,
  }));
}

/**
 * Get commands for a guild
 */
async function getCommands(guildId, options = {}) {
  const { enabledOnly = false, registeredOnly = false, limit = 100 } = options;
  
  let sql = "SELECT * FROM commands WHERE guild_id = ?";
  const params = [guildId];

  if (enabledOnly) {
    sql += " AND enabled = 1";
  }

  if (registeredOnly) {
    sql += " AND registered = 1";
  }

  sql += " ORDER BY name ASC LIMIT ?";
  params.push(limit);

  const result = await executeD1Query(sql, params);
  
  return result.results.map(command => ({
    ...command,
    options: command.options ? JSON.parse(command.options) : [],
    action_config: command.action_config ? JSON.parse(command.action_config) : {},
    response_embed: command.response_embed ? JSON.parse(command.response_embed) : null,
  }));
}

/**
 * Get a single command by ID
 */
async function getCommand(commandId, guildId) {
  const result = await executeD1Query(
    "SELECT * FROM commands WHERE id = ? AND guild_id = ?",
    [commandId, guildId]
  );

  if (!result.results.length) {
    return null;
  }

  const command = result.results[0];
  return {
    ...command,
    options: command.options ? JSON.parse(command.options) : [],
    action_config: command.action_config ? JSON.parse(command.action_config) : {},
    response_embed: command.response_embed ? JSON.parse(command.response_embed) : null,
  };
}

/**
 * Get command usage logs
 */
async function getCommandLogs(guildId, options = {}) {
  const { commandId, limit = 50 } = options;
  
  let sql = "SELECT * FROM command_logs WHERE guild_id = ?";
  const params = [guildId];

  if (commandId) {
    sql += " AND command_id = ?";
    params.push(commandId);
  }

  sql += " ORDER BY executed_at DESC LIMIT ?";
  params.push(limit);

  const result = await executeD1Query(sql, params);
  
  return result.results.map(log => ({
    ...log,
    options_used: log.options_used ? JSON.parse(log.options_used) : null,
    result_data: log.result_data ? JSON.parse(log.result_data) : null,
  }));
}

/**
 * Get server settings for a guild
 */
async function getGuildSettings(guildId) {
  const result = await executeD1Query(
    "SELECT * FROM guild_settings WHERE guild_id = ?",
    [guildId]
  );

  const DEFAULT_SETTINGS = {
    prefix: "!",
    logging_enabled: true,
    log_channel_id: null,
    moderation_role_id: null,
    welcome_enabled: false,
    welcome_channel_id: null,
    welcome_message: "Welcome {user} to {server}!",
    excluded_channels: [],
    excluded_categories: [],
    permission_settings: {
      viewDashboard: { permission: "MANAGE_GUILD", roles: [] },
      viewLogs: { permission: "MANAGE_GUILD", roles: [] },
      manageAutomations: { permission: "MANAGE_GUILD", roles: [] },
      manageCommands: { permission: "MANAGE_GUILD", roles: [] },
      manageSettings: { permission: "ADMINISTRATOR", roles: [] },
    },
  };

  if (!result.results.length) {
    return DEFAULT_SETTINGS;
  }

  const settings = result.results[0];
  return {
    prefix: settings.prefix || DEFAULT_SETTINGS.prefix,
    logging_enabled: Boolean(settings.logging_enabled),
    log_channel_id: settings.log_channel_id || null,
    moderation_role_id: settings.moderation_role_id || null,
    welcome_enabled: Boolean(settings.welcome_enabled),
    welcome_channel_id: settings.welcome_channel_id || null,
    welcome_message: settings.welcome_message || DEFAULT_SETTINGS.welcome_message,
    excluded_channels: settings.excluded_channels ? JSON.parse(settings.excluded_channels) : [],
    excluded_categories: settings.excluded_categories ? JSON.parse(settings.excluded_categories) : [],
    permission_settings: settings.permission_settings ? 
      JSON.parse(settings.permission_settings) : DEFAULT_SETTINGS.permission_settings,
    created_at: settings.created_at,
    updated_at: settings.updated_at,
  };
}

/**
 * List all guilds in the database
 */
async function listGuilds() {
  // Get unique guild IDs from event_logs
  const logsResult = await executeD1Query(
    "SELECT DISTINCT guild_id FROM event_logs"
  );
  
  // Get unique guild IDs from automations
  const automationsResult = await executeD1Query(
    "SELECT DISTINCT guild_id FROM automations"
  );
  
  // Get unique guild IDs from commands
  const commandsResult = await executeD1Query(
    "SELECT DISTINCT guild_id FROM commands"
  );
  
  // Get unique guild IDs from settings
  const settingsResult = await executeD1Query(
    "SELECT DISTINCT guild_id FROM guild_settings"
  );

  // Combine all unique guild IDs
  const guildIds = new Set([
    ...logsResult.results.map(r => r.guild_id),
    ...automationsResult.results.map(r => r.guild_id),
    ...commandsResult.results.map(r => r.guild_id),
    ...settingsResult.results.map(r => r.guild_id),
  ]);

  return Array.from(guildIds);
}

/**
 * Get the latest server statistics
 */
async function getServerStats(guildId) {
  const result = await executeD1Query(
    `SELECT * FROM server_stats 
     WHERE guild_id = ?
     ORDER BY recorded_at DESC
     LIMIT 1`,
    [guildId]
  );

  if (!result.results.length) {
    return null;
  }

  return result.results[0];
}

/**
 * Get server statistics history for a time period
 */
async function getServerStatsHistory(guildId, options = {}) {
  const { period = "7d" } = options;

  const periodMap = {
    "24h": "-1 day",
    "7d": "-7 days",
    "30d": "-30 days",
    "90d": "-90 days",
  };
  const timeRange = periodMap[period] || "-7 days";

  // Determine granularity
  let groupFormat;
  if (period === "24h") {
    groupFormat = "%Y-%m-%d %H:00";
  } else if (period === "7d" || period === "30d") {
    groupFormat = "%Y-%m-%d";
  } else {
    groupFormat = "%Y-W%W";
  }

  const result = await executeD1Query(
    `SELECT 
      strftime('${groupFormat}', recorded_at) as period,
      ROUND(AVG(member_count)) as member_count,
      ROUND(AVG(online_count)) as online_count,
      ROUND(AVG(bot_count)) as bot_count,
      ROUND(AVG(human_count)) as human_count,
      MAX(recorded_at) as last_recorded
    FROM server_stats 
    WHERE guild_id = ? AND recorded_at >= datetime('now', ?)
    GROUP BY strftime('${groupFormat}', recorded_at)
    ORDER BY period ASC`,
    [guildId, timeRange]
  );

  return result.results || [];
}

/**
 * Get member count changes over time
 */
async function getMemberGrowth(guildId) {
  const [current, dayAgo, weekAgo, monthAgo] = await Promise.all([
    executeD1Query(
      `SELECT member_count, human_count, bot_count FROM server_stats 
       WHERE guild_id = ? ORDER BY recorded_at DESC LIMIT 1`,
      [guildId]
    ),
    executeD1Query(
      `SELECT member_count, human_count FROM server_stats 
       WHERE guild_id = ? AND recorded_at <= datetime('now', '-1 day')
       ORDER BY recorded_at DESC LIMIT 1`,
      [guildId]
    ),
    executeD1Query(
      `SELECT member_count, human_count FROM server_stats 
       WHERE guild_id = ? AND recorded_at <= datetime('now', '-7 days')
       ORDER BY recorded_at DESC LIMIT 1`,
      [guildId]
    ),
    executeD1Query(
      `SELECT member_count, human_count FROM server_stats 
       WHERE guild_id = ? AND recorded_at <= datetime('now', '-30 days')
       ORDER BY recorded_at DESC LIMIT 1`,
      [guildId]
    ),
  ]);

  const currentStats = current.results?.[0];
  const dayStats = dayAgo.results?.[0];
  const weekStats = weekAgo.results?.[0];
  const monthStats = monthAgo.results?.[0];

  return {
    current: currentStats?.member_count || 0,
    currentHuman: currentStats?.human_count || null,
    currentBot: currentStats?.bot_count || null,
    changes: {
      day: dayStats?.member_count ? (currentStats?.member_count || 0) - dayStats.member_count : null,
      week: weekStats?.member_count ? (currentStats?.member_count || 0) - weekStats.member_count : null,
      month: monthStats?.member_count ? (currentStats?.member_count || 0) - monthStats.member_count : null,
    },
    humanChanges: {
      day: dayStats?.human_count != null && currentStats?.human_count != null 
        ? currentStats.human_count - dayStats.human_count : null,
      week: weekStats?.human_count != null && currentStats?.human_count != null
        ? currentStats.human_count - weekStats.human_count : null,
      month: monthStats?.human_count != null && currentStats?.human_count != null
        ? currentStats.human_count - monthStats.human_count : null,
    },
  };
}

/**
 * Get aggregated activity statistics
 */
async function getAggregatedStats(guildId, options = {}) {
  const { period = "7d", periodType = "daily" } = options;

  const periodMap = {
    "24h": "-1 day",
    "7d": "-7 days",
    "30d": "-30 days",
    "90d": "-90 days",
  };
  const timeRange = periodMap[period] || "-7 days";

  const result = await executeD1Query(
    `SELECT 
      period_start,
      period_end,
      member_joins,
      member_leaves,
      member_net_change,
      voice_total_seconds,
      voice_unique_users,
      voice_peak_concurrent,
      message_count,
      message_unique_users,
      total_events
    FROM aggregated_stats 
    WHERE guild_id = ? 
      AND period_type = ?
      AND period_start >= datetime('now', ?)
    ORDER BY period_start ASC`,
    [guildId, periodType, timeRange]
  );

  return result.results || [];
}

/**
 * Get activity summary for a guild
 */
async function getActivitySummary(guildId) {
  // Get totals for the last 7 days from aggregated stats
  const weeklyResult = await executeD1Query(
    `SELECT 
      SUM(member_joins) as total_joins,
      SUM(member_leaves) as total_leaves,
      SUM(member_net_change) as net_growth,
      SUM(voice_total_seconds) as total_voice_seconds,
      SUM(message_count) as total_messages,
      SUM(total_events) as total_events,
      MAX(voice_peak_concurrent) as peak_voice_users
    FROM aggregated_stats 
    WHERE guild_id = ? 
      AND period_type = 'daily'
      AND period_start >= datetime('now', '-7 days')`,
    [guildId]
  );

  // Get most active hours
  const hourlyResult = await executeD1Query(
    `SELECT 
      strftime('%H', period_start) as hour,
      SUM(message_count) as messages,
      SUM(voice_unique_users) as voice_users
    FROM aggregated_stats 
    WHERE guild_id = ? 
      AND period_type = 'hourly'
      AND period_start >= datetime('now', '-7 days')
    GROUP BY strftime('%H', period_start)
    ORDER BY messages DESC
    LIMIT 5`,
    [guildId]
  );

  const stats = weeklyResult.results?.[0] || {};
  return {
    last7Days: {
      totalJoins: stats.total_joins || 0,
      totalLeaves: stats.total_leaves || 0,
      netGrowth: stats.net_growth || 0,
      totalVoiceHours: Math.round((stats.total_voice_seconds || 0) / 3600 * 10) / 10,
      totalMessages: stats.total_messages || 0,
      totalEvents: stats.total_events || 0,
      peakVoiceUsers: stats.peak_voice_users || 0,
    },
    mostActiveHours: hourlyResult.results?.map(h => ({
      hour: `${h.hour}:00`,
      messages: h.messages,
      voiceUsers: h.voice_users,
    })) || [],
  };
}

/**
 * Get schema information about SpaceBot capabilities
 */
function getSchemaInfo() {
  return {
    triggerEvents: TRIGGER_EVENTS,
    actionTypes: ACTION_TYPES,
    filterTypes: FILTER_TYPES,
    templateVariables: TEMPLATE_VARIABLES,
    commandOptionTypes: COMMAND_OPTION_TYPES,
  };
}

/**
 * Get a user's roles in a specific guild via Discord API
 * @param {string} guildId - The guild ID
 * @param {string} userId - The user ID
 * @returns {Promise<Object>} - User's member info including roles
 */
async function getUserRoles(guildId, userId) {
  if (!DISCORD_BOT_TOKEN) {
    throw new Error("DISCORD_BOT_TOKEN not configured - cannot fetch user roles");
  }

  // First, fetch the guild member to get their role IDs
  const memberResponse = await fetch(
    `https://discord.com/api/v10/guilds/${guildId}/members/${userId}`,
    {
      headers: {
        "Authorization": `Bot ${DISCORD_BOT_TOKEN}`,
      },
    }
  );

  if (!memberResponse.ok) {
    if (memberResponse.status === 404) {
      throw new Error("User is not a member of this guild");
    }
    throw new Error(`Failed to fetch member: ${memberResponse.status}`);
  }

  const member = await memberResponse.json();

  // Fetch the guild's roles to get role names
  const rolesResponse = await fetch(
    `https://discord.com/api/v10/guilds/${guildId}/roles`,
    {
      headers: {
        "Authorization": `Bot ${DISCORD_BOT_TOKEN}`,
      },
    }
  );

  if (!rolesResponse.ok) {
    throw new Error(`Failed to fetch guild roles: ${rolesResponse.status}`);
  }

  const guildRoles = await rolesResponse.json();
  const roleMap = new Map(guildRoles.map(r => [r.id, r]));

  // Map user's role IDs to role details
  const userRoles = member.roles
    .map(roleId => {
      const role = roleMap.get(roleId);
      if (!role) return null;
      return {
        id: role.id,
        name: role.name,
        color: role.color,
        position: role.position,
        permissions: role.permissions,
        hoist: role.hoist,
        managed: role.managed,
        mentionable: role.mentionable,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.position - a.position); // Sort by position (highest first)

  return {
    userId: member.user.id,
    username: member.user.username,
    displayName: member.nick || member.user.global_name || member.user.username,
    joinedAt: member.joined_at,
    roles: userRoles,
    roleCount: userRoles.length,
    highestRole: userRoles[0] || null,
    isOwner: false, // Would need additional API call to check
  };
}

/**
 * Get voice and stage channels for a guild via Discord API
 */
async function getVoiceAndStageChannels(guildId) {
  if (!DISCORD_BOT_TOKEN) {
    throw new Error("DISCORD_BOT_TOKEN not configured");
  }

  const response = await fetch(
    `https://discord.com/api/v10/guilds/${guildId}/channels`,
    { headers: { "Authorization": `Bot ${DISCORD_BOT_TOKEN}` } }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch channels: ${response.status}`);
  }

  const channels = await response.json();
  
  // Channel types: 2 = Voice, 13 = Stage
  const voiceChannels = channels
    .filter(c => c.type === 2)
    .map(c => ({ id: c.id, name: c.name, type: "voice", parentId: c.parent_id }))
    .sort((a, b) => a.name.localeCompare(b.name));
  
  const stageChannels = channels
    .filter(c => c.type === 13)
    .map(c => ({ id: c.id, name: c.name, type: "stage", parentId: c.parent_id }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    voiceChannels,
    stageChannels,
    totalVoice: voiceChannels.length,
    totalStage: stageChannels.length,
  };
}

/**
 * Parse a natural language event text into structured event data
 */
function parseEventFromText(text) {
  const lines = text.trim().split(/\n/);
  let name, dateTimeStr;
  
  if (lines.length >= 2) {
    name = lines[0].trim();
    dateTimeStr = lines.slice(1).join(' ').trim();
  } else {
    const dateMatch = text.match(/(.+?)\s*[,·]?\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2})/i);
    if (dateMatch) {
      name = dateMatch[1].trim();
      dateTimeStr = text.substring(dateMatch.index + dateMatch[1].length).trim();
    } else {
      return null;
    }
  }
  
  name = name.replace(/[,·]\s*$/, '').trim();
  dateTimeStr = dateTimeStr.replace(/^[,·\s]+/, '');
  
  const datePattern = /([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/;
  const dateMatch = dateTimeStr.match(datePattern);
  
  if (!dateMatch) return null;
  
  const monthStr = dateMatch[1];
  const day = parseInt(dateMatch[2], 10);
  const year = parseInt(dateMatch[3], 10);
  
  const months = {
    'jan': 0, 'january': 0, 'feb': 1, 'february': 1, 'mar': 2, 'march': 2,
    'apr': 3, 'april': 3, 'may': 4, 'jun': 5, 'june': 5, 'jul': 6, 'july': 6,
    'aug': 7, 'august': 7, 'sep': 8, 'september': 8, 'oct': 9, 'october': 9,
    'nov': 10, 'november': 10, 'dec': 11, 'december': 11,
  };
  
  const month = months[monthStr.toLowerCase()];
  if (month === undefined) return null;
  
  const timeStr = dateTimeStr.substring(dateMatch.index + dateMatch[0].length).trim();
  const cleanTimeStr = timeStr.replace(/^[·,]\s*|^at\s+/i, '').trim();
  
  const timeRangePattern = /(\d{1,2}):?(\d{2})?\s*(AM|PM)?\s*[–\-–]\s*(\d{1,2}):?(\d{2})?\s*(AM|PM)/i;
  const singleTimePattern = /(\d{1,2}):?(\d{2})?\s*(AM|PM)/i;
  
  let startHour, startMinute, endHour, endMinute;
  const rangeMatch = cleanTimeStr.match(timeRangePattern);
  
  if (rangeMatch) {
    startHour = parseInt(rangeMatch[1], 10);
    startMinute = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : 0;
    const startAmPm = rangeMatch[3]?.toUpperCase();
    endHour = parseInt(rangeMatch[4], 10);
    endMinute = rangeMatch[5] ? parseInt(rangeMatch[5], 10) : 0;
    const endAmPm = rangeMatch[6].toUpperCase();
    
    const effectiveStartAmPm = startAmPm || endAmPm;
    if (effectiveStartAmPm === 'PM' && startHour !== 12) startHour += 12;
    else if (effectiveStartAmPm === 'AM' && startHour === 12) startHour = 0;
    if (endAmPm === 'PM' && endHour !== 12) endHour += 12;
    else if (endAmPm === 'AM' && endHour === 12) endHour = 0;
  } else {
    const singleMatch = cleanTimeStr.match(singleTimePattern);
    if (singleMatch) {
      startHour = parseInt(singleMatch[1], 10);
      startMinute = singleMatch[2] ? parseInt(singleMatch[2], 10) : 0;
      const amPm = singleMatch[3].toUpperCase();
      if (amPm === 'PM' && startHour !== 12) startHour += 12;
      else if (amPm === 'AM' && startHour === 12) startHour = 0;
      endHour = startHour + 2;
      endMinute = startMinute;
      if (endHour >= 24) endHour -= 24;
    } else {
      startHour = 12; startMinute = 0; endHour = 14; endMinute = 0;
    }
  }
  
  const startDate = new Date(year, month, day, startHour, startMinute, 0);
  const endDate = new Date(year, month, day, endHour, endMinute, 0);
  if (endDate <= startDate) endDate.setDate(endDate.getDate() + 1);
  
  return {
    name,
    scheduledStartTime: startDate.toISOString(),
    scheduledEndTime: endDate.toISOString(),
    entityType: 3,
  };
}

/**
 * Parse multiple events from text
 */
function parseEventsFromText(text) {
  const eventBlocks = text.split(/\n\s*\n/).filter(block => block.trim());
  const events = [];
  for (const block of eventBlocks) {
    const event = parseEventFromText(block);
    if (event) events.push(event);
  }
  return events;
}

/**
 * Get scheduled events for a guild via Discord API
 */
async function getScheduledEvents(guildId) {
  if (!DISCORD_BOT_TOKEN) {
    throw new Error("DISCORD_BOT_TOKEN not configured");
  }

  const response = await fetch(
    `https://discord.com/api/v10/guilds/${guildId}/scheduled-events?with_user_count=true`,
    { headers: { "Authorization": `Bot ${DISCORD_BOT_TOKEN}` } }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch scheduled events: ${response.status}`);
  }

  const events = await response.json();
  return events.map(event => ({
    id: event.id,
    name: event.name,
    description: event.description,
    scheduledStartTime: event.scheduled_start_time,
    scheduledEndTime: event.scheduled_end_time,
    entityType: event.entity_type,
    status: event.status,
    userCount: event.user_count,
    location: event.entity_metadata?.location,
  }));
}

/**
 * Create a scheduled event in a guild via Discord API
 */
async function createScheduledEvent(guildId, eventData) {
  if (!DISCORD_BOT_TOKEN) {
    throw new Error("DISCORD_BOT_TOKEN not configured");
  }

  const entityType = eventData.entityType || 3;
  const payload = {
    name: eventData.name,
    privacy_level: 2,
    scheduled_start_time: eventData.scheduledStartTime,
    entity_type: entityType,
  };

  if (eventData.description) payload.description = eventData.description;
  if (eventData.scheduledEndTime) payload.scheduled_end_time = eventData.scheduledEndTime;
  if (eventData.channelId && entityType !== 3) payload.channel_id = eventData.channelId;
  // For external events (entityType 3), location AND scheduled_end_time are required
  if (entityType === 3) {
    payload.entity_metadata = { location: eventData.location || "To be announced" };
    // Discord requires end time for external events - default to 3 hours after start
    if (!payload.scheduled_end_time) {
      const startTime = new Date(eventData.scheduledStartTime);
      const endTime = new Date(startTime.getTime() + 3 * 60 * 60 * 1000);
      payload.scheduled_end_time = endTime.toISOString();
    }
  }

  const response = await fetch(
    `https://discord.com/api/v10/guilds/${guildId}/scheduled-events`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bot ${DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`Failed to create event: ${errorData.message || response.status}`);
  }

  const event = await response.json();
  return {
    id: event.id,
    name: event.name,
    description: event.description,
    scheduledStartTime: event.scheduled_start_time,
    scheduledEndTime: event.scheduled_end_time,
    entityType: event.entity_type,
    status: event.status,
  };
}

/**
 * Create multiple scheduled events from text
 */
async function createMultipleScheduledEvents(guildId, eventsText, location = null, entityType = null, channelId = null) {
  const parsedEvents = parseEventsFromText(eventsText);
  
  if (parsedEvents.length === 0) {
    return {
      success: false,
      error: "Could not parse any events from the provided text.",
      created: [],
      failed: [],
    };
  }

  const results = { success: true, created: [], failed: [], total: parsedEvents.length };

  for (const event of parsedEvents) {
    try {
      // Apply entity type if provided
      if (entityType) event.entityType = entityType;
      // Apply channel ID if provided (for voice/stage events)
      if (channelId) event.channelId = channelId;
      // Apply location if provided (for external events)
      if (location && !event.location) event.location = location;
      
      const created = await createScheduledEvent(guildId, event);
      results.created.push(created);
    } catch (error) {
      results.failed.push({ name: event.name, error: error.message, scheduledStartTime: event.scheduledStartTime });
      results.success = false;
    }
  }

  return results;
}

/**
 * Preview a single scheduled event without creating it
 * Returns the parsed event data for user confirmation
 */
function previewScheduledEvent(guildId, eventData) {
  const entityTypeNames = {
    1: "Stage Channel Event",
    2: "Voice Channel Event", 
    3: "External Event",
  };
  
  const errors = [];
  
  // Validate required fields
  if (!eventData.name) errors.push("Event name is required");
  if (!eventData.scheduledStartTime) errors.push("Start time is required");
  if (!eventData.entityType) errors.push("Event type is required (1=Stage, 2=Voice, 3=External)");
  
  // Validate entity-type specific requirements
  const entityType = eventData.entityType || 3;
  if (entityType === 1 || entityType === 2) {
    if (!eventData.channelId) {
      errors.push(`Channel ID is required for ${entityTypeNames[entityType]}s`);
    }
  }
  if (entityType === 3 && !eventData.location) {
    errors.push("Location is required for External Events");
  }
  
  // Parse and format dates for display
  let startTimeFormatted = "Invalid date";
  let endTimeFormatted = null;
  
  try {
    const startDate = new Date(eventData.scheduledStartTime);
    if (!isNaN(startDate.getTime())) {
      startTimeFormatted = startDate.toLocaleString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      });
    }
    
    if (eventData.scheduledEndTime) {
      const endDate = new Date(eventData.scheduledEndTime);
      if (!isNaN(endDate.getTime())) {
        endTimeFormatted = endDate.toLocaleString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZoneName: "short",
        });
      }
    }
  } catch (e) {
    errors.push("Invalid date format");
  }
  
  return {
    valid: errors.length === 0,
    errors,
    preview: {
      name: eventData.name || "(no name)",
      description: eventData.description || "(no description)",
      eventType: entityTypeNames[entityType] || "Unknown",
      entityType,
      startTime: startTimeFormatted,
      startTimeISO: eventData.scheduledStartTime,
      endTime: endTimeFormatted,
      endTimeISO: eventData.scheduledEndTime,
      location: entityType === 3 ? (eventData.location || "(no location)") : null,
      channelId: (entityType === 1 || entityType === 2) ? eventData.channelId : null,
    },
    guildId,
    message: errors.length === 0 
      ? "Does this look correct? Reply 'yes' or 'confirm' to create this event, or tell me what to change."
      : "Please fix the errors above before creating this event.",
  };
}

/**
 * Preview multiple scheduled events without creating them
 * Returns parsed event data for user confirmation
 */
function previewMultipleScheduledEvents(guildId, eventsText, location = null, entityType = null, channelId = null) {
  const parsedEvents = parseEventsFromText(eventsText);
  
  if (parsedEvents.length === 0) {
    return {
      valid: false,
      error: "Could not parse any events from the provided text. Please use a format like:\n\nEvent Name\nMonth Day, Year · StartTime–EndTime AM/PM",
      events: [],
      totalEvents: 0,
    };
  }

  const entityTypeNames = {
    1: "Stage Channel Event",
    2: "Voice Channel Event", 
    3: "External Event",
  };

  // If channelId is provided but no explicit entityType, default to Voice Channel (2)
  // If neither channelId nor entityType provided, and location is provided, use External (3)
  let effectiveEntityType = entityType;
  if (!effectiveEntityType) {
    if (channelId) {
      effectiveEntityType = 2; // Voice Channel Event
    } else if (location) {
      effectiveEntityType = 3; // External Event
    } else {
      effectiveEntityType = 3; // Default to External if no hints
    }
  }
  
  const previews = [];
  const errors = [];

  // Validate entity-type specific requirements once
  if (effectiveEntityType === 1 || effectiveEntityType === 2) {
    if (!channelId) {
      errors.push(`Channel ID is required for ${entityTypeNames[effectiveEntityType]}s`);
    }
  }
  if (effectiveEntityType === 3 && !location) {
    errors.push("Default location is required for External Events");
  }

  for (const event of parsedEvents) {
    // Apply defaults - use the effective entity type we calculated
    const eventEntityType = effectiveEntityType;
    const eventLocation = event.location || location;
    const eventChannelId = channelId || event.channelId;
    
    // Parse and format dates for display
    let startTimeFormatted = "Invalid date";
    let endTimeFormatted = null;
    
    try {
      const startDate = new Date(event.scheduledStartTime);
      if (!isNaN(startDate.getTime())) {
        startTimeFormatted = startDate.toLocaleString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
      }
      
      if (event.scheduledEndTime) {
        const endDate = new Date(event.scheduledEndTime);
        if (!isNaN(endDate.getTime())) {
          endTimeFormatted = endDate.toLocaleString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          });
        }
      }
    } catch (e) {
      // Keep default "Invalid date"
    }

    previews.push({
      name: event.name,
      startTime: startTimeFormatted,
      startTimeISO: event.scheduledStartTime,
      endTime: endTimeFormatted,
      endTimeISO: event.scheduledEndTime,
      eventType: entityTypeNames[eventEntityType],
      entityType: eventEntityType,
      location: eventEntityType === 3 ? eventLocation : null,
      channelId: (eventEntityType === 1 || eventEntityType === 2) ? eventChannelId : null,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    events: previews,
    totalEvents: previews.length,
    guildId,
    options: {
      location,
      entityType: effectiveEntityType,
      entityTypeName: entityTypeNames[effectiveEntityType],
      channelId,
    },
    message: errors.length === 0 
      ? `Found ${previews.length} event(s). Does this look correct? Reply 'yes' or 'confirm' to create these events, or tell me what to change.`
      : "Please fix the errors above before creating these events.",
  };
}

/**
 * Search automations by name or description
 */
async function searchAutomations(guildId, query) {
  const result = await executeD1Query(
    `SELECT * FROM automations 
     WHERE guild_id = ? 
       AND (name LIKE ? OR description LIKE ?)
     ORDER BY name ASC
     LIMIT 50`,
    [guildId, `%${query}%`, `%${query}%`]
  );

  return result.results.map(automation => ({
    ...automation,
    trigger_events: automation.trigger_events ? JSON.parse(automation.trigger_events) : 
                    (automation.trigger_event ? [automation.trigger_event] : []),
    trigger_filters: automation.trigger_filters ? JSON.parse(automation.trigger_filters) : {},
    action_config: automation.action_config ? JSON.parse(automation.action_config) : {},
  }));
}

/**
 * Search commands by name or description
 */
async function searchCommands(guildId, query) {
  const result = await executeD1Query(
    `SELECT * FROM commands 
     WHERE guild_id = ? 
       AND (name LIKE ? OR description LIKE ?)
     ORDER BY name ASC
     LIMIT 50`,
    [guildId, `%${query}%`, `%${query}%`]
  );

  return result.results.map(command => ({
    ...command,
    options: command.options ? JSON.parse(command.options) : [],
    action_config: command.action_config ? JSON.parse(command.action_config) : {},
    response_embed: command.response_embed ? JSON.parse(command.response_embed) : null,
  }));
}

/**
 * Get automations by trigger event type
 */
async function getAutomationsByTrigger(guildId, triggerEvent) {
  const result = await executeD1Query(
    `SELECT * FROM automations 
     WHERE guild_id = ? 
       AND (trigger_event = ? OR trigger_events LIKE ?)
     ORDER BY name ASC`,
    [guildId, triggerEvent, `%"${triggerEvent}"%`]
  );

  return result.results.map(automation => ({
    ...automation,
    trigger_events: automation.trigger_events ? JSON.parse(automation.trigger_events) : 
                    (automation.trigger_event ? [automation.trigger_event] : []),
    trigger_filters: automation.trigger_filters ? JSON.parse(automation.trigger_filters) : {},
    action_config: automation.action_config ? JSON.parse(automation.action_config) : {},
  }));
}

/**
 * Get automations by action type
 */
async function getAutomationsByAction(guildId, actionType) {
  const result = await executeD1Query(
    `SELECT * FROM automations 
     WHERE guild_id = ? 
       AND action_type = ?
     ORDER BY name ASC`,
    [guildId, actionType]
  );

  return result.results.map(automation => ({
    ...automation,
    trigger_events: automation.trigger_events ? JSON.parse(automation.trigger_events) : 
                    (automation.trigger_event ? [automation.trigger_event] : []),
    trigger_filters: automation.trigger_filters ? JSON.parse(automation.trigger_filters) : {},
    action_config: automation.action_config ? JSON.parse(automation.action_config) : {},
  }));
}

// Define MCP tools
const TOOLS = [
  {
    name: "list_guilds",
    description: "List all Discord server (guild) IDs that have data in SpaceBot",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_event_logs",
    description: "Get event logs for a Discord server. Returns logged events like message creates, member joins, role changes, etc.",
    inputSchema: {
      type: "object",
      properties: {
        guildId: {
          type: "string",
          description: "The Discord server (guild) ID",
        },
        limit: {
          type: "number",
          description: "Maximum number of logs to return (default: 50, max: 100)",
        },
        offset: {
          type: "number",
          description: "Offset for pagination (default: 0)",
        },
        category: {
          type: "string",
          description: "Filter by event category (e.g., 'message', 'member', 'role', 'channel')",
        },
        eventType: {
          type: "string",
          description: "Filter by specific event type (e.g., 'MESSAGE_CREATE', 'MEMBER_JOIN')",
        },
      },
      required: ["guildId"],
    },
  },
  {
    name: "get_log_stats",
    description: "Get event log statistics for a Discord server, including total events and breakdown by category",
    inputSchema: {
      type: "object",
      properties: {
        guildId: {
          type: "string",
          description: "The Discord server (guild) ID",
        },
      },
      required: ["guildId"],
    },
  },
  {
    name: "get_automations",
    description: "Get all automations configured for a Discord server. Automations are event-driven rules that trigger actions. Returns: name, description, enabled status, trigger_events (what events trigger it like MEMBER_JOIN, MESSAGE_CREATE), trigger_filters (conditions to match), action_type (what action to perform), action_config (action parameters), trigger_count, last_triggered_at.",
    inputSchema: {
      type: "object",
      properties: {
        guildId: {
          type: "string",
          description: "The Discord server (guild) ID",
        },
        enabledOnly: {
          type: "boolean",
          description: "Only return enabled automations (default: false)",
        },
        limit: {
          type: "number",
          description: "Maximum number of automations to return (default: 100)",
        },
      },
      required: ["guildId"],
    },
  },
  {
    name: "get_automation",
    description: "Get details of a specific automation by ID",
    inputSchema: {
      type: "object",
      properties: {
        automationId: {
          type: "number",
          description: "The automation ID",
        },
        guildId: {
          type: "string",
          description: "The Discord server (guild) ID",
        },
      },
      required: ["automationId", "guildId"],
    },
  },
  {
    name: "get_automation_logs",
    description: "Get execution logs for automations - shows when automations were triggered and their results",
    inputSchema: {
      type: "object",
      properties: {
        guildId: {
          type: "string",
          description: "The Discord server (guild) ID",
        },
        automationId: {
          type: "number",
          description: "Filter by specific automation ID (optional)",
        },
        limit: {
          type: "number",
          description: "Maximum number of logs to return (default: 50)",
        },
      },
      required: ["guildId"],
    },
  },
  {
    name: "get_commands",
    description: "Get all custom slash commands configured for a Discord server. Returns: name, description, enabled status, options (command parameters with types like STRING, USER, CHANNEL), ephemeral (private response), action_type, action_config, response_type, response_content, response_embed, use_count, last_used_at, registered (synced to Discord), context_menu_user (shows in right-click menu).",
    inputSchema: {
      type: "object",
      properties: {
        guildId: {
          type: "string",
          description: "The Discord server (guild) ID",
        },
        enabledOnly: {
          type: "boolean",
          description: "Only return enabled commands (default: false)",
        },
        registeredOnly: {
          type: "boolean",
          description: "Only return commands registered with Discord (default: false)",
        },
        limit: {
          type: "number",
          description: "Maximum number of commands to return (default: 100)",
        },
      },
      required: ["guildId"],
    },
  },
  {
    name: "get_command",
    description: "Get details of a specific command by ID",
    inputSchema: {
      type: "object",
      properties: {
        commandId: {
          type: "number",
          description: "The command ID",
        },
        guildId: {
          type: "string",
          description: "The Discord server (guild) ID",
        },
      },
      required: ["commandId", "guildId"],
    },
  },
  {
    name: "get_command_logs",
    description: "Get usage logs for commands - shows when commands were used and their results",
    inputSchema: {
      type: "object",
      properties: {
        guildId: {
          type: "string",
          description: "The Discord server (guild) ID",
        },
        commandId: {
          type: "number",
          description: "Filter by specific command ID (optional)",
        },
        limit: {
          type: "number",
          description: "Maximum number of logs to return (default: 50)",
        },
      },
      required: ["guildId"],
    },
  },
  {
    name: "get_server_settings",
    description: "Get the settings/configuration for a Discord server, including permissions, welcome messages, and logging settings",
    inputSchema: {
      type: "object",
      properties: {
        guildId: {
          type: "string",
          description: "The Discord server (guild) ID",
        },
      },
      required: ["guildId"],
    },
  },
  {
    name: "get_server_stats",
    description: "Get the current server statistics including member count, bot count, human count, online count, boost level, and other metrics",
    inputSchema: {
      type: "object",
      properties: {
        guildId: {
          type: "string",
          description: "The Discord server (guild) ID",
        },
      },
      required: ["guildId"],
    },
  },
  {
    name: "get_server_stats_history",
    description: "Get historical server statistics over time for graphing. Returns member counts at regular intervals.",
    inputSchema: {
      type: "object",
      properties: {
        guildId: {
          type: "string",
          description: "The Discord server (guild) ID",
        },
        period: {
          type: "string",
          enum: ["24h", "7d", "30d", "90d"],
          description: "Time period to retrieve (default: 7d). 24h=hourly data, 7d/30d=daily data, 90d=weekly data",
        },
      },
      required: ["guildId"],
    },
  },
  {
    name: "get_member_growth",
    description: "Get member growth statistics showing current count and changes over 1 day, 7 days, and 30 days. Includes human vs bot breakdown.",
    inputSchema: {
      type: "object",
      properties: {
        guildId: {
          type: "string",
          description: "The Discord server (guild) ID",
        },
      },
      required: ["guildId"],
    },
  },
  {
    name: "get_aggregated_stats",
    description: "Get aggregated activity statistics including member joins/leaves, voice activity, message counts, and total events per time period",
    inputSchema: {
      type: "object",
      properties: {
        guildId: {
          type: "string",
          description: "The Discord server (guild) ID",
        },
        period: {
          type: "string",
          enum: ["24h", "7d", "30d", "90d"],
          description: "Time period to retrieve (default: 7d)",
        },
        periodType: {
          type: "string",
          enum: ["hourly", "daily"],
          description: "Granularity of the data (default: daily)",
        },
      },
      required: ["guildId"],
    },
  },
  {
    name: "get_activity_summary",
    description: "Get a summary of server activity for the last 7 days including total joins, leaves, voice hours, messages, and most active hours",
    inputSchema: {
      type: "object",
      properties: {
        guildId: {
          type: "string",
          description: "The Discord server (guild) ID",
        },
      },
      required: ["guildId"],
    },
  },
  {
    name: "get_schema_info",
    description: "Get documentation about SpaceBot's capabilities including available trigger events, action types, filter types, and template variables. Useful for understanding what automations and commands can do.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "search_automations",
    description: "Search for automations by name or description. Returns matching automations with their full configuration.",
    inputSchema: {
      type: "object",
      properties: {
        guildId: {
          type: "string",
          description: "The Discord server (guild) ID",
        },
        query: {
          type: "string",
          description: "Search text to find in automation name or description",
        },
      },
      required: ["guildId", "query"],
    },
  },
  {
    name: "search_commands",
    description: "Search for commands by name or description. Returns matching commands with their full configuration.",
    inputSchema: {
      type: "object",
      properties: {
        guildId: {
          type: "string",
          description: "The Discord server (guild) ID",
        },
        query: {
          type: "string",
          description: "Search text to find in command name or description",
        },
      },
      required: ["guildId", "query"],
    },
  },
  {
    name: "get_automations_by_trigger",
    description: "Get all automations that are triggered by a specific event type (e.g., MEMBER_JOIN, MESSAGE_CREATE, VOICE_JOIN)",
    inputSchema: {
      type: "object",
      properties: {
        guildId: {
          type: "string",
          description: "The Discord server (guild) ID",
        },
        triggerEvent: {
          type: "string",
          description: "The trigger event type (e.g., MEMBER_JOIN, MESSAGE_CREATE, VOICE_JOIN, MEMBER_LEAVE, etc.)",
        },
      },
      required: ["guildId", "triggerEvent"],
    },
  },
  {
    name: "get_automations_by_action",
    description: "Get all automations that perform a specific action type (e.g., SEND_MESSAGE, ADD_ROLE, BAN_MEMBER)",
    inputSchema: {
      type: "object",
      properties: {
        guildId: {
          type: "string",
          description: "The Discord server (guild) ID",
        },
        actionType: {
          type: "string",
          description: "The action type (e.g., SEND_MESSAGE, SEND_DM, ADD_ROLE, REMOVE_ROLE, BAN_MEMBER, KICK_MEMBER, etc.)",
        },
      },
      required: ["guildId", "actionType"],
    },
  },
  {
    name: "get_user_roles",
    description: "Get a user's roles in a specific Discord server. Returns the user's display name, join date, and all their roles with details like role name, color, position, and permissions. Useful for checking what roles a user has or verifying permissions.",
    inputSchema: {
      type: "object",
      properties: {
        guildId: {
          type: "string",
          description: "The Discord server (guild) ID",
        },
        userId: {
          type: "string",
          description: "The Discord user ID to look up",
        },
      },
      required: ["guildId", "userId"],
    },
  },
  {
    name: "get_voice_and_stage_channels",
    description: "Get all voice and stage channels in a Discord server. Use this BEFORE creating voice or stage events to find the correct channel ID.",
    inputSchema: {
      type: "object",
      properties: {
        guildId: {
          type: "string",
          description: "The Discord server (guild) ID",
        },
      },
      required: ["guildId"],
    },
  },
  {
    name: "get_scheduled_events",
    description: "Get all scheduled events for a Discord server. Returns upcoming events with names, times, locations, and RSVP counts.",
    inputSchema: {
      type: "object",
      properties: {
        guildId: {
          type: "string",
          description: "The Discord server (guild) ID",
        },
      },
      required: ["guildId"],
    },
  },
  {
    name: "create_scheduled_event",
    description: "Create a single scheduled event. Event types: 1=Stage (in stage channel), 2=Voice (in voice channel), 3=External (location/URL). For Stage/Voice events, use get_voice_and_stage_channels first to find channel IDs.",
    inputSchema: {
      type: "object",
      properties: {
        guildId: {
          type: "string",
          description: "The Discord server (guild) ID",
        },
        name: {
          type: "string",
          description: "The name of the event",
        },
        scheduledStartTime: {
          type: "string",
          description: "ISO 8601 date/time when the event starts (e.g., '2026-02-14T21:10:00.000Z')",
        },
        scheduledEndTime: {
          type: "string",
          description: "ISO 8601 date/time when the event ends",
        },
        description: {
          type: "string",
          description: "Description of the event",
        },
        entityType: {
          type: "number",
          description: "Event type: 1=Stage, 2=Voice, 3=External",
        },
        channelId: {
          type: "string",
          description: "Voice/Stage channel ID - REQUIRED for entityType 1 or 2",
        },
        location: {
          type: "string",
          description: "Location or URL - REQUIRED for entityType 3 (external events)",
        },
        generateImage: {
          type: "boolean",
          description: "Generate an AI banner image for the event (only available via Discord bot, not standalone MCP server)",
        },
      },
      required: ["guildId", "name", "scheduledStartTime", "entityType"],
    },
  },
  {
    name: "create_multiple_scheduled_events",
    description: "Create multiple scheduled events from text. All events use the same type. For Voice/Stage events, get the channel ID first using get_voice_and_stage_channels.",
    inputSchema: {
      type: "object",
      properties: {
        guildId: {
          type: "string",
          description: "The Discord server (guild) ID",
        },
        eventsText: {
          type: "string",
          description: "Text containing multiple event descriptions, separated by blank lines",
        },
        entityType: {
          type: "number",
          description: "Event type for ALL events: 1=Stage, 2=Voice, 3=External (default: 3)",
        },
        channelId: {
          type: "string",
          description: "Voice/Stage channel ID - REQUIRED if entityType is 1 or 2",
        },
        location: {
          type: "string",
          description: "Default location for external events - REQUIRED if entityType is 3",
        },
        generateImages: {
          type: "boolean",
          description: "Generate AI banner images for all events (only available via Discord bot, not standalone MCP server)",
        },
      },
      required: ["guildId", "eventsText"],
    },
  },
  // Preview tools - ALWAYS use these first before creating events
  {
    name: "preview_scheduled_event",
    description: "**ALWAYS USE THIS FIRST** before creating a scheduled event. Shows what event will be created and validates the data. Returns a preview for user confirmation. The user must confirm before the event is actually created.",
    inputSchema: {
      type: "object",
      properties: {
        guildId: {
          type: "string",
          description: "The Discord server (guild) ID",
        },
        name: {
          type: "string",
          description: "The name of the event",
        },
        scheduledStartTime: {
          type: "string",
          description: "ISO 8601 date/time when the event starts",
        },
        scheduledEndTime: {
          type: "string",
          description: "ISO 8601 date/time when the event ends",
        },
        description: {
          type: "string",
          description: "Description of the event",
        },
        entityType: {
          type: "number",
          description: "Event type: 1=Stage, 2=Voice, 3=External",
        },
        channelId: {
          type: "string",
          description: "Voice/Stage channel ID - REQUIRED for entityType 1 or 2",
        },
        location: {
          type: "string",
          description: "Location or URL - REQUIRED for entityType 3",
        },
      },
      required: ["guildId", "name", "scheduledStartTime", "entityType"],
    },
  },
  {
    name: "preview_multiple_scheduled_events",
    description: "**ALWAYS USE THIS FIRST** before creating multiple scheduled events. Parses event text and shows ALL events that will be created with their dates and times. Returns a list for user review. The user must confirm before events are actually created.",
    inputSchema: {
      type: "object",
      properties: {
        guildId: {
          type: "string",
          description: "The Discord server (guild) ID",
        },
        eventsText: {
          type: "string",
          description: "Text containing multiple event descriptions, separated by blank lines",
        },
        entityType: {
          type: "number",
          description: "Event type for ALL events: 1=Stage, 2=Voice, 3=External (default: 3)",
        },
        channelId: {
          type: "string",
          description: "Voice/Stage channel ID - REQUIRED if entityType is 1 or 2",
        },
        location: {
          type: "string",
          description: "Default location for external events - REQUIRED if entityType is 3",
        },
      },
      required: ["guildId", "eventsText"],
    },
  },
  // Confirmation tools - use after user confirms the preview
  {
    name: "confirm_scheduled_event",
    description: "Create a scheduled event AFTER the user has reviewed and confirmed the preview. Only use this after showing the preview and receiving user confirmation.",
    inputSchema: {
      type: "object",
      properties: {
        guildId: {
          type: "string",
          description: "The Discord server (guild) ID",
        },
        name: {
          type: "string",
          description: "The name of the event",
        },
        scheduledStartTime: {
          type: "string",
          description: "ISO 8601 date/time when the event starts",
        },
        scheduledEndTime: {
          type: "string",
          description: "ISO 8601 date/time when the event ends",
        },
        description: {
          type: "string",
          description: "Description of the event",
        },
        entityType: {
          type: "number",
          description: "Event type: 1=Stage, 2=Voice, 3=External",
        },
        channelId: {
          type: "string",
          description: "Voice/Stage channel ID - REQUIRED for entityType 1 or 2",
        },
        location: {
          type: "string",
          description: "Location or URL - REQUIRED for entityType 3",
        },
      },
      required: ["guildId", "name", "scheduledStartTime", "entityType"],
    },
  },
  {
    name: "confirm_multiple_scheduled_events",
    description: "Create multiple scheduled events AFTER the user has reviewed and confirmed the preview. Only use this after showing the preview and receiving user confirmation.",
    inputSchema: {
      type: "object",
      properties: {
        guildId: {
          type: "string",
          description: "The Discord server (guild) ID",
        },
        eventsText: {
          type: "string",
          description: "Text containing multiple event descriptions",
        },
        entityType: {
          type: "number",
          description: "Event type for ALL events: 1=Stage, 2=Voice, 3=External (default: 3)",
        },
        channelId: {
          type: "string",
          description: "Voice/Stage channel ID - REQUIRED if entityType is 1 or 2",
        },
        location: {
          type: "string",
          description: "Default location for external events - REQUIRED if entityType is 3",
        },
      },
      required: ["guildId", "eventsText"],
    },
  },
];

// Create the MCP server
const server = new Server(
  {
    name: "spacebot-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;

    switch (name) {
      case "list_guilds":
        result = await listGuilds();
        break;

      case "get_event_logs":
        result = await getEventLogs(args.guildId, {
          limit: Math.min(args.limit || 50, 100),
          offset: args.offset || 0,
          category: args.category,
          eventType: args.eventType,
        });
        break;

      case "get_log_stats":
        result = await getLogStats(args.guildId);
        break;

      case "get_automations":
        result = await getAutomations(args.guildId, {
          enabledOnly: args.enabledOnly || false,
          limit: args.limit || 100,
        });
        break;

      case "get_automation":
        result = await getAutomation(args.automationId, args.guildId);
        if (!result) {
          return {
            content: [{ type: "text", text: "Automation not found" }],
            isError: true,
          };
        }
        break;

      case "get_automation_logs":
        result = await getAutomationLogs(args.guildId, {
          automationId: args.automationId,
          limit: args.limit || 50,
        });
        break;

      case "get_commands":
        result = await getCommands(args.guildId, {
          enabledOnly: args.enabledOnly || false,
          registeredOnly: args.registeredOnly || false,
          limit: args.limit || 100,
        });
        break;

      case "get_command":
        result = await getCommand(args.commandId, args.guildId);
        if (!result) {
          return {
            content: [{ type: "text", text: "Command not found" }],
            isError: true,
          };
        }
        break;

      case "get_command_logs":
        result = await getCommandLogs(args.guildId, {
          commandId: args.commandId,
          limit: args.limit || 50,
        });
        break;

      case "get_server_settings":
        result = await getGuildSettings(args.guildId);
        break;

      case "get_server_stats":
        result = await getServerStats(args.guildId);
        if (!result) {
          return {
            content: [{ type: "text", text: "No server stats found. Stats are recorded periodically and may not be available yet." }],
            isError: false,
          };
        }
        break;

      case "get_server_stats_history":
        result = await getServerStatsHistory(args.guildId, {
          period: args.period || "7d",
        });
        break;

      case "get_member_growth":
        result = await getMemberGrowth(args.guildId);
        break;

      case "get_aggregated_stats":
        result = await getAggregatedStats(args.guildId, {
          period: args.period || "7d",
          periodType: args.periodType || "daily",
        });
        break;

      case "get_activity_summary":
        result = await getActivitySummary(args.guildId);
        break;

      case "get_schema_info":
        result = getSchemaInfo();
        break;

      case "search_automations":
        result = await searchAutomations(args.guildId, args.query);
        break;

      case "search_commands":
        result = await searchCommands(args.guildId, args.query);
        break;

      case "get_automations_by_trigger":
        result = await getAutomationsByTrigger(args.guildId, args.triggerEvent);
        break;

      case "get_automations_by_action":
        result = await getAutomationsByAction(args.guildId, args.actionType);
        break;

      case "get_user_roles":
        result = await getUserRoles(args.guildId, args.userId);
        break;

      case "get_voice_and_stage_channels":
        result = await getVoiceAndStageChannels(args.guildId);
        break;

      case "get_scheduled_events":
        result = await getScheduledEvents(args.guildId);
        break;

      case "create_scheduled_event":
        result = await createScheduledEvent(args.guildId, {
          name: args.name,
          description: args.description,
          scheduledStartTime: args.scheduledStartTime,
          scheduledEndTime: args.scheduledEndTime,
          entityType: args.entityType || 3,
          location: args.location,
          channelId: args.channelId,
        });
        break;

      case "create_multiple_scheduled_events":
        result = await createMultipleScheduledEvents(
          args.guildId,
          args.eventsText,
          args.location,
          args.entityType,
          args.channelId
        );
        break;

      case "preview_scheduled_event":
        result = previewScheduledEvent(args.guildId, {
          name: args.name,
          description: args.description,
          scheduledStartTime: args.scheduledStartTime,
          scheduledEndTime: args.scheduledEndTime,
          entityType: args.entityType || 3,
          location: args.location,
          channelId: args.channelId,
        });
        break;

      case "preview_multiple_scheduled_events":
        result = previewMultipleScheduledEvents(
          args.guildId,
          args.eventsText,
          args.location,
          args.entityType,
          args.channelId
        );
        break;

      case "confirm_scheduled_event":
        // Same as create_scheduled_event - used after user confirms preview
        result = await createScheduledEvent(args.guildId, {
          name: args.name,
          description: args.description,
          scheduledStartTime: args.scheduledStartTime,
          scheduledEndTime: args.scheduledEndTime,
          entityType: args.entityType || 3,
          location: args.location,
          channelId: args.channelId,
        });
        break;

      case "confirm_multiple_scheduled_events":
        // Same as create_multiple_scheduled_events - used after user confirms preview
        result = await createMultipleScheduledEvents(
          args.guildId,
          args.eventsText,
          args.location,
          args.entityType,
          args.channelId
        );
        break;

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// Handle resource listing (expose guild data as resources)
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  try {
    const guilds = await listGuilds();
    
    return {
      resources: guilds.map(guildId => ({
        uri: `spacebot://guild/${guildId}`,
        name: `Guild ${guildId}`,
        description: `SpaceBot data for Discord server ${guildId}`,
        mimeType: "application/json",
      })),
    };
  } catch (error) {
    return { resources: [] };
  }
});

// Handle resource reading
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  const match = uri.match(/^spacebot:\/\/guild\/(\d+)$/);
  
  if (!match) {
    throw new Error(`Invalid resource URI: ${uri}`);
  }

  const guildId = match[1];

  try {
    const [settings, automations, commands, logStats, serverStats, memberGrowth, activitySummary] = await Promise.all([
      getGuildSettings(guildId),
      getAutomations(guildId, { limit: 100 }),
      getCommands(guildId, { limit: 100 }),
      getLogStats(guildId),
      getServerStats(guildId),
      getMemberGrowth(guildId),
      getActivitySummary(guildId),
    ]);

    const data = {
      guildId,
      settings,
      automations,
      commands,
      logStats,
      serverStats,
      memberGrowth,
      activitySummary,
      schemaInfo: getSchemaInfo(),
    };

    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  } catch (error) {
    throw new Error(`Failed to read guild data: ${error.message}`);
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("SpaceBot MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
