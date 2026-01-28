/**
 * Automation execution log endpoint
 * Called by the gateway bot to log automation execution results
 */

import { json } from "@sveltejs/kit";
import { logAutomationExecution } from "$lib/db/automations.js";

/**
 * Verify bot authorization
 */
function verifyBotAuth(request) {
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bot ")) {
    return false;
  }

  const token = auth.slice(4);
  const expectedToken = process.env.DISCORD_BOT_TOKEN;

  return token === expectedToken;
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ params, request, platform }) {
  // Verify this is coming from our bot
  if (!verifyBotAuth(request)) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const { guildId } = params;
  const db = platform?.env?.DB;

  if (!db) {
    return json({ error: "Database not available" }, { status: 500 });
  }

  try {
    const logData = await request.json();

    if (!logData.automation_id || !logData.trigger_event) {
      return json({ error: "Missing required fields" }, { status: 400 });
    }

    const result = await logAutomationExecution(db, {
      automation_id: logData.automation_id,
      guild_id: guildId,
      trigger_event: logData.trigger_event,
      trigger_data: logData.trigger_data,
      action_result: logData.action_result,
      success: logData.success,
      error_message: logData.error_message,
      execution_time_ms: logData.execution_time_ms,
    });

    return json({ success: result.success });
  } catch (error) {
    console.error("Automation log error:", error);
    return json({ error: "Logging failed" }, { status: 500 });
  }
}
