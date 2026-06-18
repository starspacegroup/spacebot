/**
 * Webhooks API endpoints
 * GET /api/webhooks/[guildId] - Get all webhooks for a guild
 */

import { json } from "@sveltejs/kit";
import { getGuildWebhooks } from "$lib/db/webhooks.js";
import { log } from "$lib/db/logger.js";

/** @type {import('./$types').RequestHandler} */
export async function GET({ params, cookies, platform }) {
  const { guildId } = params;
  const userId = cookies.get("discord_user_id");

  if (!userId) {
    return json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!guildId) {
    return json({ error: "Guild ID is required" }, { status: 400 });
  }

  const db = (platform as any)?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 500 });
  }

  try {
    const webhooks = await getGuildWebhooks(db, guildId);
    
    // Return only enabled webhooks with minimal info for selection
    const selectableWebhooks = webhooks
      .filter(w => w.enabled)
      .map(w => ({
        id: w.id,
        name: w.name,
        description: w.description,
        method: w.method,
      }));

    return json({ webhooks: selectableWebhooks });
  } catch (error) {
    log.error("[API] Error fetching webhooks:", error);
    return json({ error: "Failed to fetch webhooks" }, { status: 500 });
  }
}
