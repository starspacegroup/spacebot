/**
 * Cloudflare AI Chat Module with MCP Tool Support
 * 
 * Integrates with Cloudflare Workers AI via REST API or AI Gateway
 * for LLM-based conversations with function calling capabilities.
 */

import { log } from "../log.js";
import { getMCPClient, formatToolsForPrompt, MCP_TOOLS } from "./mcp-client.js";

// Default model - Llama 3.3 70B is smarter and better at reasoning
// Other options:
//   @cf/meta/llama-3.1-8b-instruct-fast - Fast but less capable
//   @cf/meta/llama-3.1-70b-instruct - Slower but smarter
//   @cf/meta/llama-3.3-70b-instruct-fp8-fast - Best balance of speed and intelligence
const DEFAULT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

// Base system prompt for the bot assistant
const BASE_SYSTEM_PROMPT = `You are SpaceBot, a helpful Discord bot assistant created by Starspace.

## DATA SOURCES

You have TWO sources of data:

### 1. LIVE DATA (in context below) - Use for CURRENT state:
- Member count, online count, channel count, role count, emoji count, boosts
- Who's in voice chat RIGHT NOW, which voice channels are active
- Server name, ID, boost level

### 2. DATABASE TOOLS - Use for HISTORICAL data:
- "How many messages in the last week?" → Use get_activity_summary
- "Who's been most active?" → Use get_activity_summary  
- "Voice activity over the last 3 days?" → Use get_voice_activity with days=3
- "How many people joined this month?" → Use get_event_logs with since date
- Event logs, automations, commands, settings

## WHEN TO USE WHAT

**Use LIVE DATA from context for:**
- Current member/online counts
- Current voice chat status (who's in voice RIGHT NOW)
- Current channel/role/emoji counts
- Boost level

**Use get_voice_activity tool for:**
- Historical voice stats (last X days)
- Top voice users, most popular voice channels
- Total voice joins over time

**Use get_activity_summary tool for:**
- Overall server activity (messages, joins, leaves, voice, reactions)
- Top active members
- Most active channels

**Use get_event_logs tool for:**
- Specific event searches with date filters
- Finding specific users' activity
- Raw event data

## HONESTY RULES

- Only report data that comes from context or tool results
- If a tool returns empty/zero, say so honestly
- Never invent or guess numbers

Keep responses concise. Use Discord markdown.`;

/**
 * Build the full system prompt with context
 */
function buildSystemPrompt(context = {}) {
  let prompt = BASE_SYSTEM_PROMPT;
  
  // Add managed guilds context if available - including live stats
  if (context.managedGuilds && context.managedGuilds.length > 0) {
    prompt += "\n\n## User's Managed Servers (LIVE DATA)\nThe user manages the following Discord servers where SpaceBot is installed. This data is LIVE from Discord:\n";
    for (const guild of context.managedGuilds) {
      prompt += `\n### ${guild.name}${guild.isOwner ? ' [Owner]' : ''}${guild.isAdmin ? ' [Admin]' : ''}\n`;
      prompt += `- Server ID: ${guild.id}\n`;
      if (guild.memberCount !== undefined) prompt += `- Members: ${guild.memberCount}\n`;
      if (guild.onlineCount !== undefined) prompt += `- Online: ${guild.onlineCount}\n`;
      if (guild.channelCount !== undefined) prompt += `- Channels: ${guild.channelCount}\n`;
      if (guild.roleCount !== undefined) prompt += `- Roles: ${guild.roleCount}\n`;
      if (guild.emojiCount !== undefined) prompt += `- Custom Emojis: ${guild.emojiCount}\n`;
      if (guild.boostCount !== undefined) prompt += `- Boosts: ${guild.boostCount} (Level ${guild.boostLevel})\n`;
      // Voice channel stats
      if (guild.voiceMemberCount !== undefined) {
        prompt += `- Members in Voice: ${guild.voiceMemberCount}\n`;
        if (guild.voiceChannels && guild.voiceChannels.length > 0) {
          prompt += `- Active Voice Channels:\n`;
          for (const vc of guild.voiceChannels) {
            prompt += `  - ${vc.name}: ${vc.memberCount} member${vc.memberCount !== 1 ? 's' : ''}`;
            if (vc.members && vc.members.length > 0) {
              prompt += ` (${vc.members.join(', ')}${vc.memberCount > 10 ? '...' : ''})`;
            }
            prompt += `\n`;
          }
        }
      }
    }
    prompt += "\n**For basic questions like member count, voice chat, use the data above directly. Use database tools for historical stats, logs, automations, and commands.**\n";
  }
  
  // Add MCP tools if enabled, or explain the limitation
  if (context.mcpEnabled) {
    prompt += "\n\n## Available Tools\n";
    prompt += formatToolsForPrompt();
  } else {
    prompt += "\n\n## ⚠️ NO DATA ACCESS ⚠️\n";
    prompt += "Database tools are NOT available. You have ZERO access to:\n";
    prompt += "- Event logs, message counts, join counts, or ANY statistics\n";
    prompt += "- Automation names, configurations, or execution history\n";
    prompt += "- Custom command details or usage logs\n";
    prompt += "- Server settings\n\n";
    prompt += "When the user asks about ANY of the above, your ONLY valid response is:\n";
    prompt += "\"I don't have access to look up that data right now. Please check the SpaceBot dashboard at [your-dashboard-url] to see your server's logs, automations, and settings.\"\n\n";
    prompt += "DO NOT attempt to guess, estimate, or fabricate any data. You literally have no information about their server's data.";
  }
  
  return prompt;
}

