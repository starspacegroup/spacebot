import { json } from "@sveltejs/kit";
import { BOT_REGISTRY, getAllBots } from "$lib/discord/bots.js";

/**
 * GET /api/bots
 * Returns the list of registered external bots and their commands
 */
export async function GET({ url }) {
  const botId = url.searchParams.get("id");

  if (botId) {
    // Return specific bot
    const bot = BOT_REGISTRY[botId];
    if (!bot) {
      return json({ error: "Bot not found" }, { status: 404 });
    }
    return json({ bot });
  }

  // Return all bots
  const bots = getAllBots();
  return json({
    bots,
    count: bots.length,
  });
}
