/**
 * Chat API Endpoint
 * 
 * POST /api/chat - Send a message to the AI assistant
 * GET  /api/chat?userId=...  - Fetch DM history with the bot from Discord
 */

import { json } from "@sveltejs/kit";
import { log } from "$lib/db/logger.js";
import { generateChatResponse, isAIEnabled } from "$lib/ai/chat.js";
import { filterAdminGuilds, getUserGuilds, getBotGuildIds } from "$lib/discord/guilds.js";

/**
 * Safely get environment variable
 */
function getEnv(name, platform) {
  return platform?.env?.[name] ?? (typeof process !== "undefined" ? process.env?.[name] : undefined);
}

/**
 * Check if user is a superadmin
 */
function checkIsSuperAdmin(userId, platform) {
  if (!userId) return false;
  const adminUserIds = getEnv("ADMIN_USER_IDS", platform) || "";
  return adminUserIds.split(",").map(id => id.trim()).filter(Boolean).includes(userId);
}

/**
 * GET /api/chat - Fetch DM history between user and the bot from Discord
 */
export async function GET({ cookies, platform, url }) {
  const userId = cookies.get("discord_user_id");
  if (!userId) {
    return json({ error: "Not authenticated" }, { status: 401 });
  }

  const botToken = getEnv("DISCORD_BOT_TOKEN", platform);
  if (!botToken) {
    return json({ error: "Bot token not configured" }, { status: 500 });
  }

  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);
  const before = url.searchParams.get("before") || "";

  try {
    // Create/get DM channel with the user
    const dmChannelRes = await fetch("https://discord.com/api/v10/users/@me/channels", {
      method: "POST",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ recipient_id: userId }),
    });

    if (!dmChannelRes.ok) {
      log.error("[ChatAPI] Failed to create DM channel:", dmChannelRes.status);
      return json({ messages: [], hasMore: false });
    }

    const dmChannel = await dmChannelRes.json();

    // Fetch messages from the DM channel
    let messagesUrl = `https://discord.com/api/v10/channels/${dmChannel.id}/messages?limit=${limit}`;
    if (before) {
      messagesUrl += `&before=${before}`;
    }

    const messagesRes = await fetch(messagesUrl, {
      headers: {
        Authorization: `Bot ${botToken}`,
      },
    });

    if (!messagesRes.ok) {
      log.error("[ChatAPI] Failed to fetch DM messages:", messagesRes.status);
      return json({ messages: [], hasMore: false });
    }

    const rawMessages = await messagesRes.json();
    
    // Get the bot's own user ID
    const botUserRes = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bot ${botToken}` },
    });
    const botUser = botUserRes.ok ? await botUserRes.json() : { id: null };

    // Transform messages into a simpler format
    const messages = rawMessages.map(msg => ({
      id: msg.id,
      role: msg.author.id === botUser.id ? "assistant" : "user",
      content: msg.content,
      timestamp: msg.timestamp,
      author: {
        id: msg.author.id,
        username: msg.author.username,
        globalName: msg.author.global_name,
        avatar: msg.author.avatar,
        bot: msg.author.bot || false,
      },
    })).reverse(); // Discord returns newest first, we want oldest first

    return json({
      messages,
      hasMore: rawMessages.length === limit,
    });
  } catch (error) {
    log.error("[ChatAPI] Error fetching DM history:", error.message);
    return json({ messages: [], hasMore: false });
  }
}

/**
 * POST /api/chat - Send a message to the AI assistant
 */
export async function POST({ request, cookies, platform }) {
  const userId = cookies.get("discord_user_id");
  const username = cookies.get("discord_username") || "User";

  if (!userId) {
    return json({ error: "Not authenticated" }, { status: 401 });
  }

  const env = {
    CLOUDFLARE_ACCOUNT_ID: getEnv("CLOUDFLARE_ACCOUNT_ID", platform),
    CLOUDFLARE_AI_TOKEN: getEnv("CLOUDFLARE_AI_TOKEN", platform),
    CLOUDFLARE_API_TOKEN: getEnv("CLOUDFLARE_API_TOKEN", platform),
    CLOUDFLARE_AI_GATEWAY_ID: getEnv("CLOUDFLARE_AI_GATEWAY_ID", platform),
    CLOUDFLARE_AI_MODEL: getEnv("CLOUDFLARE_AI_MODEL", platform),
    DISCORD_BOT_TOKEN: getEnv("DISCORD_BOT_TOKEN", platform),
    DISCORD_CLIENT_ID: getEnv("DISCORD_CLIENT_ID", platform),
    DB: platform?.env?.DB,
  };

  if (!isAIEnabled(env)) {
    return json({ error: "AI features are not enabled" }, { status: 503 });
  }

  const body = await request.json();
  const { message, history, selectedGuildId } = body;

  if (!message || typeof message !== "string" || !message.trim()) {
    return json({ error: "Message is required" }, { status: 400 });
  }

  const isSuperAdmin = checkIsSuperAdmin(userId, platform);

  // Get user's managed guilds for AI context
  let managedGuilds = [];
  let selectedGuild = null;
  let selectedGuildName = null;

  try {
    const accessToken = cookies.get("discord_access_token");
    const botToken = getEnv("DISCORD_BOT_TOKEN", platform);

    if (accessToken && botToken) {
      const [allUserGuilds, botGuildIds] = await Promise.all([
        getUserGuilds(accessToken, cookies),
        getBotGuildIds(botToken, cookies),
      ]);

      managedGuilds = filterAdminGuilds(allUserGuilds)
        .filter(g => botGuildIds.has(g.id))
        .map(g => ({
          ...g,
          botIsInServer: true,
        }));

      if (selectedGuildId) {
        selectedGuild = managedGuilds.find(g => g.id === selectedGuildId) || null;
        selectedGuildName = selectedGuild?.name || null;
      }
    }
  } catch (error) {
    log.warn("[ChatAPI] Could not fetch guild context:", error.message);
  }

  try {
    const result = await generateChatResponse({
      message: message.trim(),
      userName: username,
      userId,
      isSuperAdmin,
      history: (history || []).slice(-10),
      managedGuilds,
      selectedGuild,
      selectedGuildId: selectedGuildId || null,
      selectedGuildName,
    }, env);

    if (!result.success) {
      return json({ error: result.error }, { status: 500 });
    }

    return json({
      response: result.response,
      toolsUsed: result.toolsUsed,
    });
  } catch (error) {
    log.error("[ChatAPI] Error generating response:", error.message);
    return json({ error: "Failed to generate response" }, { status: 500 });
  }
}
