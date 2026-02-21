/**
 * Integration Heartbeat API
 *
 * POST /api/v1/integrations/heartbeat
 *
 * Called periodically by external projects to tell SpaceBot they are online.
 * SpaceBot uses this to track integration health and show status in the admin UI.
 *
 * External projects should send a heartbeat at least every 2-3 minutes.
 * Integrations that miss heartbeats for 5 minutes are marked as offline.
 *
 * Auth: Bearer <integration_token> (sbi_...)
 *
 * Optional JSON body:
 * {
 *   "version": "1.2.0",         // Current running version
 *   "uptime": 3600,             // Uptime in seconds
 *   "commands_handled": 42      // Total commands handled since last restart
 * }
 */

import { json } from "@sveltejs/kit";
import { authenticateIntegration } from "$lib/integrations/auth.js";
import { recordHeartbeat } from "$lib/db/integrations.js";
import { log } from "$lib/db/logger.js";

/** @type {import('./$types').RequestHandler} */
export async function POST({ request, platform }) {
  const auth = await authenticateIntegration(request, platform);
  if (!auth.authenticated) {
    return json({ error: auth.error }, { status: auth.status });
  }

  const db = platform?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 500 });
  }

  // Parse optional metadata from body
  let metadata = {};
  try {
    const body = await request.text();
    if (body) {
      metadata = JSON.parse(body);
    }
  } catch {
    // Body is optional; ignore parse errors
  }

  const result = await recordHeartbeat(db, auth.integrationId, metadata);
  if (!result.success) {
    return json({ error: result.error }, { status: 500 });
  }

  log.debug(`[Heartbeat] Received from ${auth.slug}`);

  return json({
    success: true,
    integration: auth.slug,
    recorded_at: result.recorded_at,
    next_expected_before: new Date(
      new Date(result.recorded_at).getTime() + 5 * 60 * 1000,
    ).toISOString(),
  });
}
