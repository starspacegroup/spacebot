/**
 * Commands database functions
 * Handles CRUD operations for custom slash commands
 * Shares action system with automations
 */

import { ACTION_TYPES, COMMAND_USER_SOURCES } from "./automations.js";
import { log } from "../log.js";

// Re-export ACTION_TYPES and COMMAND_USER_SOURCES for use by commands
export const BUILT_IN_GUILD_ID = "__built_in__";

export { ACTION_TYPES, COMMAND_USER_SOURCES };

/**
 * @typedef {Object} CommandOption
 * @property {string} name - Option name (lowercase, no spaces)
 * @property {string} description - Option description
 * @property {number} type - Discord option type (3=STRING, 4=INTEGER, 5=BOOLEAN, 6=USER, 7=CHANNEL, 8=ROLE, 10=NUMBER)
 * @property {boolean} required - Whether option is required
 * @property {Array} [choices] - Predefined choices for string/integer options
 */

/**
 * @typedef {Object} Command
 * @property {number} id
 * @property {string} guild_id
 * @property {string} name - Command name
 * @property {string} description - Command description
 * @property {boolean} enabled
 * @property {CommandOption[]} options - Command parameters
 * @property {boolean} ephemeral - Response only visible to user
 * @property {boolean} defer - Defer response for long actions
 * @property {string} action_type - Action to perform
 * @property {Object} action_config - Action configuration
 * @property {string} response_type - 'message', 'embed', 'action_only'
 * @property {string} response_content - Response message template
 * @property {Object} response_embed - Embed configuration
 * @property {boolean} context_menu_user - Show in Apps menu when right-clicking a user
 * @property {boolean} registered - Synced to Discord
 * @property {string} discord_command_id - Discord's command ID
 * @property {string} created_by
 * @property {string} created_at
 * @property {string} updated_at
 * @property {number} use_count
 * @property {string} last_used_at
 */

/**
 * Discord slash command option types
 */
export const OPTION_TYPES = {
  SUB_COMMAND: { value: 1, label: "Sub Command", description: "A subcommand" },
  SUB_COMMAND_GROUP: {
    value: 2,
    label: "Sub Command Group",
    description: "A subcommand group",
  },
  STRING: { value: 3, label: "Text", description: "Text input" },
  INTEGER: { value: 4, label: "Integer", description: "Whole number" },
  BOOLEAN: { value: 5, label: "True/False", description: "Boolean choice" },
  USER: { value: 6, label: "User", description: "Select a user" },
  CHANNEL: { value: 7, label: "Channel", description: "Select a channel" },
  ROLE: { value: 8, label: "Role", description: "Select a role" },
  MENTIONABLE: { value: 9, label: "Mentionable", description: "User or role" },
  NUMBER: { value: 10, label: "Number", description: "Decimal number" },
  ATTACHMENT: { value: 11, label: "Attachment", description: "File upload" },
  CHOICE_TEXT: { value: 103, label: "Choice - Text", description: "Select from options", baseType: 3, isChoice: true },
  CHOICE_INTEGER: { value: 104, label: "Choice - Whole number", description: "Select from options", baseType: 4, isChoice: true },
};

/**
 * Common option types for easy selection in UI
 */
export const COMMON_OPTION_TYPES = [
  OPTION_TYPES.CHOICE_TEXT,
  OPTION_TYPES.CHOICE_INTEGER,
  OPTION_TYPES.STRING,
  OPTION_TYPES.INTEGER,
  OPTION_TYPES.NUMBER,
  OPTION_TYPES.BOOLEAN,
  OPTION_TYPES.USER,
  OPTION_TYPES.CHANNEL,
  OPTION_TYPES.ROLE,
];

/**
 * Template variables available for commands
 * Includes option values as {option.<name>}
 */
export const COMMAND_TEMPLATE_VARIABLES = {
  "user.id": "Command user's Discord ID",
  "user.name": "Command user's username",
  "user.mention": "Mention the command user",
  "target.id": "Right-clicked user's ID (context menu only)",
  "target.name": "Right-clicked user's username (context menu only)",
  "target.mention": "Mention the right-clicked user (context menu only)",
  "channel.id": "Channel ID where command was used",
  "channel.name": "Channel name",
  "channel.mention": "Mention the channel",
  "voice_channel.id": "User's current voice channel ID (require voice only)",
  "voice_channel.name": "User's current voice channel name (require voice only)",
  "voice_channel.mention": "Mention the user's voice channel (require voice only)",
  "guild.id": "Server ID",
  "guild.name": "Server name",
  "guild.member_count": "Total member count",
  "guild.human_count": "Human (non-bot) member count",
  "guild.bot_count": "Bot count",
  "guild.boost_count": "Number of boosts",
  "guild.boost_level": "Server boost level (0-3)",
  "option.<name>": "Value of the option with that name",
};

/**
 * Response types for commands
 */
export const RESPONSE_TYPES = {
  message: {
    label: "Text Message",
    description: "Send a simple text response",
  },
  embed: {
    label: "Embed",
    description: "Send a rich embed response",
  },
  action_only: {
    label: "Action Only",
    description: "Execute action without a visible response",
  },
};

