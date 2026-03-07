/**
 * Automations Export API
 * GET - Export automations for a guild as shareable JSON
 * Supports exporting all or specific automations via ?ids=1,2,3
 */

import { json } from "@sveltejs/kit";
import { getAutomation, getAutomations } from "$lib/db/automations.js";
import { verifyGuildAdmin } from "$lib/discord/guilds.js";
import { annotateAutomationReferences } from "$lib/import-export.js";

/**
 * Strip server-specific metadata from an automation for export.
 * Keeps the full configuration so it can be imported elsewhere.
 */
function prepareAutomationForExport(automation) {
  return {
    name: automation.name,
    description: automation.description || null,
    trigger_events: automation.trigger_events || (automation.trigger_event ? [automation.trigger_event] : []),
    trigger_filters: automation.trigger_filters || null,
    action_type: automation.action_type,
    action_config: automation.action_config || {},
  };
}

/** @type {import('./$types').RequestHandler} */
export async function GET({ params, url, cookies, platform }) {
  const { guildId } = params;
  const accessToken = cookies.get("discord_access_token");

  const auth = await verifyGuildAdmin(guildId, accessToken, cookies);
  if (!auth.authorized) {
    return json({ error: auth.error }, { status: 403 });
  }

  const db = platform?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 500 });
  }

  try {
    const idsParam = url.searchParams.get("ids");
    let automationsToExport = [];

    if (idsParam) {
      // Export specific automations by ID/public_id
      const ids = idsParam.split(",").map(s => s.trim()).filter(Boolean);
      for (const id of ids) {
        const automation = await getAutomation(db, id, guildId);
        if (automation) {
          automationsToExport.push(automation);
        }
      }
    } else {
      // Export all automations
      const { automations } = await getAutomations(db, guildId, { limit: 1000 });
      automationsToExport = automations;
    }

    if (automationsToExport.length === 0) {
      return json({ error: "No automations found to export" }, { status: 404 });
    }

    const exportData = {
      format: "spacebot-automations",
      version: 1,
      exported_at: new Date().toISOString(),
      count: automationsToExport.length,
      automations: automationsToExport.map(a => annotateAutomationReferences(prepareAutomationForExport(a))),
    };

    return json(exportData);
  } catch (error) {
    return json({ error: "Failed to export automations" }, { status: 500 });
  }
}
