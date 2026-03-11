import { json } from "@sveltejs/kit";
import { log, logEvent } from "$lib/db/logger.js";
import { getGuildSettings } from "$lib/db/settings.js";
import { updateMemberCount } from "$lib/db/server-stats.js";

/**
 * Format an event for Discord channel logging
 * @param {Object} event - The event data
 * @param {Object} [customColors] - Optional custom color overrides per category (hex strings)
 * @returns {Object} - Discord embed object
 */
function formatEventEmbed(event, customColors = {}) {
  const defaultColors = {
    message: 0x3498db,    // Blue
    member: 0x2ecc71,     // Green
    guild: 0x9b59b6,      // Purple
    channel: 0xe67e22,    // Orange
    role: 0xf1c40f,       // Yellow
    moderation: 0xe74c3c, // Red
    voice: 0x1abc9c,      // Teal
    reaction: 0xff6b6b,   // Coral
    interaction: 0x5865F2,// Discord Blurple
  };

  // Check if there's a custom color for this category
  const customHex = customColors[event.event_category];
  let color;
  if (customHex && /^#[0-9a-fA-F]{6}$/.test(customHex)) {
    color = parseInt(customHex.slice(1), 16);
  } else {
    color = defaultColors[event.event_category] || 0x95a5a6;
  }
    MESSAGE_CREATE: "💬",
    MESSAGE_DELETE: "🗑️",
    MESSAGE_UPDATE: "✏️",
    MEMBER_JOIN: "📥",
    MEMBER_LEAVE: "📤",
    MEMBER_UPDATE: "👤",
    MEMBER_BAN_ADD: "🔨",
    MEMBER_BAN_REMOVE: "🔓",
    CHANNEL_CREATE: "📁",
    CHANNEL_DELETE: "📁",
    CHANNEL_UPDATE: "📁",
    ROLE_CREATE: "🏷️",
    ROLE_DELETE: "🏷️",
    ROLE_UPDATE: "🏷️",
    VOICE_JOIN: "🔊",
    VOICE_LEAVE: "🔇",
    VOICE_MOVE: "🔀",
    REACTION_ADD: "➕",
    REACTION_REMOVE: "➖",
    INTERACTION_CREATE: "⚡",
  };

  const icon = icons[event.event_type] || "📋";
  
  // Build description
  let description = "";
  if (event.actor_name) {
    description += `**Actor:** ${event.actor_name}`;
    if (event.actor_id) description += ` (<@${event.actor_id}>)`;
    description += "\n";
  }
  if (event.target_name) {
    description += `**Target:** ${event.target_name}`;
    if (event.target_id) description += ` (<@${event.target_id}>)`;
    description += "\n";
  }
  if (event.channel_name) {
    description += `**Channel:** #${event.channel_name}`;
    if (event.channel_id) description += ` (<#${event.channel_id}>)`;
    description += "\n";
  }

  // Add details if present
  if (event.details) {
    const details = typeof event.details === 'string' ? JSON.parse(event.details) : event.details;
    if (details.content) {
      const content = details.content.length > 200 
        ? details.content.substring(0, 200) + "..." 
        : details.content;
      description += `\n**Content:**\n\`\`\`\n${content}\n\`\`\``;
    }
    if (details.reason) {
      description += `\n**Reason:** ${details.reason}`;
    }
  }

  return {
    title: `${icon} ${event.event_type.replace(/_/g, " ")}`,
    description: description || "No additional details",
    color,
    timestamp: new Date().toISOString(),
    footer: {
      text: `Category: ${event.event_category}`
    }
  };
}

/**
 * Send a log message to a Discord channel
 * @param {string} channelId - The channel ID to send to
 * @param {Object} event - The event data
 * @param {string} botToken - The bot token for authorization
 * @param {Object} [customColors] - Optional custom color overrides per category
 */
async function sendLogToChannel(channelId, event, botToken, customColors = {}) {
  if (!channelId || !botToken) return;

  try {
    const embed = formatEventEmbed(event, customColors);
    
    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        embeds: [embed]
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.warn(`[Discord Log] Failed to send log to channel ${channelId}: ${response.status} - ${errorText}`);
    } else {
      log.debug(`[Discord Log] Sent event ${event.event_type} to channel ${channelId}`);
    }
  } catch (error) {
    log.error(`[Discord Log] Error sending to channel ${channelId}:`, error.message);
  }
}

/**
 * POST endpoint for logging events from the gateway bot
 * Protected by bot token authentication
 */
export async function POST({ request, platform }) {
  log.debug("[DEBUG] /api/logs/create called");
  const authHeader = request.headers.get("Authorization");
  const botToken = platform?.env?.DISCORD_BOT_TOKEN ||
    process.env.DISCORD_BOT_TOKEN;

  log.debug("[DEBUG] Auth header present:", !!authHeader);
  log.debug("[DEBUG] Bot token present:", !!botToken);

  // Verify the request is from our gateway bot
  if (!authHeader || authHeader !== `Bot ${botToken}`) {
    log.debug(
      "[DEBUG] Auth failed - header:",
      authHeader?.substring(0, 20) + "...",
    );
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const event = await request.json();
    log.debug(
      "[DEBUG] Event received:",
      event.event_type,
      "for guild",
      event.guild_id,
    );

    // Validate required fields
    if (!event.guild_id || !event.event_type || !event.event_category) {
      return json({ error: "Missing required fields" }, { status: 400 });
    }

    const db = platform?.env?.DB;
    log.debug("[DEBUG] DB binding exists:", !!db);

    if (!db) {
      log.error(
        "D1 database binding not available. Make sure you're running with: npm run dev",
      );
      return json({ error: "Database not configured" }, { status: 503 });
    }

    const result = await logEvent(db, event);

    if (result.success) {
      // Update member count on join/leave events
      if (event.event_type === 'MEMBER_JOIN' || event.event_type === 'MEMBER_LEAVE') {
        const eventType = event.event_type === 'MEMBER_JOIN' ? 'join' : 'leave';
        // Pass whether the joining/leaving member is a bot
        const isBot = event.actor_is_bot || event.details?.bot || false;
        const statsResult = await updateMemberCount(db, event.guild_id, eventType, isBot);
        if (statsResult.success) {
          log.debug(`[Stats] Member count updated for ${event.guild_id}: ${statsResult.newCount}${isBot ? ' (bot)' : ''}`);
        } else {
          log.debug(`[Stats] Could not update member count: ${statsResult.error}`);
        }
      }

      // Check if guild has a logging channel configured and send the log there
      try {
        const settings = await getGuildSettings(db, event.guild_id);
        if (settings.logging_enabled && settings.log_channel_id) {
          // Skip sending log messages for events that occurred in the log channel itself
          // This prevents infinite loops when THIS bot sends log messages
          const isLogChannelEvent = event.channel_id === settings.log_channel_id;
          const isOwnBotMessage = event.details?.isOwnBot === true;
          
          if (isLogChannelEvent && isOwnBotMessage) {
            log.debug("[Discord Log] Skipping log for own bot message in log channel to prevent loop");
          } else {
            // Don't await - send asynchronously to not slow down the response
            sendLogToChannel(settings.log_channel_id, event, botToken, settings.log_embed_colors);
          }
        }
      } catch (settingsError) {
        log.debug("[Discord Log] Could not check guild settings:", settingsError.message);
      }

      return json({ success: true });
    } else {
      log.error("Failed to log event:", result.error);
      return json({ error: result.error || "Failed to log event" }, {
        status: 500,
      });
    }
  } catch (error) {
    log.error("Error logging event:", error);
    return json({ error: error.message || "Invalid request" }, { status: 400 });
  }
}