/**
 * Discord permission flags for command restrictions
 * These correspond to Discord's permission bitfield values
 * @see https://discord.com/developers/docs/topics/permissions#permissions-bitwise-permission-flags
 */
export const PERMISSION_FLAGS = {
  ADMINISTRATOR: {
    value: "8",
    label: "Administrator",
    description: "Full server access",
  },
  MANAGE_GUILD: {
    value: "32",
    label: "Manage Server",
    description: "Can change server settings",
  },
  MANAGE_ROLES: {
    value: "268435456",
    label: "Manage Roles",
    description: "Can create and edit roles",
  },
  MANAGE_CHANNELS: {
    value: "16",
    label: "Manage Channels",
    description: "Can create and edit channels",
  },
  KICK_MEMBERS: {
    value: "2",
    label: "Kick Members",
    description: "Can kick members from the server",
  },
  BAN_MEMBERS: {
    value: "4",
    label: "Ban Members",
    description: "Can ban members from the server",
  },
  MODERATE_MEMBERS: {
    value: "1099511627776",
    label: "Moderate Members",
    description: "Can timeout members",
  },
  MANAGE_MESSAGES: {
    value: "8192",
    label: "Manage Messages",
    description: "Can delete others' messages",
  },
  MENTION_EVERYONE: {
    value: "131072",
    label: "Mention Everyone",
    description: "Can use @everyone and @here",
  },
};

/**
 * Permission presets for common use cases
 */
export const PERMISSION_PRESETS = {
  everyone: {
    value: null,
    label: "Everyone",
    description: "All members can use this command",
  },
  admin_only: {
    value: "8",
    label: "Administrators Only",
    description: "Only server administrators",
  },
  moderators: {
    value: "8192", // MANAGE_MESSAGES
    label: "Moderators",
    description: "Members who can manage messages",
  },
  managers: {
    value: "32", // MANAGE_GUILD
    label: "Server Managers",
    description: "Members who can manage the server",
  },
  custom: {
    value: "custom",
    label: "Custom Permissions",
    description: "Select specific permissions required",
  },
};

/**
 * Check whether a slash command name is already used in a guild or built-ins.
 * Context menu user commands are excluded because Discord treats those separately.
 * @param {D1Database} db
 * @param {string} guildId
 * @param {string} name
 * @param {number} [excludeId]
 * @returns {Promise<boolean>}
 */
async function isGuildOrBuiltInSlashCommandNameTaken(db, guildId, name, excludeId = null) {
  const normalizedName = String(name || "").toLowerCase();
  if (!normalizedName) return false;

  try {
    const query = excludeId === null
      ? `
        SELECT 1
        FROM commands
        WHERE lower(name) = ?
          AND coalesce(context_menu_user, 0) = 0
          AND (guild_id = ? OR guild_id = ?)
        LIMIT 1
      `
      : `
        SELECT 1
        FROM commands
        WHERE lower(name) = ?
          AND coalesce(context_menu_user, 0) = 0
          AND (guild_id = ? OR guild_id = ?)
          AND id != ?
        LIMIT 1
      `;

    const stmt = excludeId === null
      ? db.prepare(query).bind(normalizedName, guildId, BUILT_IN_GUILD_ID)
      : db.prepare(query).bind(normalizedName, guildId, BUILT_IN_GUILD_ID, excludeId);

    const existing = await stmt.first();
    return !!existing;
  } catch (error) {
    log.error("Failed to check guild slash command name overlap:", error);
    throw error;
  }
}

/**
 * Create a new command
 * @param {D1Database} db
 * @param {Partial<Command>} command
 * @returns {Promise<{success: boolean, id?: number, error?: string}>}
 */
