/**
 * MCP HTTP Streamable Transport Endpoint
 * 
 * POST /api/v1/mcp - MCP JSON-RPC endpoint for external MCP clients
 * 
 * This provides a simple HTTP transport for MCP (Model Context Protocol).
 * External tools (Claude, Cursor, etc.) can connect using:
 *   {
 *     "url": "https://your-domain/api/v1/mcp",
 *     "headers": { "Authorization": "Bearer sb_live_..." }
 *   }
 * 
 * Supports MCP tools for reading logs, automations, commands, stats, and settings,
 * and (with the matching write scope) for enabling/disabling automations and
 * commands and scheduling channel messages. Writes use the same functions as
 * the dashboard and are logged naming the API key.
 * Auth: Bearer <api_key>
 */

import { json } from "@sveltejs/kit";
import { authenticateApiKey, hasScope } from "$lib/api-auth.js";
import { getLogs, getLogStats } from "$lib/db/logger.js";
import { getAutomations, getAutomation } from "$lib/db/automations.js";
import { getGuildCommands, getCommand } from "$lib/db/commands.js";
import { getGuildSettings } from "$lib/db/settings.js";
import { log } from "$lib/db/logger.js";
import {
  logApiKeyWrite,
  scheduleChannelMessage,
  setAutomationEnabled,
  setCommandEnabled,
} from "$lib/server/control-actions.js";

/**
 * Define MCP tools available via this endpoint
 */
const MCP_TOOLS = [
  {
    name: "get_event_logs",
    description: "Get event logs for the server. Returns recent events like message edits, member joins/leaves, role changes, etc.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max results (1-100, default 50)", default: 50 },
        offset: { type: "number", description: "Offset for pagination", default: 0 },
        event_type: { type: "string", description: "Filter by event type (e.g., MESSAGE_CREATE, MEMBER_JOIN)" },
        search: { type: "string", description: "Search in log details" },
      },
    },
    requiredScope: "logs:read",
  },
  {
    name: "get_log_stats",
    description: "Get aggregated statistics about event logs (counts by type, recent activity summary).",
    inputSchema: {
      type: "object",
      properties: {},
    },
    requiredScope: "logs:read",
  },
  {
    name: "get_automations",
    description: "List automations configured for the server. Automations execute actions when events occur.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max results (1-100, default 50)", default: 50 },
        offset: { type: "number", description: "Offset for pagination", default: 0 },
        enabled: { type: "boolean", description: "Filter by enabled/disabled status" },
      },
    },
    requiredScope: "automations:read",
  },
  {
    name: "get_automation",
    description: "Get details of a specific automation by ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "The automation ID" },
      },
      required: ["id"],
    },
    requiredScope: "automations:read",
  },
  {
    name: "get_commands",
    description: "List custom slash commands configured for the server.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max results (1-100, default 50)", default: 50 },
        offset: { type: "number", description: "Offset for pagination", default: 0 },
      },
    },
    requiredScope: "commands:read",
  },
  {
    name: "get_command",
    description: "Get details of a specific command by ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "The command ID" },
      },
      required: ["id"],
    },
    requiredScope: "commands:read",
  },
  {
    name: "get_server_stats",
    description: "Get server statistics including member counts, message activity, and daily trends.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Number of days of history (1-90, default 30)", default: 30 },
      },
    },
    requiredScope: "stats:read",
  },
  {
    name: "get_server_settings",
    description: "Get current server settings including logging and permissions.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    requiredScope: "settings:read",
  },
  {
    name: "set_automation_enabled",
    description: "Enable or disable one automation on this server.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The automation ID (numeric id or public id)" },
        enabled: { type: "boolean", description: "true to enable, false to disable" },
      },
      required: ["id", "enabled"],
    },
    requiredScope: "automations:write",
  },
  {
    name: "set_command_enabled",
    description: "Enable or disable one slash command on this server. A built-in command is toggled for this server only.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "The command ID" },
        enabled: { type: "boolean", description: "true to enable, false to disable" },
      },
      required: ["id", "enabled"],
    },
    requiredScope: "commands:write",
  },
  {
    name: "schedule_message",
    description: "Schedule a plain text message to a channel on this server at a future time.",
    inputSchema: {
      type: "object",
      properties: {
        channel_id: { type: "string", description: "Discord channel ID on this server" },
        content: { type: "string", description: "Message text (1-2000 characters)" },
        send_at: { type: "string", description: "When to send, ISO 8601 (e.g. 2026-11-01T15:00:00Z)" },
      },
      required: ["channel_id", "content", "send_at"],
    },
    requiredScope: "messages:write",
  },
];

/**
 * Handle a single MCP JSON-RPC request
 */
async function handleMcpRequest(rpcRequest, auth, db, env) {
  const { method, params, id } = rpcRequest;

  // JSON-RPC response helper
  const rpcResult = (result) => ({ jsonrpc: "2.0", id, result });
  const rpcError = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

  switch (method) {
    case "initialize": {
      return rpcResult({
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "spacebot-mcp",
          version: "1.0.0",
        },
      });
    }

    case "notifications/initialized": {
      // Client acknowledgment - no response needed for notifications
      return null;
    }

    case "tools/list": {
      // Only return tools the API key has scopes for
      const availableTools = MCP_TOOLS
        .filter((tool) => hasScope(auth, tool.requiredScope))
        .map(({ requiredScope: _requiredScope, ...tool }) => tool);

      return rpcResult({ tools: availableTools });
    }

    case "tools/call": {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};
      
      const toolDef = MCP_TOOLS.find((t) => t.name === toolName);
      if (!toolDef) {
        return rpcResult({
          content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
          isError: true,
        });
      }

      if (!hasScope(auth, toolDef.requiredScope)) {
        return rpcResult({
          content: [{ type: "text", text: `Insufficient permissions. Required scope: ${toolDef.requiredScope}` }],
          isError: true,
        });
      }

      try {
        const result = await executeTool(toolName, toolArgs, auth, db, env);
        return rpcResult({
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        });
      } catch (error) {
        log.error("[MCP] Tool execution error:", toolName, error);
        return rpcResult({
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        });
      }
    }

    case "ping": {
      return rpcResult({});
    }

    default: {
      return rpcError(-32601, `Method not found: ${method}`);
    }
  }
}

