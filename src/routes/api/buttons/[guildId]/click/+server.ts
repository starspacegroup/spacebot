/**
 * Button click processing API endpoint
 * Called by the gateway bot when a SpaceBot button is clicked
 * POST - Look up button actions and return them for execution
 */

import { json } from "@sveltejs/kit";
import { findButtonActions, logButtonClick } from "$lib/db/button-actions.js";
import { log } from "$lib/db/logger.js";

/**
 * Verify bot authorization
 */
function verifyBotAuth(request, platform) {
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bot ")) return false;
  const token = auth.slice(4);
  const expectedToken = platform?.env?.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;
  return token === expectedToken;
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ params, request, platform }) {
  if (!verifyBotAuth(request, platform)) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const { guildId } = params;
  const db = (platform as any)?.env?.DB;

  if (!db) {
    return json({ error: "Database not available" }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { custom_id, user_id, user_name, channel_id, message_id } = body;

    if (!custom_id) {
      return json({ error: "Missing custom_id" }, { status: 400 });
    }

    log.debug(`[Button Click] Processing: ${custom_id} by ${user_name} in guild ${guildId}`);

    // Look up the button's actions
    const buttonData = await findButtonActions(db, custom_id, guildId);

    if (!buttonData) {
      log.debug(`[Button Click] No actions found for ${custom_id}`);
      return json({ actions: [], message: "No actions configured for this button" });
    }

    // Log the click
    const startTime = Date.now();
    await logButtonClick(db, {
      guild_id: guildId,
      button_id: custom_id,
      user_id,
      user_name,
      channel_id,
      message_id,
      success: true,
      execution_time_ms: Date.now() - startTime,
    });

    return json({
      actions: buttonData.actions,
      buttonLabel: buttonData.buttonLabel,
      sourceId: buttonData.sourceId,
      sourceName: buttonData.sourceName,
    });
  } catch (error) {
    log.error("[Button Click] Error:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
}