export async function createCommand(db, command) {
  if (!db) {
    return { success: false, error: "Database not available" };
  }

  // Validate command name (lowercase, no spaces, alphanumeric + hyphens)
  const nameRegex = /^[\w-]{1,32}$/;
  if (!nameRegex.test(command.name)) {
    return {
      success: false,
      error:
        "Command name must be 1-32 characters, lowercase, alphanumeric or hyphens",
    };
  }

  // Prevent slash command name overlap inside this server and built-ins.
  if (!command.context_menu_user) {
    try {
      const taken = await isGuildOrBuiltInSlashCommandNameTaken(
        db,
        command.guild_id,
        command.name,
      );
      if (taken) {
        return {
          success: false,
          error: "A slash command with this name already exists in this server or built-in commands",
        };
      }
    } catch (error) {
      return { success: false, error: error.message || String(error) };
    }
  }

  try {
    const result = await db.prepare(`
      INSERT INTO commands (
        guild_id, name, description, enabled,
        options, ephemeral, defer,
        action_type, action_config,
        response_type, response_content, response_embed,
        default_member_permissions, dm_permission,
        context_menu_user, require_voice,
        created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      command.guild_id,
      command.name.toLowerCase(),
      command.description || "No description",
      command.enabled !== false ? 1 : 0,
      command.options ? JSON.stringify(command.options) : null,
      command.ephemeral ? 1 : 0,
      command.defer ? 1 : 0,
      command.action_type,
      JSON.stringify(command.action_config || {}),
      command.response_type || "message",
      command.response_content || null,
      command.response_embed ? JSON.stringify(command.response_embed) : null,
      command.default_member_permissions || null,
      command.dm_permission !== undefined ? (command.dm_permission ? 1 : 0) : 0,
      command.context_menu_user ? 1 : 0,
      command.require_voice ? 1 : 0,
      command.created_by || null,
    ).run();

    return { success: true, id: result.meta?.last_row_id };
  } catch (error) {
    log.error("Failed to create command:", error);
    if (error.message?.includes("UNIQUE constraint")) {
      return {
        success: false,
        error: "A command with this name already exists",
      };
    }
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Update an existing command
 * @param {D1Database} db
 * @param {number} id
 * @param {Partial<Command>} updates
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function updateCommand(db, id, updates: Record<string, any> = {}) {
  if (!db) {
    return { success: false, error: "Database not available" };
  }

  try {
    const existingRow = await db.prepare(`
      SELECT id, guild_id, name, context_menu_user
      FROM commands
      WHERE id = ?
      LIMIT 1
    `).bind(id).first();

    if (!existingRow) {
      return { success: false, error: "Command not found" };
    }

    const existingIsContextMenu = !!existingRow.context_menu_user;
    const finalName = updates.name !== undefined
      ? updates.name.toLowerCase()
      : String(existingRow.name || "").toLowerCase();
    const finalIsContextMenu = updates.context_menu_user !== undefined
      ? !!updates.context_menu_user
      : existingIsContextMenu;
    const shouldValidateGuildOverlap =
      updates.name !== undefined ||
      (updates.context_menu_user !== undefined &&
        existingIsContextMenu &&
        !finalIsContextMenu);

    // Enforce uniqueness only for slash commands in the current server + built-ins.
    if (shouldValidateGuildOverlap && !finalIsContextMenu) {
      const taken = await isGuildOrBuiltInSlashCommandNameTaken(
        db,
        existingRow.guild_id,
        finalName,
        id,
      );
      if (taken) {
        return {
          success: false,
          error: "A slash command with this name already exists in this server or built-in commands",
        };
      }
    }

    const fields = [];
    const values = [];

    if (updates.name !== undefined) {
      const nameRegex = /^[\w-]{1,32}$/;
      if (!nameRegex.test(updates.name)) {
        return {
          success: false,
          error:
            "Command name must be 1-32 characters, lowercase, alphanumeric or hyphens",
        };
      }
      fields.push("name = ?");
      values.push(updates.name.toLowerCase());
      // Mark as needing re-registration when name changes
      fields.push("registered = 0");
    }
    if (updates.description !== undefined) {
      fields.push("description = ?");
      values.push(updates.description);
      fields.push("registered = 0");
    }
    if (updates.enabled !== undefined) {
      fields.push("enabled = ?");
      values.push(updates.enabled ? 1 : 0);
    }
    if (updates.options !== undefined) {
      fields.push("options = ?");
      values.push(updates.options ? JSON.stringify(updates.options) : null);
      fields.push("registered = 0");
    }
    if (updates.ephemeral !== undefined) {
      fields.push("ephemeral = ?");
      values.push(updates.ephemeral ? 1 : 0);
    }
    if (updates.defer !== undefined) {
      fields.push("defer = ?");
      values.push(updates.defer ? 1 : 0);
    }
    if (updates.action_type !== undefined) {
      fields.push("action_type = ?");
      values.push(updates.action_type);
    }
    if (updates.action_config !== undefined || updates.actions !== undefined) {
      fields.push("action_config = ?");
      // Store actions array in action_config wrapper object
      // Don't merge with action_config to avoid circular references
      const actionConfigToStore: Record<string, any> = {};
      if (updates.actions !== undefined) {
        actionConfigToStore.actions = updates.actions;
      }
      values.push(JSON.stringify(actionConfigToStore));
    }
    if (updates.response_type !== undefined) {
      fields.push("response_type = ?");
      values.push(updates.response_type);
    }
    if (updates.response_content !== undefined) {
      fields.push("response_content = ?");
      values.push(updates.response_content);
    }
    if (updates.response_embed !== undefined) {
      fields.push("response_embed = ?");
      values.push(
        updates.response_embed ? JSON.stringify(updates.response_embed) : null,
      );
    }
    if (updates.registered !== undefined) {
      fields.push("registered = ?");
      values.push(updates.registered ? 1 : 0);
    }
    if (updates.discord_command_id !== undefined) {
      fields.push("discord_command_id = ?");
      values.push(updates.discord_command_id);
    }
    if (updates.default_member_permissions !== undefined) {
      fields.push("default_member_permissions = ?");
      values.push(updates.default_member_permissions || null);
      fields.push("registered = 0"); // Needs re-registration when permissions change
    }
    if (updates.dm_permission !== undefined) {
      fields.push("dm_permission = ?");
      values.push(updates.dm_permission ? 1 : 0);
      fields.push("registered = 0");
    }
    if (updates.context_menu_user !== undefined) {
      fields.push("context_menu_user = ?");
      values.push(updates.context_menu_user ? 1 : 0);
      fields.push("registered = 0"); // Needs re-registration when context menu changes
    }
    if (updates.require_voice !== undefined) {
      fields.push("require_voice = ?");
      values.push(updates.require_voice ? 1 : 0);
    }

    if (fields.length === 0) {
      return { success: true }; // Nothing to update
    }

    fields.push("updated_at = CURRENT_TIMESTAMP");
    values.push(id);

    await db.prepare(`
      UPDATE commands SET ${fields.join(", ")} WHERE id = ?
    `).bind(...values).run();

    return { success: true };
  } catch (error) {
    log.error("Failed to update command:", error);
    if (error.message?.includes("UNIQUE constraint")) {
      return {
        success: false,
        error: "A command with this name already exists",
      };
    }
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Delete a command
 * @param {D1Database} db
 * @param {number} id
 * @param {string} guildId
 * @returns {Promise<{success: boolean, command?: Command, error?: string}>}
 */
export async function deleteCommand(db, id, guildId) {
  if (!db) {
    return { success: false, error: "Database not available" };
  }

  try {
    // Get command first to return discord_command_id for unregistration
    const command = await getCommand(db, id, guildId);

    // Prevent deletion of built-in commands
    if (command?.is_built_in) {
      return { success: false, error: "Built-in commands cannot be deleted" };
    }

    await db.prepare(`
      DELETE FROM commands WHERE id = ? AND guild_id = ?
    `).bind(id, guildId).run();

    return { success: true, command };
  } catch (error) {
    log.error("Failed to delete command:", error);
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Get a single command by ID
 * Checks both guild-specific and built-in commands
 * @param {D1Database} db
 * @param {number} id
 * @param {string} guildId
 * @returns {Promise<Command|null>}
 */
export async function getCommand(db, id, guildId) {
  if (!db) return null;

  try {
    // Check guild-specific first
    let result = await db.prepare(`
      SELECT * FROM commands WHERE id = ? AND guild_id = ?
    `).bind(id, guildId).first();

    // Fall back to built-in commands
    if (!result) {
      result = await db.prepare(`
        SELECT * FROM commands WHERE id = ? AND guild_id = '__built_in__'
      `).bind(id).first();
    }

    if (!result) return null;

    return parseCommand(result);
  } catch (error) {
    log.error("Failed to get command:", error);
    return null;
  }
}

/**
 * Get a command by name for a guild
 * Falls back to built-in commands if no guild-specific command is found
 * @param {D1Database} db
 * @param {string} name
 * @param {string} guildId
 * @returns {Promise<Command|null>}
 */
export async function getCommandByName(db, name, guildId) {
  if (!db) return null;

  try {
    // First check guild-specific commands
    const result = await db.prepare(`
      SELECT * FROM commands WHERE name = ? AND guild_id = ? AND enabled = 1
    `).bind(name.toLowerCase(), guildId).first();

    if (result) return parseCommand(result);

    // Fall back to built-in commands
    const builtIn = await db.prepare(`
      SELECT c.*
      FROM commands c
      LEFT JOIN built_in_command_overrides o
        ON o.command_id = c.id AND o.guild_id = ?
      WHERE c.name = ?
        AND c.guild_id = '__built_in__'
        AND COALESCE(o.enabled, c.enabled) = 1
    `).bind(guildId, name.toLowerCase()).first();

    if (builtIn) return parseCommand(builtIn);

    return null;
  } catch (error) {
    log.error("Failed to get command by name:", error);
    return null;
  }
}

/**
 * Get all commands for a guild
 * @param {D1Database} db
 * @param {string} guildId
 * @param {Object} options
 * @returns {Promise<Command[]>}
 */
export async function getGuildCommands(db, guildId, options: { enabledOnly?: boolean; limit?: number } = {}) {
  if (!db) return [];

  try {
    let query = "SELECT * FROM commands WHERE guild_id = ?";
    const params = [guildId];

    if (options.enabledOnly) {
      query += " AND enabled = 1";
    }

    query += " ORDER BY name ASC";

    if (options.limit) {
      query += " LIMIT ?";
      params.push(options.limit);
    }

    const { results } = await db.prepare(query).bind(...params).all();

    return results.map(parseCommand);
  } catch (error) {
    log.error("Failed to get guild commands:", error);
    return [];
  }
}

/**
 * Get commands that need registration (new or updated)
 * @param {D1Database} db
 * @param {string} guildId
 * @returns {Promise<Command[]>}
 */
export async function getUnregisteredCommands(db, guildId) {
  if (!db) return [];

  try {
    const { results } = await db.prepare(`
      SELECT * FROM commands 
      WHERE guild_id = ? AND enabled = 1 AND registered = 0
      ORDER BY name ASC
    `).bind(guildId).all();

    return results.map(parseCommand);
  } catch (error) {
    log.error("Failed to get unregistered commands:", error);
    return [];
  }
}

/**
 * Mark command as registered with Discord
 * @param {D1Database} db
 * @param {number} id
 * @param {string} discordCommandId
 */
export async function markCommandRegistered(db, id, discordCommandId) {
  if (!db) return;

  try {
    await db.prepare(`
      UPDATE commands 
      SET registered = 1, discord_command_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(discordCommandId, id).run();
  } catch (error) {
    log.error("Failed to mark command registered:", error);
  }
}

/**
 * Record command usage
 * @param {D1Database} db
 * @param {number} commandId
 */
export async function recordCommandUse(db, commandId) {
  if (!db) return;

  try {
    await db.prepare(`
      UPDATE commands 
      SET use_count = use_count + 1, last_used_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(commandId).run();
  } catch (error) {
    log.error("Failed to record command use:", error);
  }
}

/**
 * Log command execution
 * @param {D1Database} db
 * @param {Object} log
 */
export async function logCommandExecution(db, log) {
  if (!db) return;

  try {
    await db.prepare(`
      INSERT INTO command_logs (
        command_id, guild_id, user_id, user_name, channel_id,
        options_used, action_result, success, error_message, execution_time_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      log.command_id,
      log.guild_id,
      log.user_id,
      log.user_name || null,
      log.channel_id || null,
      log.options_used ? JSON.stringify(log.options_used) : null,
      log.action_result ? JSON.stringify(log.action_result) : null,
      log.success ? 1 : 0,
      log.error_message || null,
      log.execution_time_ms || null,
    ).run();
  } catch (error) {
    log.error("Failed to log command execution:", error);
  }
}

/**
 * Get command logs
 * @param {D1Database} db
 * @param {string} guildId
 * @param {Object} options
 * @returns {Promise<Array>}
 */
export async function getCommandLogs(db, guildId, options: { commandId?: number; limit?: number } = {}) {
  if (!db) return [];

  try {
    let query = `
      SELECT cl.*, c.name as command_name
      FROM command_logs cl
      LEFT JOIN commands c ON cl.command_id = c.id
      WHERE cl.guild_id = ?
    `;
    const params = [guildId];

    if (options.commandId) {
      query += " AND cl.command_id = ?";
      params.push(options.commandId);
    }

    query += " ORDER BY cl.created_at DESC";

    if (options.limit) {
      query += " LIMIT ?";
      params.push(options.limit);
    }

    const { results } = await db.prepare(query).bind(...params).all();

    return results.map((log) => ({
      ...log,
      success: !!log.success,
      options_used: log.options_used ? JSON.parse(log.options_used) : null,
      action_result: log.action_result ? JSON.parse(log.action_result) : null,
    }));
  } catch (error) {
    log.error("Failed to get command logs:", error);
    return [];
  }
}

/**
 * Parse command from database row
 */
function parseCommand(row) {
  const parsed = {
    ...row,
    enabled: !!row.enabled,
    ephemeral: !!row.ephemeral,
    defer: !!row.defer,
    registered: !!row.registered,
    dm_permission: !!row.dm_permission,
    require_voice: !!row.require_voice,
    is_built_in: !!row.is_built_in,
    options: row.options ? JSON.parse(row.options) : [],
    action_config: row.action_config ? JSON.parse(row.action_config) : {},
    response_embed: row.response_embed ? JSON.parse(row.response_embed) : null,
  };

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
}

/**
 * Get all built-in commands
 * @param {D1Database} db
 * @returns {Promise<Command[]>}
 */
export async function getBuiltInCommands(db) {
  if (!db) return [];

  try {
    const { results } = await db.prepare(
      "SELECT * FROM commands WHERE guild_id = ? ORDER BY name ASC"
    ).bind(BUILT_IN_GUILD_ID).all();

    return results.map(parseCommand);
  } catch (error) {
    log.error("Failed to get built-in commands:", error);
    return [];
  }
}

/**
 * Get a single built-in command by ID
 * @param {D1Database} db
 * @param {number} id
 * @returns {Promise<Command|null>}
 */
export async function getBuiltInCommand(db, id) {
  if (!db) return null;

  try {
    const result = await db.prepare(
      "SELECT * FROM commands WHERE id = ? AND guild_id = ?"
    ).bind(id, BUILT_IN_GUILD_ID).first();

    if (!result) return null;
    return parseCommand(result);
  } catch (error) {
    log.error("Failed to get built-in command:", error);
    return null;
  }
}

function applyBuiltInOverride(command, override) {
  if (!override) return command;

  return {
    ...command,
    enabled: override.enabled === null || override.enabled === undefined
      ? command.enabled
      : !!override.enabled,
    default_member_permissions:
      override.default_member_permissions === null || override.default_member_permissions === undefined
        ? command.default_member_permissions
        : override.default_member_permissions,
    has_guild_override: true,
  };
}

/**
 * Get all built-in command overrides for a guild.
 * @param {D1Database} db
 * @param {string} guildId
 * @returns {Promise<Map<number, {enabled: number|null, default_member_permissions: string|null}>>}
 */
export async function getBuiltInCommandOverrides(db, guildId) {
  const overrides = new Map();
  if (!db || !guildId) return overrides;

  try {
    const { results } = await db.prepare(`
      SELECT command_id, enabled, default_member_permissions
      FROM built_in_command_overrides
      WHERE guild_id = ?
    `).bind(guildId).all();

    for (const row of results || []) {
      overrides.set(Number(row.command_id), {
        enabled: row.enabled,
        default_member_permissions: row.default_member_permissions,
      });
    }

    return overrides;
  } catch (error) {
    log.error("Failed to get built-in command overrides:", error);
    return overrides;
  }
}

/**
 * Set or clear guild-specific override values for a built-in command.
 * Passing null or undefined clears that override value.
 * @param {D1Database} db
 * @param {string} guildId
 * @param {number} commandId
 * @param {{enabled?: boolean|null, default_member_permissions?: string|null}} updates
 */
export async function setBuiltInCommandOverride(db, guildId, commandId, updates: { enabled?: boolean | null; default_member_permissions?: string | null } = {}) {
  if (!db) {
    return { success: false, error: "Database not available" };
  }

  try {
    const command = await getBuiltInCommand(db, commandId);
    if (!command) {
      return { success: false, error: "Built-in command not found" };
    }

    const current = await db.prepare(`
      SELECT enabled, default_member_permissions
      FROM built_in_command_overrides
      WHERE guild_id = ? AND command_id = ?
    `).bind(guildId, commandId).first();

    const nextEnabled = updates.enabled === undefined
      ? (current?.enabled ?? null)
      : (updates.enabled === null ? null : (updates.enabled ? 1 : 0));

    const nextDefaultMemberPermissions = updates.default_member_permissions === undefined
      ? (current?.default_member_permissions ?? null)
      : (updates.default_member_permissions || null);

    // If there are no override values left, remove the row entirely.
    if (nextEnabled === null && nextDefaultMemberPermissions === null) {
      await db.prepare(`
        DELETE FROM built_in_command_overrides
        WHERE guild_id = ? AND command_id = ?
      `).bind(guildId, commandId).run();
      return { success: true };
    }

    await db.prepare(`
      INSERT INTO built_in_command_overrides (
        guild_id, command_id, enabled, default_member_permissions, updated_at
      ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(guild_id, command_id)
      DO UPDATE SET
        enabled = excluded.enabled,
        default_member_permissions = excluded.default_member_permissions,
        updated_at = CURRENT_TIMESTAMP
    `).bind(
      guildId,
      commandId,
      nextEnabled,
      nextDefaultMemberPermissions,
    ).run();

    return { success: true };
  } catch (error) {
    log.error("Failed to set built-in command override:", error);
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Get all built-in commands with guild-specific override values applied.
 * @param {D1Database} db
 * @param {string} guildId
 * @returns {Promise<Command[]>}
 */
export async function getBuiltInCommandsForGuild(db, guildId) {
  const builtInCommands = await getBuiltInCommands(db);
  if (!guildId || builtInCommands.length === 0) return builtInCommands;

  const overrideMap = await getBuiltInCommandOverrides(db, guildId);
  return builtInCommands.map((command) => applyBuiltInOverride(command, overrideMap.get(command.id)));
}

/**
 * Get one built-in command with guild-specific override values applied.
 * @param {D1Database} db
 * @param {string} guildId
 * @param {number} id
 * @returns {Promise<Command|null>}
 */
export async function getBuiltInCommandForGuild(db, guildId, id) {
  const command = await getBuiltInCommand(db, id);
  if (!command || !guildId) return command;

  const override = await db.prepare(`
    SELECT enabled, default_member_permissions
    FROM built_in_command_overrides
    WHERE guild_id = ? AND command_id = ?
  `).bind(guildId, id).first();

  return applyBuiltInOverride(command, override);
}

/**
 * Delete a built-in command (superadmin only)
 * @param {D1Database} db
 * @param {number} id
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deleteBuiltInCommand(db, id) {
  if (!db) {
    return { success: false, error: "Database not available" };
  }

  try {
    const command = await getBuiltInCommand(db, id);
    if (!command) {
      return { success: false, error: "Built-in command not found" };
    }

    await db.prepare(
      "DELETE FROM commands WHERE id = ? AND guild_id = ?"
    ).bind(id, BUILT_IN_GUILD_ID).run();

    return { success: true };
  } catch (error) {
    log.error("Failed to delete built-in command:", error);
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Create a built-in command (superadmin only)
 * @param {D1Database} db
 * @param {Object} command
 * @returns {Promise<{success: boolean, id?: number, error?: string}>}
 */
export async function createBuiltInCommand(db, command) {
  if (!db) {
    return { success: false, error: "Database not available" };
  }

  const nameRegex = /^[\w-]{1,32}$/;
  if (!nameRegex.test(command.name)) {
    return {
      success: false,
      error: "Command name must be 1-32 characters, lowercase, alphanumeric or hyphens",
    };
  }

  try {
    const taken = await isGuildOrBuiltInSlashCommandNameTaken(
      db,
      BUILT_IN_GUILD_ID,
      command.name,
    );
    if (taken) {
      return {
        success: false,
        error: "A slash command with this name already exists in built-in commands",
      };
    }
  } catch (error) {
    return { success: false, error: error.message || String(error) };
  }

  try {
    const result = await db.prepare(`
      INSERT INTO commands (
        guild_id, name, description, enabled, is_built_in,
        options, ephemeral, defer,
        action_type, action_config,
        response_type, response_content, response_embed,
        created_by
      ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      BUILT_IN_GUILD_ID,
      command.name.toLowerCase(),
      command.description || "No description",
      command.enabled !== false ? 1 : 0,
      command.options ? JSON.stringify(command.options) : null,
      command.ephemeral ? 1 : 0,
      command.defer ? 1 : 0,
      command.action_type || "NONE",
      JSON.stringify(command.action_config || {}),
      command.response_type || "message",
      command.response_content || null,
      command.response_embed ? JSON.stringify(command.response_embed) : null,
      command.created_by || "superadmin",
    ).run();

    return { success: true, id: result.meta?.last_row_id };
  } catch (error) {
    log.error("Failed to create built-in command:", error);
    if (error.message?.includes("UNIQUE constraint")) {
      return { success: false, error: "A command with this name already exists" };
    }
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Default built-in command definitions for seeding
 */
export const BUILT_IN_COMMAND_DEFAULTS = [
  {
    name: "ping",
    description: "Check if the bot is responsive",
    response_type: "message",
    response_content: "Pong! 🏓",
    response_embed: null,
  },
  {
    name: "info",
    description: "View bot information and statistics",
    response_type: "embed",
    response_content: null,
    response_embed: {
      title: "📊 SpaceBot Info",
      color: 0x5865F2,
      fields: [
        { name: "⚡ Platform", value: "Cloudflare Workers", inline: true },
        { name: "🔧 Framework", value: "SvelteKit", inline: true },
        { name: "🌐 API Version", value: "Discord API v10", inline: true },
      ],
      footer: { text: "SpaceBot • Powered by Starspace" },
    },
  },
  {
    name: "help",
    description: "Get help with bot commands",
    dm_permission: true,
    response_type: "embed",
    response_content: null,
    response_embed: {
      title: "🚀 SpaceBot Help",
      description:
        "Welcome to SpaceBot! Use /ping to check if the bot is online, /info for bot details, and /help for this message. Custom commands are configured by your server admin.",
      color: 0x57F287,
      fields: [
        {
          name: "🔗 Links",
          value: "[GitHub](https://github.com/starspacegroup/spacebot)",
          inline: false,
        },
      ],
      footer: { text: "Use /command to run a command" },
    },
  },
  {
    name: "stats",
    description: "Show server stats charts and voice leaderboards",
    response_type: "action_only",
    response_content: null,
    response_embed: null,
    options: [
      {
        name: "type",
        description: "Which stats to show",
        type: 3,
        required: false,
        choices: [
          { name: "Voice Leaderboard", value: "voice_leaderboard" },
          { name: "Voice Time", value: "voice_time" },
          { name: "Voice Users", value: "voice_users" },
          { name: "Voice Peak", value: "voice_peak" },
          { name: "Member Count", value: "member_count" },
          { name: "Member Growth", value: "member_growth" },
          { name: "Member Joins", value: "member_joins" },
          { name: "Member Leaves", value: "member_leaves" },
          { name: "Member Net Change", value: "member_net_change" },
          { name: "Message Count", value: "message_count" },
          { name: "Message Authors", value: "message_users" },
        ],
      },
      {
        name: "period",
        description: "Time period",
        type: 3,
        required: false,
        choices: [
          { name: "Last 30 days", value: "30d" },
          { name: "Last 7 days", value: "7d" },
        ],
      },
    ],
  },
];

/**
 * Ensure built-in commands exist in the database.
 * Creates any missing built-in commands. Should be called during startup/sync.
 * @param {D1Database} db
 * @returns {Promise<void>}
 */
export async function ensureBuiltInCommands(db) {
  if (!db) return;

  try {
    for (const cmd of BUILT_IN_COMMAND_DEFAULTS) {
      const existing = await db.prepare(
        "SELECT id FROM commands WHERE guild_id = ? AND name = ?"
      ).bind(BUILT_IN_GUILD_ID, cmd.name).first();

      if (!existing) {
        await db.prepare(`
          INSERT INTO commands (
            guild_id, name, description, enabled, is_built_in,
            options, ephemeral, defer,
            action_type, action_config,
            response_type, response_content, response_embed,
            dm_permission, created_by
          ) VALUES (?, ?, ?, 1, 1, ?, 0, 0, 'NONE', '{}', ?, ?, ?, ?, 'system')
        `).bind(
          BUILT_IN_GUILD_ID,
          cmd.name,
          cmd.description,
          cmd.options ? JSON.stringify(cmd.options) : null,
          cmd.response_type,
          cmd.response_content,
          cmd.response_embed ? JSON.stringify(cmd.response_embed) : null,
          cmd.dm_permission ? 1 : 0,
        ).run();

        log.info(`Created built-in command: ${cmd.name}`);
      } else if (cmd.name === "stats") {
        // Keep built-in /stats choices current when new widget types are added.
        await db.prepare(`
          UPDATE commands
          SET options = ?, description = ?, updated_at = datetime('now')
          WHERE id = ?
        `).bind(
          cmd.options ? JSON.stringify(cmd.options) : null,
          cmd.description,
          existing.id,
        ).run();
      } else if (cmd.name === "help") {
        // Keep /help available in DMs for existing databases.
        await db.prepare(`
          UPDATE commands
          SET dm_permission = 1, updated_at = datetime('now')
          WHERE id = ?
        `).bind(existing.id).run();
      }
    }
  } catch (error) {
    log.error("Failed to ensure built-in commands:", error);
  }
}

/**
 * Discord command types
 */
export const COMMAND_TYPES = {
  CHAT_INPUT: 1, // Slash command
  USER: 2, // User context menu command (right-click on user)
  MESSAGE: 3, // Message context menu command (right-click on message)
};

/**
 * Convert command to Discord API format for registration
 * Returns an array of commands if context_menu_user is enabled (slash + user context menu)
 * @param {Command} command
 * @returns {Object|Object[]}
 */
export function toDiscordCommand(command) {
  const baseCommand: Record<string, any> = {
    name: command.name,
    description: command.description || "No description",
    type: COMMAND_TYPES.CHAT_INPUT,
  };

  if (command.options && command.options.length > 0) {
    baseCommand.options = command.options.map((opt) => ({
      name: opt.name,
      description: opt.description || "No description",
      type: opt.type,
      required: opt.required || false,
      choices: opt.choices || undefined,
    }));
  }

  // Add permission restrictions if set
  if (command.default_member_permissions !== null && command.default_member_permissions !== undefined) {
    baseCommand.default_member_permissions = command.default_member_permissions;
  }

  // DM permission (false by default for guild commands)
  baseCommand.dm_permission = command.dm_permission === 1 || command.dm_permission === true;

  // If context_menu_user is enabled, also create a USER type context menu command
  if (command.context_menu_user === 1 || command.context_menu_user === true) {
    const userContextCommand: Record<string, any> = {
      name: command.name,
      type: COMMAND_TYPES.USER, // USER context menu command
    };
    
    // Add permission restrictions if set
    if (command.default_member_permissions !== null && command.default_member_permissions !== undefined) {
      userContextCommand.default_member_permissions = command.default_member_permissions;
    }
    
    userContextCommand.dm_permission = command.dm_permission === 1 || command.dm_permission === true;
    
    // Return both commands
    return [baseCommand, userContextCommand];
  }

  return baseCommand;
}

/**
 * Build context from command interaction for action execution
 * @param {Object} interaction - Discord interaction data
 * @param {Object} guildInfo - Guild information
 * @param {Object} [voiceState] - User's voice state (if require_voice is enabled)
 * @returns {Object}
 */
export function buildCommandContext(interaction, guildInfo: Record<string, any> = {}, voiceState = null) {
  const context: Record<string, any> = {
    user: {
      id: interaction.member?.user?.id || interaction.user?.id,
      name: interaction.member?.user?.username || interaction.user?.username,
      mention: `<@${interaction.member?.user?.id || interaction.user?.id}>`,
    },
    channel: {
      id: interaction.channel_id,
      mention: `<#${interaction.channel_id}>`,
    },
    guild: {
      id: interaction.guild_id,
      name: guildInfo.name || "Unknown Server",
      member_count: guildInfo.member_count ?? "",
      human_count: guildInfo.human_count ?? "",
      bot_count: guildInfo.bot_count ?? "",
      boost_count: guildInfo.boost_count ?? "",
      boost_level: guildInfo.boost_level ?? "",
    },
    option: {},
  };

  // Add voice channel info if available
  if (voiceState) {
    context.voice_channel = {
      id: voiceState.channel_id,
      name: voiceState.channel_name || "",
      mention: voiceState.channel_id ? `<#${voiceState.channel_id}>` : "",
    };
  }

  // For user context menu commands, add target user info
  // data.type === 2 means USER context menu command
  if (interaction.data?.type === 2 && interaction.data?.target_id) {
    const targetId = interaction.data.target_id;
    // Get resolved user data if available
    const resolvedUser = interaction.data.resolved?.users?.[targetId];
    
    context.target = {
      id: targetId,
      name: resolvedUser?.username || "Unknown",
      mention: `<@${targetId}>`,
    };
    
    // Also add as an option called "user" for consistency with actions
    context.option.user = targetId;
    context.option.user_mention = `<@${targetId}>`;
  }

  // Add option values to context
  if (interaction.data?.options) {
    for (const opt of interaction.data.options) {
      context.option[opt.name] = opt.value;

      // For user/role/channel options, also add mention format
      if (opt.type === 6) { // USER
        context.option[`${opt.name}_mention`] = `<@${opt.value}>`;
      } else if (opt.type === 7) { // CHANNEL
        context.option[`${opt.name}_mention`] = `<#${opt.value}>`;
      } else if (opt.type === 8) { // ROLE
        context.option[`${opt.name}_mention`] = `<@&${opt.value}>`;
      }
    }
  }

  return context;
}