/**
 * Execute an MCP tool
 */
async function executeTool(toolName, args, auth, db, env) {
  const guildId = auth.guildId;
  switch (toolName) {
    case "get_event_logs": {
      const options = {
        limit: Math.min(args.limit || 50, 100),
        offset: args.offset || 0,
        eventType: args.event_type,
        search: args.search,
      };
      return await getLogs(db, guildId, options);
    }

    case "get_log_stats": {
      return await getLogStats(db, guildId);
    }

    case "get_automations": {
      const options = {
        limit: Math.min(args.limit || 50, 100),
        offset: args.offset || 0,
        enabled: args.enabled,
      };
      return await getAutomations(db, guildId, options);
    }

    case "get_automation": {
      const automation = await getAutomation(db, args.id, guildId);
      if (!automation) throw new Error(`Automation ${args.id} not found`);
      return automation;
    }

    case "get_commands": {
      const options = {
        limit: Math.min(args.limit || 50, 100),
        offset: args.offset || 0,
      };
      return await getGuildCommands(db, guildId, options);
    }

    case "get_command": {
      const command = await getCommand(db, args.id, guildId);
      if (!command) throw new Error(`Command ${args.id} not found`);
      return command;
    }

    case "get_server_stats": {
      const days = Math.min(args.days || 30, 90);
      
      const [statsResult, currentStats] = await Promise.all([
        db.prepare(
          `SELECT * FROM aggregated_stats 
           WHERE guild_id = ? AND period_type = 'daily'
           ORDER BY period_start DESC LIMIT ?`
        ).bind(guildId, days).all(),
        db.prepare(
          "SELECT * FROM server_stats WHERE guild_id = ? ORDER BY recorded_at DESC LIMIT 1"
        ).bind(guildId).first(),
      ]);

      return {
        current: currentStats || null,
        daily_stats: statsResult.results || [],
      };
    }

    case "get_server_settings": {
      return await getGuildSettings(db, guildId);
    }

    case "set_automation_enabled": {
      if (typeof args.enabled !== "boolean") throw new Error("enabled must be a boolean");
      if (args.id === undefined || args.id === null || args.id === "") throw new Error("id is required");
      const result = await setAutomationEnabled(db, guildId, args.id, args.enabled);
      if (!result.ok) throw new Error(result.error);
      const id = result.automation?.id ?? args.id;
      await logApiKeyWrite(db, auth, "API_AUTOMATION_TOGGLED", { id, name: result.automation?.name }, { enabled: args.enabled, via: "mcp" });
      return { success: true, id, enabled: args.enabled };
    }

    case "set_command_enabled": {
      if (typeof args.enabled !== "boolean") throw new Error("enabled must be a boolean");
      const id = Number(args.id);
      if (!Number.isInteger(id)) throw new Error("id must be a number");
      const result = await setCommandEnabled(db, env, guildId, id, args.enabled);
      if (!result.ok) throw new Error(result.error);
      await logApiKeyWrite(db, auth, "API_COMMAND_TOGGLED", { id, name: result.command?.name }, { enabled: args.enabled, via: "mcp" });
      return { success: true, id, enabled: args.enabled };
    }

    case "schedule_message": {
      const result = await scheduleChannelMessage(db, guildId, {
        channel_id: args.channel_id,
        content: args.content,
        send_at: args.send_at,
        created_by: `api_key:${auth.keyId}`,
      });
      if (!result.ok) throw new Error(result.error);
      await logApiKeyWrite(db, auth, "API_MESSAGE_SCHEDULED", { id: result.id, channel_id: args.channel_id }, { scheduled_message_id: result.id, send_at: result.send_at, via: "mcp" });
      return { success: true, id: result.id, send_at: result.send_at };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ request, platform }) {
  // Authenticate with API key
  const auth = await authenticateApiKey(request, platform);
  if (!auth.authenticated) {
    return json({ error: auth.error }, { status: auth.status });
  }

  const db = (platform as any)?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 500 });
  }

  try {
    const body = await request.json();

    // Handle batch requests (array of JSON-RPC messages)
    if (Array.isArray(body)) {
      const results = [];
      for (const req of body) {
        const result = await handleMcpRequest(req, auth, db, (platform as any)?.env);
        if (result !== null) {
          results.push(result);
        }
      }
      return json(results);
    }

    // Single request
    const result = await handleMcpRequest(body, auth, db, (platform as any)?.env);
    if (result === null) {
      // Notification - no response body
      return new Response(null, { status: 204 });
    }
    return json(result);
  } catch (error) {
    log.error("[MCP] Request error:", error);
    return json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400 }
    );
  }
}

/**
 * GET handler returns server metadata (for MCP client discovery)
 */
/** @type {import('./$types').RequestHandler} */
export async function GET({ request, platform }) {
  const auth = await authenticateApiKey(request, platform);
  if (!auth.authenticated) {
    return json({ error: auth.error }, { status: auth.status });
  }

  return json({
    name: "spacebot-mcp",
    version: "1.0.0",
    protocol: "mcp",
    description: "SpaceBot MCP Server - Access Discord server logs, automations, commands, stats, and settings",
    guild_id: auth.guildId,
    scopes: auth.scopes,
  });
}