/**
 * Parse tool calls from AI response
 * Looks for tool JSON in various formats
 */
function parseToolCalls(response) {
  const toolCalls = [];
  
  // Try multiple patterns the AI might use
  const patterns = [
    /```tool\s*\n([\s\S]*?)```/g,           // ```tool\n{...}```
    /```json\s*\n([\s\S]*?)```/g,           // ```json\n{...}```
    /```\s*\n(\{"tool"[\s\S]*?)```/g,       // ```\n{"tool":...}```
    /(?:^|\n)(\{"tool"\s*:\s*"[^"]+"[^}]*\})/g,  // Raw JSON with "tool" key
  ];
  
  for (const regex of patterns) {
    let match;
    while ((match = regex.exec(response)) !== null) {
      try {
        const jsonStr = match[1].trim();
        const parsed = JSON.parse(jsonStr);
        if (parsed.tool && typeof parsed.tool === "string") {
          // Avoid duplicates
          if (!toolCalls.some(t => t.tool === parsed.tool && JSON.stringify(t.args) === JSON.stringify(parsed.args || {}))) {
            toolCalls.push({
              tool: parsed.tool,
              args: parsed.args || {},
            });
            log.debug(`[AI] Parsed tool call: ${parsed.tool}`);
          }
        }
      } catch (e) {
        log.warn("[AI] Failed to parse tool call:", match[1]);
      }
    }
  }
  
  return toolCalls;
}

/**
 * Execute tool calls and return results
 */
async function executeToolCalls(toolCalls, env) {
  const mcpClient = getMCPClient(env);
  
  if (!mcpClient.isConfigured()) {
    return [{
      tool: "error",
      result: { success: false, error: "MCP client not configured - missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN" },
    }];
  }
  
  const results = [];
  
  for (const call of toolCalls) {
    log.info(`[AI] Executing tool: ${call.tool}`);
    const result = await mcpClient.executeTool(call.tool, call.args);
    results.push({
      tool: call.tool,
      args: call.args,
      result,
    });
  }
  
  return results;
}

/**
 * Summarize an automation for AI display (keeps essential info, drops verbose config)
 */
function summarizeAutomation(auto) {
  // Convert enabled 0/1 to clear status string for AI understanding
  const isEnabled = auto.enabled === 1 || auto.enabled === true;
  return {
    id: auto.id,
    name: auto.name,
    status: isEnabled ? "ACTIVE" : "INACTIVE",
    trigger_events: auto.trigger_events,
    action_type: auto.action_type,
    trigger_count: auto.trigger_count,
    created_by: auto.created_by,
    last_triggered_at: auto.last_triggered_at,
  };
}

/**
 * Summarize a command for AI display
 */
function summarizeCommand(cmd) {
  const isEnabled = cmd.enabled === 1 || cmd.enabled === true;
  return {
    id: cmd.id,
    name: cmd.name,
    description: cmd.description,
    status: isEnabled ? "ACTIVE" : "INACTIVE",
    use_count: cmd.use_count,
    created_by: cmd.created_by,
  };
}

/**
 * Format tool results for the AI to process
 */
function formatToolResults(results) {
  let formatted = "Tool Results:\n\n";
  
  for (const { tool, args, result } of results) {
    formatted += `### ${tool}\n`;
    if (args && Object.keys(args).length > 0) {
      formatted += `Arguments: ${JSON.stringify(args)}\n`;
    }
    if (result.success) {
      let data = result.data;
      
      // For array results, provide count and summarize items
      if (Array.isArray(data)) {
        formatted += `Total items: ${data.length}\n`;
        
        // Summarize specific types to reduce token usage
        if (tool === "get_automations" && data.length > 0) {
          data = data.map(summarizeAutomation);
          // Add status counts for clarity
          const activeCount = data.filter(a => a.status === "ACTIVE").length;
          const inactiveCount = data.filter(a => a.status === "INACTIVE").length;
          formatted += `Status breakdown: ${activeCount} ACTIVE, ${inactiveCount} INACTIVE\n`;
        } else if (tool === "get_commands" && data.length > 0) {
          data = data.map(summarizeCommand);
          const activeCount = data.filter(c => c.status === "ACTIVE").length;
          const inactiveCount = data.filter(c => c.status === "INACTIVE").length;
          formatted += `Status breakdown: ${activeCount} ACTIVE, ${inactiveCount} INACTIVE\n`;
        }
      }
      
      // Truncate large results to avoid token limits (increased from 2000)
      const dataStr = JSON.stringify(data, null, 2);
      if (dataStr.length > 8000) {
        formatted += `Result (truncated):\n${dataStr.substring(0, 8000)}...\n\n`;
      } else {
        formatted += `Result:\n${dataStr}\n\n`;
      }
    } else {
      formatted += `Error: ${result.error}\n\n`;
    }
  }
  
  return formatted;
}

/**
 * Call the AI API
 */
async function callAI(messages, env) {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = env.CLOUDFLARE_AI_TOKEN;
  const gatewayId = env.CLOUDFLARE_AI_GATEWAY_ID;
  const model = env.CLOUDFLARE_AI_MODEL || DEFAULT_MODEL;
  
  let apiUrl;
  if (gatewayId) {
    apiUrl = `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/workers-ai/${model}`;
  } else {
    apiUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
  }
  
  log.debug(`[AI] Sending request to ${gatewayId ? 'AI Gateway' : 'Workers AI'}`);
  
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages,
      max_tokens: 1500,
      temperature: 0.2, // Low temperature to reduce hallucination/creativity
    }),
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    log.error(`[AI] API error ${response.status}: ${errorText}`);
    throw new Error(`AI service error: ${response.status}`);
  }
  
  const data = await response.json();
  
  let responseText;
  if (data.result?.response) {
    responseText = data.result.response;
  } else if (data.response) {
    responseText = data.response;
  } else if (typeof data === "string") {
    responseText = data;
  } else {
    throw new Error("Unexpected response format from AI service");
  }
  
  return responseText;
}

