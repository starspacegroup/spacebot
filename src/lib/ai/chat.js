/**
 * Cloudflare AI Chat Module with MCP Tool Support
 * 
 * Integrates with Cloudflare Workers AI via REST API or AI Gateway
 * for LLM-based conversations with function calling capabilities.
 */

import { log } from "../log.js";
import { getMCPClient, formatToolsForPrompt, MCP_TOOLS } from "./mcp-client.js";

// Default model - Llama 3.1 8B is fast and free, supports function calling
const DEFAULT_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";

// Base system prompt for the bot assistant
const BASE_SYSTEM_PROMPT = `You are SpaceBot, a helpful Discord bot assistant created by Starspace. You help server managers with their Discord servers.

You can help with:
- Explaining bot features and automations
- Answering questions about Discord server management
- Providing tips for growing and moderating communities
- Explaining how to set up commands and automations
- Looking up event logs, automations, commands, and server settings

Keep responses concise and friendly. Use Discord markdown formatting when helpful.
If you don't know something specific about the bot's features, be honest about it.`;

/**
 * Build the full system prompt with context
 */
function buildSystemPrompt(context = {}) {
  let prompt = BASE_SYSTEM_PROMPT;
  
  // Add managed guilds context if available
  if (context.managedGuilds && context.managedGuilds.length > 0) {
    prompt += "\n\n## User's Managed Servers\nThe user manages the following Discord servers where SpaceBot is installed:\n";
    for (const guild of context.managedGuilds) {
      prompt += `- **${guild.name}** (ID: ${guild.id})${guild.isOwner ? ' [Owner]' : ''}${guild.isAdmin ? ' [Admin]' : ''}\n`;
    }
  }
  
  // Add MCP tools if enabled
  if (context.mcpEnabled) {
    prompt += "\n\n## Available Tools\n";
    prompt += formatToolsForPrompt();
  }
  
  return prompt;
}

/**
 * Parse tool calls from AI response
 * Looks for ```tool JSON blocks
 */
function parseToolCalls(response) {
  const toolCalls = [];
  const toolBlockRegex = /```tool\s*\n([\s\S]*?)```/g;
  
  let match;
  while ((match = toolBlockRegex.exec(response)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed.tool && typeof parsed.tool === "string") {
        toolCalls.push({
          tool: parsed.tool,
          args: parsed.args || {},
        });
      }
    } catch (e) {
      log.warn("[AI] Failed to parse tool call:", match[1]);
    }
  }
  
  return toolCalls;
}

/**
 * Execute tool calls and return results
 */
async function executeToolCalls(toolCalls) {
  const mcpClient = getMCPClient();
  
  if (!mcpClient.isConfigured()) {
    return [{
      tool: "error",
      result: { success: false, error: "MCP client not configured" },
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
      // Truncate large results to avoid token limits
      const dataStr = JSON.stringify(result.data, null, 2);
      if (dataStr.length > 2000) {
        formatted += `Result (truncated):\n${dataStr.substring(0, 2000)}...\n\n`;
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
      temperature: 0.7,
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
  
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = env.CLOUDFLARE_AI_TOKEN;
  
  if (!accountId || !apiToken) {
    log.error("[AI] Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_AI_TOKEN");
    return {
      success: false,
      error: "AI service not configured. Please set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_TOKEN.",
    };
  }
  
  // Check if MCP is enabled (needs D1 access)
  const mcpClient = getMCPClient();
  const mcpEnabled = mcpClient.isConfigured();
  
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
    log.debug("[AI] Initial response:", aiResponse.substring(0, 200));
    
    // Check if AI wants to use tools
    const toolCalls = parseToolCalls(aiResponse);
    const toolsUsed = [];
    
    if (toolCalls.length > 0 && mcpEnabled) {
      log.info(`[AI] Processing ${toolCalls.length} tool call(s)`);
      
      // Execute the tools
      const results = await executeToolCalls(toolCalls);
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
    
    // Clean up response - remove any remaining tool blocks for final output
    const cleanResponse = aiResponse.replace(/```tool\s*\n[\s\S]*?```/g, "").trim();
    
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
