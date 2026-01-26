import { json } from "@sveltejs/kit";
import { logEvent } from "$lib/db/logger.js";

/**
 * POST endpoint for logging events from the gateway bot
 * Protected by bot token authentication
 */
export async function POST({ request, platform }) {
  console.log("[DEBUG] /api/logs/create called");
  const authHeader = request.headers.get("Authorization");
  const botToken = platform?.env?.DISCORD_BOT_TOKEN ||
    process.env.DISCORD_BOT_TOKEN;

  console.log("[DEBUG] Auth header present:", !!authHeader);
  console.log("[DEBUG] Bot token present:", !!botToken);

  // Verify the request is from our gateway bot
  if (!authHeader || authHeader !== `Bot ${botToken}`) {
    console.log(
      "[DEBUG] Auth failed - header:",
      authHeader?.substring(0, 20) + "...",
    );
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const event = await request.json();
    console.log(
      "[DEBUG] Event received:",
      event.event_type,
      "for guild",
      event.guild_id,
    );

    // Validate required fields
    if (!event.guild_id || !event.event_type || !event.event_category) {
      return json({ error: "Missing required fields" }, { status: 400 });
    }

    const db = platform?.env?.spacebot_logs;
    console.log("[DEBUG] DB binding exists:", !!db);

    if (!db) {
      console.error(
        "D1 database binding not available. Make sure you're running with: npm run dev",
      );
      return json({ error: "Database not configured" }, { status: 503 });
    }

    const result = await logEvent(db, event);

    if (result.success) {
      return json({ success: true });
    } else {
      console.error("Failed to log event:", result.error);
      return json({ error: result.error || "Failed to log event" }, {
        status: 500,
      });
    }
  } catch (error) {
    console.error("Error logging event:", error);
    return json({ error: error.message || "Invalid request" }, { status: 400 });
  }
}
