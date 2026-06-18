/**
 * Scheduled messages database functions
 * Handles creating, fetching, and processing deferred messages
 */

import { log } from "../log.js";

/**
 * Parse a delay string like "5m", "2h", "1d", "30mc" into milliseconds
 * @param {string} delay - Delay string (e.g. "5m", "2h", "1d", "30mc")
 * @returns {number} Milliseconds
 */
export function parseDelay(delay) {
  if (!delay) return 0;
  const clean = delay.endsWith("c") ? delay.slice(0, -1) : delay;
  const match = clean.match(/^(\d+)(m|h|d)$/);
  if (!match) return 0;
  const num = parseInt(match[1]);
  const unit = match[2];
  switch (unit) {
    case "m": return num * 60 * 1000;
    case "h": return num * 60 * 60 * 1000;
    case "d": return num * 24 * 60 * 60 * 1000;
    default: return 0;
  }
}

/**
 * Schedule a message for later delivery
 * @param {D1Database} db
 * @param {Object} params
 * @returns {Promise<{success: boolean, id?: number, send_at?: string}>}
 */
export async function createScheduledMessage(db, {
  guild_id,
  channel_id,
  target_user_id,
  action_type,
  message_payload,
  delay,
  created_by,
  source_automation_id,
}) {
  const delayMs = parseDelay(delay);
  if (delayMs <= 0) {
    return { success: false, error: "Invalid delay" };
  }

  const sendAt = new Date(Date.now() + delayMs).toISOString();

  try {
    const result = await db.prepare(`
      INSERT INTO scheduled_messages 
        (guild_id, channel_id, target_user_id, action_type, message_payload, send_at, status, created_by, source_automation_id)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).bind(
      guild_id,
      channel_id || null,
      target_user_id || null,
      action_type,
      JSON.stringify(message_payload),
      sendAt,
      created_by || null,
      source_automation_id || null,
    ).run();

    const id = result.meta?.last_row_id;
    log.info(`[ScheduledMessages] Created scheduled message #${id} for ${sendAt} (${delay} delay)`);

    return { success: true, id, send_at: sendAt };
  } catch (error) {
    log.error("[ScheduledMessages] Failed to create scheduled message:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Get all pending messages that are due to be sent
 * @param {D1Database} db
 * @param {number} limit - Max messages to fetch
 * @returns {Promise<Array>}
 */
export async function getPendingMessages(db, limit = 50) {
  try {
    const result = await db.prepare(`
      SELECT * FROM scheduled_messages
      WHERE status = 'pending' AND send_at <= datetime('now')
      ORDER BY send_at ASC
      LIMIT ?
    `).bind(limit).all();

    return result.results || [];
  } catch (error) {
    log.error("[ScheduledMessages] Failed to get pending messages:", error);
    return [];
  }
}

/**
 * Mark a scheduled message as sent
 * @param {D1Database} db
 * @param {number} id
 */
export async function markMessageSent(db, id) {
  try {
    await db.prepare(`
      UPDATE scheduled_messages 
      SET status = 'sent', sent_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).bind(id).run();
  } catch (error) {
    log.error(`[ScheduledMessages] Failed to mark message #${id} as sent:`, error);
  }
}

/**
 * Mark a scheduled message as failed
 * @param {D1Database} db
 * @param {number} id
 * @param {string} errorMessage
 */
export async function markMessageFailed(db, id, errorMessage) {
  try {
    await db.prepare(`
      UPDATE scheduled_messages 
      SET status = 'failed', error_message = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(errorMessage, id).run();
  } catch (error) {
    log.error(`[ScheduledMessages] Failed to mark message #${id} as failed:`, error);
  }
}

/**
 * Get scheduled messages for a guild (for admin dashboard)
 * @param {D1Database} db
 * @param {string} guildId
 * @param {string} status - Filter by status (optional)
 * @param {number} limit
 * @returns {Promise<Array>}
 */
export async function getScheduledMessagesForGuild(db, guildId, status = null, limit = 50) {
  try {
    let query = `SELECT * FROM scheduled_messages WHERE guild_id = ?`;
    const params = [guildId];

    if (status) {
      query += ` AND status = ?`;
      params.push(status);
    }

    query += ` ORDER BY send_at DESC LIMIT ?`;
    params.push(limit);

    const stmt = db.prepare(query);
    const result = await stmt.bind(...params).all();

    return result.results || [];
  } catch (error) {
    log.error("[ScheduledMessages] Failed to get guild scheduled messages:", error);
    return [];
  }
}

/**
 * Cancel a pending scheduled message
 * @param {D1Database} db
 * @param {number} id
 * @param {string} guildId - Ensure message belongs to this guild
 * @returns {Promise<{success: boolean}>}
 */
export async function cancelScheduledMessage(db, id, guildId) {
  try {
    const result = await db.prepare(`
      UPDATE scheduled_messages 
      SET status = 'cancelled', updated_at = datetime('now')
      WHERE id = ? AND guild_id = ? AND status = 'pending'
    `).bind(id, guildId).run();

    return { success: (result.meta?.changes || 0) > 0 };
  } catch (error) {
    log.error(`[ScheduledMessages] Failed to cancel message #${id}:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Process and send all due scheduled messages
 * Called by cron job
 * @param {D1Database} db
 * @param {string} botToken
 * @returns {Promise<{sent: number, failed: number, errors: string[]}>}
 */
export async function processScheduledMessages(db, botToken) {
  const messages = await getPendingMessages(db);

  if (messages.length === 0) {
    return { sent: 0, failed: 0, errors: [] };
  }

  log.info(`[ScheduledMessages] Processing ${messages.length} pending message(s)`);

  const results = { sent: 0, failed: 0, errors: [] };

  for (const msg of messages) {
    try {
      const payload = JSON.parse(msg.message_payload);

      if (msg.action_type === "SEND_DM") {
        await sendScheduledDM(botToken, msg.target_user_id, payload);
      } else {
        await sendScheduledChannelMessage(botToken, msg.channel_id, payload);
      }

      await markMessageSent(db, msg.id);
      results.sent++;
    } catch (error) {
      const errMsg = error.message || "Unknown error";
      await markMessageFailed(db, msg.id, errMsg);
      results.failed++;
      results.errors.push(`Message #${msg.id}: ${errMsg}`);
      log.error(`[ScheduledMessages] Failed to send message #${msg.id}:`, error);
    }

    // Small delay between sends to avoid rate limits
    await new Promise((r) => setTimeout(r, 100));
  }

  log.info(`[ScheduledMessages] Processed: ${results.sent} sent, ${results.failed} failed`);
  return results;
}

/**
 * Send a scheduled channel message via Discord API
 */
async function sendScheduledChannelMessage(botToken, channelId, payload) {
  const body: Record<string, any> = {};

  if (payload.embed) {
    const embed: Record<string, any> = {
      description: payload.content,
      color: payload.embed_color || 0x5865F2,
      timestamp: new Date().toISOString(),
    };
    if (payload.embed_thumbnail_url) embed.thumbnail = { url: payload.embed_thumbnail_url };
    if (payload.embed_image_url) embed.image = { url: payload.embed_image_url };
    body.embeds = [embed];
  } else {
    body.content = payload.content;
  }

  if (payload.components) {
    body.components = payload.components;
  }

  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Discord API error ${response.status}: ${errorText}`);
  }

  return await response.json();
}

/**
 * Send a scheduled DM via Discord API
 */
async function sendScheduledDM(botToken, userId, payload) {
  // Create DM channel first
  const dmResponse = await fetch("https://discord.com/api/v10/users/@me/channels", {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ recipient_id: userId }),
  });

  if (!dmResponse.ok) {
    throw new Error(`Failed to create DM channel: ${dmResponse.status}`);
  }

  const dmChannel = await dmResponse.json();
  return await sendScheduledChannelMessage(botToken, dmChannel.id, payload);
}
