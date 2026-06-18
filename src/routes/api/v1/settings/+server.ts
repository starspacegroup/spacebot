/**
 * External API v1 - Settings
 * 
 * GET /api/v1/settings - Get server settings for the authenticated guild
 * 
 * Requires scope: settings:read
 * Auth: Bearer <api_key>
 */

import { json } from "@sveltejs/kit";
import { authenticateApiKey, hasScope } from "$lib/api-auth.js";
import { getGuildSettings } from "$lib/db/settings.js";
import { log } from "$lib/db/logger.js";

/** @type {import('./$types').RequestHandler} */
export async function GET({ request, platform }) {
  const auth = await authenticateApiKey(request, platform);
  if (!auth.authenticated) {
    return json({ error: auth.error }, { status: auth.status });
  }

  if (!hasScope(auth, "settings:read")) {
    return json({ error: "Insufficient scope. Required: settings:read" }, { status: 403 });
  }

  const db = (platform as any)?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 500 });
  }

  try {
    const settings = await getGuildSettings(db, auth.guildId);

    return json({
      guild_id: auth.guildId,
      settings,
    });
  } catch (error) {
    log.error("[API v1] Error fetching settings:", error);
    return json({ error: "Failed to fetch settings" }, { status: 500 });
  }
}
