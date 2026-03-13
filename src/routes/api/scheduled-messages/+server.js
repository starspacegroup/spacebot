/**
 * API endpoint for creating scheduled messages
 * Used by the gateway bot when it encounters send_later actions
 * 
 * POST /api/scheduled-messages - Create a scheduled message
 */

import { json } from "@sveltejs/kit";
import { createScheduledMessage } from "$lib/db/scheduled-messages.js";
import { log } from "$lib/log.js";

/**
 * POST /api/scheduled-messages
 * Body: { guild_id, channel_id, target_user_id, action_type, message_payload, delay, created_by, source_automation_id }
 */
export async function POST({ request, platform }) {
  const botToken = platform?.env?.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;
  const authHeader = request.headers.get("Authorization");

  // Only allow bot-authenticated requests
  if (!authHeader || authHeader !== `Bot ${botToken}`) {
    return json({ error: "Unauthorized" }, { status: 403 });
  }

  const db = platform?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 503 });
  }

  try {
    const body = await request.json();
    const result = await createScheduledMessage(db, body);

    if (result.success) {
      return json({ success: true, id: result.id, send_at: result.send_at });
    }

    return json({ success: false, error: result.error }, { status: 400 });
  } catch (error) {
    log.error("[ScheduledMessages API] Error:", error);
    return json({ error: "Internal error" }, { status: 500 });
  }
}