/**
 * Generate a chat response with MCP tool support
 * 
 * @param {Object} options - Chat options
 * @param {string} options.message - The user's message
 * @param {string} options.userName - The user's display name
 * @param {string} options.userId - The user's Discord ID
 * @param {Object[]} [options.history] - Previous messages in the conversation
 * @param {Object[]} [options.managedGuilds] - Guilds the user manages
 * @param {Object} env - Environment variables
 * @returns {Promise<{success: boolean, response?: string, error?: string, toolsUsed?: string[]}>}
 */
export async function generateChatResponse(options, env) {
  const { message, userName, userId, history = [], managedGuilds = [] } = options;
  
  // Direct console.log for debugging (bypasses LOG_LEVEL)
  console.log("[AI] generateChatResponse called for user:", userName);
  console.log("[AI] env keys:", Object.keys(env || {}));
  
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = env.CLOUDFLARE_AI_TOKEN;
  
  console.log("[AI] CLOUDFLARE_ACCOUNT_ID:", accountId ? "SET" : "MISSING");
  console.log("[AI] CLOUDFLARE_AI_TOKEN:", apiToken ? "SET" : "MISSING");
  console.log("[AI] CLOUDFLARE_API_TOKEN:", env.CLOUDFLARE_API_TOKEN ? "SET" : "MISSING");
  
  if (!accountId || !apiToken) {
    log.error("[AI] Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_AI_TOKEN");
    return {
      success: false,
      error: "AI service not configured. Please set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_TOKEN.",
    };
  }
  
  // Check if MCP is enabled (needs D1 access via Cloudflare API)
  const mcpClient = getMCPClient(env);
  const mcpEnabled = mcpClient.isConfigured();
  
  console.log("[AI] MCP enabled:", mcpEnabled);
  
  log.info(`[AI] MCP enabled: ${mcpEnabled}`);
  
  // Build system prompt with context
  const systemPrompt = buildSystemPrompt({
    managedGuilds,
    mcpEnabled,
  });
  
  // Build initial messages
  const messages = [
    { role: "system", content: systemPrompt },
    ...history.slice(-10).map(msg => ({ role: msg.role, content: msg.content })),
    { role: "user", content: `[${userName}]: ${message}` },
  ];
  
  try {
    // First AI call
    let aiResponse = await callAI(messages, env);
    console.log("[AI] Full initial response:", aiResponse);
    
    // Check if AI wants to use tools
    const toolCalls = parseToolCalls(aiResponse);
    console.log("[AI] Parsed tool calls:", toolCalls.length, toolCalls);
    const toolsUsed = [];
    
    if (toolCalls.length > 0 && mcpEnabled) {
      console.log(`[AI] Processing ${toolCalls.length} tool call(s)`);
      
      // Execute the tools
      const results = await executeToolCalls(toolCalls, env);
      console.log("[AI] Tool results:", JSON.stringify(results, null, 2));
      toolsUsed.push(...toolCalls.map(t => t.tool));
      
      // Add the tool results to the conversation
      const toolResultsText = formatToolResults(results);
      
      // Add assistant response and tool results, then get final response
      messages.push({ role: "assistant", content: aiResponse });
      messages.push({ 
        role: "user", 
        content: `Here are the results from the tools you requested:\n\n${toolResultsText}\n\nPlease provide a helpful summary of this information for the user.` 
      });
      
      // Get final response with tool results
      aiResponse = await callAI(messages, env);
      log.debug("[AI] Final response after tools:", aiResponse.substring(0, 200));
    }
    
    // Clean up response - remove tool blocks and related text for final output
    let cleanResponse = aiResponse
      .replace(/```tool\s*\n[\s\S]*?```/g, "")           // ```tool blocks
      .replace(/```json\s*\n[\s\S]*?```/g, "")           // ```json blocks
      .replace(/```\s*\n\{"tool"[\s\S]*?```/g, "")       // ``` blocks with tool JSON
      .replace(/\{"tool"\s*:\s*"[^"]+"[^}]*\}/g, "")     // Raw tool JSON
      .replace(/Please wait for the result\.*/gi, "")    // "Please wait" text
      .replace(/Here's how to do it:\s*/gi, "")          // Instructional text
      .replace(/This should return[^.]*\./gi, "")        // "This should return" text
      .replace(/I can then provide[^.]*\./gi, "")        // "I can then provide" text
      .replace(/\n{3,}/g, "\n\n")                         // Collapse multiple newlines
      .trim();
    
    return {
      success: true,
      response: cleanResponse || "I processed your request but have no additional information to share.",
      toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined,
    };
    
  } catch (error) {
    log.error("[AI] Request failed:", error.message);
    return {
      success: false,
      error: `AI request failed: ${error.message}`,
    };
  }
}

/**
 * Check if AI features are enabled
 * @param {Object} env - Environment variables
 * @returns {boolean}
 */
export function isAIEnabled(env) {
  return Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_AI_TOKEN);
}

/**
 * Check if MCP features are enabled
 * @param {Object} env - Environment variables
 * @returns {boolean}
 */
export function isMCPEnabled(env) {
  return Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN);
}

export { DEFAULT_MODEL, BASE_SYSTEM_PROMPT as SYSTEM_PROMPT, MCP_TOOLS };
