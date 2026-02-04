/**
 * MCP Client for Discord Bot
 * 
 * This module provides a client interface to call MCP tools from within
 * the Discord gateway. Instead of running as a stdio server, these functions
 * can be called directly with the Cloudflare API credentials.
 */

import { log } from "../log.js";

/**
 * MCP Client class that connects to D1 database via Cloudflare API
 */
export class MCPClient {
  constructor(options = {}) {
    this.accountId = options.accountId || process.env.CLOUDFLARE_ACCOUNT_ID;
    this.apiToken = options.apiToken || process.env.CLOUDFLARE_API_TOKEN;
    this.databaseId = options.databaseId || process.env.D1_DATABASE_ID || "6bce735c-2dca-43cd-9911-2eef7062377a";
  }

  /**
   * Check if the client is properly configured
   */
  isConfigured() {
    return Boolean(this.accountId && this.apiToken);
  }

  /**
   * Execute a query against the D1 database via Cloudflare API
   */
  async executeD1Query(sql, params = []) {
    if (!this.isConfigured()) {
      throw new Error("MCP Client not configured: Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN");
    }

    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/d1/database/${this.databaseId}/query`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sql, params }),
      }
    );

    const data = await response.json();
    
    if (!data.success) {
      throw new Error(`D1 query failed: ${JSON.stringify(data.errors)}`);
    }

    return data.result[0];
  }

  /**
   * List all guild IDs that have data in SpaceBot
   */
  async listGuilds() {
    const [logsResult, automationsResult, commandsResult, settingsResult] = await Promise.all([
      this.executeD1Query("SELECT DISTINCT guild_id FROM event_logs"),
      this.executeD1Query("SELECT DISTINCT guild_id FROM automations"),
      this.executeD1Query("SELECT DISTINCT guild_id FROM commands"),
      this.executeD1Query("SELECT DISTINCT guild_id FROM guild_settings"),
    ]);

    const guildIds = new Set([
      ...logsResult.results.map(r => r.guild_id),
      ...automationsResult.results.map(r => r.guild_id),
      ...commandsResult.results.map(r => r.guild_id),
      ...settingsResult.results.map(r => r.guild_id),
    ]);

    return Array.from(guildIds);
  }

  /**
   * Get event logs for a guild
   */
  async getEventLogs(guildId, options = {}) {
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

    const result = await this.executeD1Query(sql, params);
    
    return result.results.map(logEntry => ({
      ...logEntry,
      details: logEntry.details ? JSON.parse(logEntry.details) : null,
    }));
  }

  /**
   * Get log statistics for a guild
   */
  async getLogStats(guildId) {
    const [totalResult, categoryResult, recentResult] = await Promise.all([
      this.executeD1Query(
        "SELECT COUNT(*) as total FROM event_logs WHERE guild_id = ?",
        [guildId]
      ),
      this.executeD1Query(
        `SELECT event_category, COUNT(*) as count 
         FROM event_logs WHERE guild_id = ?
         GROUP BY event_category`,
        [guildId]
      ),
      this.executeD1Query(
        `SELECT event_type, COUNT(*) as count 
         FROM event_logs WHERE guild_id = ?
         GROUP BY event_type ORDER BY count DESC LIMIT 10`,
        [guildId]
      ),
    ]);

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
  async getAutomations(guildId, options = {}) {
    const { enabledOnly = false, limit = 100 } = options;
    
    let sql = "SELECT * FROM automations WHERE guild_id = ?";
    const params = [guildId];

    if (enabledOnly) {
      sql += " AND enabled = 1";
    }

    sql += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);

    const result = await this.executeD1Query(sql, params);
    
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
  async getAutomation(automationId, guildId) {
    const result = await this.executeD1Query(
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
  async getAutomationLogs(guildId, options = {}) {
    const { automationId, limit = 50 } = options;
    
    let sql = "SELECT * FROM automation_logs WHERE guild_id = ?";
    const params = [guildId];

    if (automationId) {
      sql += " AND automation_id = ?";
      params.push(automationId);
    }

    sql += " ORDER BY executed_at DESC LIMIT ?";
    params.push(limit);

    const result = await this.executeD1Query(sql, params);
    
    return result.results.map(logEntry => ({
      ...logEntry,
      trigger_data: logEntry.trigger_data ? JSON.parse(logEntry.trigger_data) : null,
      result_data: logEntry.result_data ? JSON.parse(logEntry.result_data) : null,
    }));
  }

  /**
   * Get commands for a guild
   */
  async getCommands(guildId, options = {}) {
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

    const result = await this.executeD1Query(sql, params);
    
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
  async getCommand(commandId, guildId) {
    const result = await this.executeD1Query(
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
  async getCommandLogs(guildId, options = {}) {
    const { commandId, limit = 50 } = options;
    
    let sql = "SELECT * FROM command_logs WHERE guild_id = ?";
    const params = [guildId];

    if (commandId) {
      sql += " AND command_id = ?";
      params.push(commandId);
    }

    sql += " ORDER BY executed_at DESC LIMIT ?";
    params.push(limit);

    const result = await this.executeD1Query(sql, params);
    
    return result.results.map(logEntry => ({
      ...logEntry,
      options_used: logEntry.options_used ? JSON.parse(logEntry.options_used) : null,
      result_data: logEntry.result_data ? JSON.parse(logEntry.result_data) : null,
    }));
  }

  /**
   * Get server settings for a guild
   */
  async getGuildSettings(guildId) {
    const result = await this.executeD1Query(
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
   * Execute a tool by name with the given arguments
   * This is the main entry point for AI tool calling
   */
  async executeTool(toolName, args = {}) {
    log.debug(`[MCP] Executing tool: ${toolName}`, args);

    try {
      switch (toolName) {
        case "list_guilds":
          return { success: true, data: await this.listGuilds() };

        case "get_event_logs":
          return { 
            success: true, 
            data: await this.getEventLogs(args.guildId, {
              limit: Math.min(args.limit || 20, 50),
              offset: args.offset || 0,
              category: args.category,
              eventType: args.eventType,
            })
          };

        case "get_log_stats":
          return { success: true, data: await this.getLogStats(args.guildId) };

        case "get_automations":
          return { 
            success: true, 
            data: await this.getAutomations(args.guildId, {
              enabledOnly: args.enabledOnly || false,
              limit: args.limit || 20,
            })
          };

        case "get_automation":
          const automation = await this.getAutomation(args.automationId, args.guildId);
          if (!automation) {
            return { success: false, error: "Automation not found" };
          }
          return { success: true, data: automation };

        case "get_automation_logs":
          return { 
            success: true, 
            data: await this.getAutomationLogs(args.guildId, {
              automationId: args.automationId,
              limit: args.limit || 20,
            })
          };

        case "get_commands":
          return { 
            success: true, 
            data: await this.getCommands(args.guildId, {
              enabledOnly: args.enabledOnly || false,
              registeredOnly: args.registeredOnly || false,
              limit: args.limit || 20,
            })
          };

        case "get_command":
          const command = await this.getCommand(args.commandId, args.guildId);
          if (!command) {
            return { success: false, error: "Command not found" };
          }
          return { success: true, data: command };

        case "get_command_logs":
          return { 
            success: true, 
            data: await this.getCommandLogs(args.guildId, {
              commandId: args.commandId,
              limit: args.limit || 20,
            })
          };

        case "get_server_settings":
          return { success: true, data: await this.getGuildSettings(args.guildId) };

        default:
          return { success: false, error: `Unknown tool: ${toolName}` };
      }
    } catch (error) {
      log.error(`[MCP] Tool execution error:`, error.message);
      return { success: false, error: error.message };
    }
  }
}

/**
 * Tool definitions for AI function calling
 * These match the MCP tools but are formatted for Cloudflare/OpenAI function calling
 */
export const MCP_TOOLS = [
  {
    name: "list_guilds",
    description: "List all Discord server IDs that have data in SpaceBot. Use this first to see which servers have data.",
  },
  {
    name: "get_event_logs",
    description: "Get event logs for a Discord server. Shows message creates, member joins, role changes, etc.",
    parameters: {
      guildId: "string (required) - The Discord server ID",
      limit: "number (optional) - Max logs to return (default: 20)",
      category: "string (optional) - Filter by category: message, member, role, channel, guild, etc.",
      eventType: "string (optional) - Filter by event type: MESSAGE_CREATE, MEMBER_JOIN, etc.",
    },
  },
  {
    name: "get_log_stats",
    description: "Get event log statistics for a server - total events and breakdown by category",
    parameters: {
      guildId: "string (required) - The Discord server ID",
    },
  },
  {
    name: "get_automations",
    description: "Get all automations configured for a Discord server",
    parameters: {
      guildId: "string (required) - The Discord server ID",
      enabledOnly: "boolean (optional) - Only return enabled automations",
      limit: "number (optional) - Max automations to return (default: 20)",
    },
  },
  {
    name: "get_automation",
    description: "Get details of a specific automation by ID",
    parameters: {
      automationId: "number (required) - The automation ID",
      guildId: "string (required) - The Discord server ID",
    },
  },
  {
    name: "get_automation_logs",
    description: "Get execution logs for automations - when they triggered and results",
    parameters: {
      guildId: "string (required) - The Discord server ID",
      automationId: "number (optional) - Filter by specific automation",
      limit: "number (optional) - Max logs to return (default: 20)",
    },
  },
  {
    name: "get_commands",
    description: "Get all custom slash commands configured for a Discord server",
    parameters: {
      guildId: "string (required) - The Discord server ID",
      enabledOnly: "boolean (optional) - Only return enabled commands",
      registeredOnly: "boolean (optional) - Only return Discord-registered commands",
      limit: "number (optional) - Max commands to return (default: 20)",
    },
  },
  {
    name: "get_command",
    description: "Get details of a specific command by ID",
    parameters: {
      commandId: "number (required) - The command ID",
      guildId: "string (required) - The Discord server ID",
    },
  },
  {
    name: "get_command_logs",
    description: "Get usage logs for commands - when they were used and results",
    parameters: {
      guildId: "string (required) - The Discord server ID",
      commandId: "number (optional) - Filter by specific command",
      limit: "number (optional) - Max logs to return (default: 20)",
    },
  },
  {
    name: "get_server_settings",
    description: "Get settings/configuration for a Discord server",
    parameters: {
      guildId: "string (required) - The Discord server ID",
    },
  },
];

/**
 * Format tool definitions for the AI system prompt
 */
export function formatToolsForPrompt() {
  let prompt = "You have access to the following tools to help manage Discord servers:\n\n";
  
  for (const tool of MCP_TOOLS) {
    prompt += `### ${tool.name}\n${tool.description}\n`;
    if (tool.parameters) {
      prompt += "Parameters:\n";
      for (const [key, desc] of Object.entries(tool.parameters)) {
        prompt += `- ${key}: ${desc}\n`;
      }
    }
    prompt += "\n";
  }
  
  prompt += `To use a tool, respond with a JSON block in this format:
\`\`\`tool
{"tool": "tool_name", "args": {"param1": "value1", "param2": "value2"}}
\`\`\`

After receiving tool results, provide a helpful response summarizing the information for the user.
You can call multiple tools if needed by including multiple tool blocks.

IMPORTANT: Always use the server IDs from the user's managed guilds list when calling tools.`;
  
  return prompt;
}

// Create a singleton instance for the gateway
let mcpClientInstance = null;

export function getMCPClient() {
  if (!mcpClientInstance) {
    mcpClientInstance = new MCPClient();
  }
  return mcpClientInstance;
}
