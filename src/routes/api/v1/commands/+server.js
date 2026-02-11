/**
 * External API v1 - Commands
 * 
 * GET /api/v1/commands - Get slash commands for the authenticated guild
 * 
 * Requires scope: commands:read
 * Auth: Bearer <api_key>
 */

import { json } from "@sveltejs/kit";
import { authenticateApiKey, hasScope } from "$lib/api-auth.js";
import { getGuildCommands } from "$lib/db/commands.js";
import { log } from "$lib/db/logger.js";

/** @type {import('./$types').RequestHandler} */
export async function GET({ request, platform, url }) {
  const auth = await authenticateApiKey(request, platform);
  if (!auth.authenticated) {
    return json({ error: auth.error }, { status: auth.status });
  }

  if (!hasScope(auth, "commands:read")) {
    return json({ error: "Insufficient scope. Required: commands:read" }, { status: 403 });
  }

  const db = platform?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 500 });
  }

  try {
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);
    const offset = parseInt(url.searchParams.get("offset") || "0");

    const commands = await getGuildCommands(db, auth.guildId, { limit, offset });

    return json({
      guild_id: auth.guildId,
      commands: commands || [],
      limit,
      offset,
    });
  } catch (error) {
    log.error("[API v1] Error fetching commands:", error);
    return json({ error: "Failed to fetch commands" }, { status: 500 });
  }
}
