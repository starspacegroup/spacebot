/**
 * Commands database functions
 * Handles CRUD operations for custom slash commands
 * Shares action system with automations
 */

import { ACTION_TYPES, COMMAND_USER_SOURCES } from "./automations.js";
import { log } from "$lib/log.js";

// Re-export ACTION_TYPES and COMMAND_USER_SOURCES for use by commands
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
};

/**
 * Common option types for easy selection in UI
 */
export const COMMON_OPTION_TYPES = [
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
  "channel.id": "Channel ID where command was used",
  "channel.name": "Channel name",
  "channel.mention": "Mention the channel",
  "guild.id": "Server ID",
  "guild.name": "Server name",
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

  try {
    const result = await db.prepare(`
      INSERT INTO commands (
        guild_id, name, description, enabled,
        options, ephemeral, defer,
        action_type, action_config,
        response_type, response_content, response_embed,
        created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
export async function updateCommand(db, id, updates) {
  if (!db) {
    return { success: false, error: "Database not available" };
  }

  try {
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
      const actionConfigToStore = {};
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
 * @param {D1Database} db
 * @param {number} id
 * @param {string} guildId
 * @returns {Promise<Command|null>}
 */
export async function getCommand(db, id, guildId) {
  if (!db) return null;

  try {
    const result = await db.prepare(`
      SELECT * FROM commands WHERE id = ? AND guild_id = ?
    `).bind(id, guildId).first();

    if (!result) return null;

    return parseCommand(result);
  } catch (error) {
    log.error("Failed to get command:", error);
    return null;
  }
}

/**
 * Get a command by name for a guild
 * @param {D1Database} db
 * @param {string} name
 * @param {string} guildId
 * @returns {Promise<Command|null>}
 */
export async function getCommandByName(db, name, guildId) {
  if (!db) return null;

  try {
    const result = await db.prepare(`
      SELECT * FROM commands WHERE name = ? AND guild_id = ? AND enabled = 1
    `).bind(name.toLowerCase(), guildId).first();

    if (!result) return null;

    return parseCommand(result);
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
export async function getGuildCommands(db, guildId, options = {}) {
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
export async function getCommandLogs(db, guildId, options = {}) {
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
 * Convert command to Discord API format for registration
 * @param {Command} command
 * @returns {Object}
 */
export function toDiscordCommand(command) {
  const discordCommand = {
    name: command.name,
    description: command.description || "No description",
    type: 1, // CHAT_INPUT
  };

  if (command.options && command.options.length > 0) {
    discordCommand.options = command.options.map((opt) => ({
      name: opt.name,
      description: opt.description || "No description",
      type: opt.type,
      required: opt.required || false,
      choices: opt.choices || undefined,
    }));
  }

  return discordCommand;
}

/**
 * Build context from command interaction for action execution
 * @param {Object} interaction - Discord interaction data
 * @param {Object} guildInfo - Guild information
 * @returns {Object}
 */
export function buildCommandContext(interaction, guildInfo = {}) {
  const context = {
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
    },
    option: {},
  };

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
