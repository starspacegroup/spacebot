/**
 * Cloudflare AI Chat Module
 * 
 * Integrates with Cloudflare Workers AI via REST API or AI Gateway
 * for LLM-based conversations. Uses free models from Cloudflare.
 */

import { log } from "../log.js";

// Default model - Llama 3.1 8B is fast and free
const DEFAULT_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";

// System prompt for the bot assistant
const SYSTEM_PROMPT = `You are SpaceBot, a helpful Discord bot assistant created by Starspace. You help server managers with their Discord servers.

You can help with:
- Explaining bot features and automations
- Answering questions about Discord server management
- Providing tips for growing and moderating communities
- Explaining how to set up commands and automations

Keep responses concise and friendly. Use Discord markdown formatting when helpful.
If you don't know something specific about the bot's features, be honest about it.`;

/**
 * Generate a chat response using Cloudflare Workers AI
 * 
 * @param {Object} options - Chat options
 * @param {string} options.message - The user's message
 * @param {string} options.userName - The user's display name
 * @param {string} options.userId - The user's Discord ID
 * @param {Object[]} [options.history] - Previous messages in the conversation
 * @param {Object} env - Environment variables (from process.env)
 * @returns {Promise<{success: boolean, response?: string, error?: string}>}
 */
export async function generateChatResponse(options, env) {
  const { message, userName, userId, history = [] } = options;
  
  // Get configuration from environment
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = env.CLOUDFLARE_AI_TOKEN;
  const gatewayId = env.CLOUDFLARE_AI_GATEWAY_ID;
  const model = env.CLOUDFLARE_AI_MODEL || DEFAULT_MODEL;
  
  if (!accountId || !apiToken) {
    log.error("[AI] Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_AI_TOKEN");
    return {
      success: false,
      error: "AI service not configured. Please set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_TOKEN.",
    };
  }
  
  // Build the messages array
  const messages = [
    {
      role: "system",
      content: SYSTEM_PROMPT,
    },
    // Include conversation history if provided
    ...history.slice(-10).map(msg => ({
      role: msg.role,
      content: msg.content,
    })),
    {
      role: "user",
      content: `[${userName}]: ${message}`,
    },
  ];
  
  // Determine the API URL
  // If gateway ID is set, use AI Gateway; otherwise use direct API
  let apiUrl;
  if (gatewayId) {
    // AI Gateway endpoint for Workers AI
    apiUrl = `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/workers-ai/${model}`;
  } else {
    // Direct Workers AI REST API
    apiUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
  }
  
  log.debug(`[AI] Sending request to ${gatewayId ? 'AI Gateway' : 'Workers AI'}`);
  log.debug(`[AI] Model: ${model}`);
  
  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages,
        max_tokens: 1024,
        temperature: 0.7,
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      log.error(`[AI] API error ${response.status}: ${errorText}`);
      return {
        success: false,
        error: `AI service error: ${response.status}`,
      };
    }
    
    const data = await response.json();
    log.debug("[AI] Response received:", JSON.stringify(data).substring(0, 200));
    
    // Handle response format based on endpoint
    // Direct API returns: { result: { response: "..." }, success: true }
    // AI Gateway returns: { response: "..." } or similar
    let responseText;
    if (data.result?.response) {
      responseText = data.result.response;
    } else if (data.response) {
      responseText = data.response;
    } else if (typeof data === "string") {
      responseText = data;
    } else {
      log.error("[AI] Unexpected response format:", data);
      return {
        success: false,
        error: "Unexpected response format from AI service",
      };
    }
    
    return {
      success: true,
      response: responseText,
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

export { DEFAULT_MODEL, SYSTEM_PROMPT };
