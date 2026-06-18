/**
 * External API v1 - Automations
 * 
 * GET /api/v1/automations - Get automations for the authenticated guild
 * 
 * Requires scope: automations:read
 * Auth: Bearer <api_key>
 */

import { json } from "@sveltejs/kit";
import { authenticateApiKey, hasScope } from "$lib/api-auth.js";
import { getAutomations } from "$lib/db/automations.js";
import { log } from "$lib/db/logger.js";

/** @type {import('./$types').RequestHandler} */
export async function GET({ request, platform, url }) {
  const auth = await authenticateApiKey(request, platform);
  if (!auth.authenticated) {
    return json({ error: auth.error }, { status: auth.status });
  }

  if (!hasScope(auth, "automations:read")) {
    return json({ error: "Insufficient scope. Required: automations:read" }, { status: 403 });
  }

  const db = (platform as any)?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 500 });
  }

  try {
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);
    const offset = parseInt(url.searchParams.get("offset") || "0");
    const enabled = url.searchParams.has("enabled") 
      ? url.searchParams.get("enabled") === "true" 
      : undefined;

    const automations = await getAutomations(db, auth.guildId, { limit, offset, enabled });

    return json({
      guild_id: auth.guildId,
      automations: automations || [],
      limit,
      offset,
    });
  } catch (error) {
    log.error("[API v1] Error fetching automations:", error);
    return json({ error: "Failed to fetch automations" }, { status: 500 });
  }
}
