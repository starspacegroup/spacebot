/**
 * SpaceBot MCP Server
 * 
 * Model Context Protocol server that provides read access to:
 * - Event logs
 * - Automations
 * - Commands
 * - Server settings
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
    description: "Get all automations configured for a Discord server. Automations are triggered by events and perform actions.",
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
    description: "Get all custom slash commands configured for a Discord server",
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
    const [settings, automations, commands, logStats] = await Promise.all([
      getGuildSettings(guildId),
      getAutomations(guildId, { limit: 100 }),
      getCommands(guildId, { limit: 100 }),
      getLogStats(guildId),
    ]);

    const data = {
      guildId,
      settings,
      automations,
      commands,
      logStats,
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
