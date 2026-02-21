/**
 * Integration Status API
 *
 * GET /api/v1/integrations/status
 *
 * Returns the status of all integrations (or a single one by slug).
 * Public endpoint — no authentication required.
 * Useful for dashboards and monitoring.
 *
 * Query params:
 *   ?slug=starspace-game   — filter to a specific integration
 */

import { json } from "@sveltejs/kit";
import { listIntegrations, getIntegrationBySlug } from "$lib/db/integrations.js";
import { log } from "$lib/db/logger.js";

/** @type {import('./$types').RequestHandler} */
export async function GET({ platform, url }) {
  const db = platform?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 500 });
  }

  const slug = url.searchParams.get("slug");

  try {
    if (slug) {
      const integration = await getIntegrationBySlug(db, slug);
      if (!integration) {
        return json({ error: "Integration not found" }, { status: 404 });
      }

      return json({
        slug: integration.slug,
        name: integration.name,
        version: integration.version,
        status: integration.status || "unknown",
        last_heartbeat_at: integration.last_heartbeat_at || null,
        category: integration.category,
        is_official: integration.is_official,
        commands: integration.manifest?.commands?.length || 0,
      });
    }

    // Return all integrations' status
    const integrations = await listIntegrations(db);

    return json({
      integrations: integrations.map((i) => ({
        slug: i.slug,
        name: i.name,
        version: i.version,
        status: i.status || "unknown",
        last_heartbeat_at: i.last_heartbeat_at || null,
        category: i.category,
        is_official: i.is_official,
        commands: i.manifest?.commands?.length || 0,
      })),
    });
  } catch (error) {
    log.error("[IntegrationStatus] Error:", error);
    return json({ error: "Failed to fetch integration status" }, { status: 500 });
  }
}
