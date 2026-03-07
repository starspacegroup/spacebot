/**
 * Automations Import API
 * POST - Import automations from a JSON export file
 * Creates automations in disabled state so users can configure server-specific values
 */

import { json } from "@sveltejs/kit";
import { ACTION_TYPES, createAutomation, getAutomations } from "$lib/db/automations.js";
import { EVENT_TYPES, log } from "$lib/db/logger.js";
import { verifyGuildAdmin } from "$lib/discord/guilds.js";
import { checkPlanLimit } from "$lib/db/server-plans.js";
import { clearActionConfigReferences, clearFilterReferences, summarizeCleared } from "$lib/import-export.js";

/** @type {import('./$types').RequestHandler} */
export async function POST({ params, request, cookies, platform }) {
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
    const body = await request.json();

    // Validate export format
    if (!body.format || body.format !== "spacebot-automations") {
      return json({ error: "Invalid file format. Expected a SpaceBot automations export file." }, { status: 400 });
    }

    if (!body.automations || !Array.isArray(body.automations) || body.automations.length === 0) {
      return json({ error: "No automations found in the import file." }, { status: 400 });
    }

    if (body.automations.length > 50) {
      return json({ error: "Cannot import more than 50 automations at once." }, { status: 400 });
    }

    // Get user ID
    let userId = null;
    try {
      const userResponse = await fetch("https://discord.com/api/v10/users/@me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (userResponse.ok) {
        const user = await userResponse.json();
        userId = user.id;
      }
    } catch {
      // Continue without user ID
    }

    const results = [];
    let successCount = 0;
    let errorCount = 0;

    for (const automation of body.automations) {
      // Validate required fields
      if (!automation.name) {
        results.push({ name: "Unknown", success: false, error: "Missing name" });
        errorCount++;
        continue;
      }

      // Validate trigger events exist
      const triggerEvents = automation.trigger_events || [];
      if (triggerEvents.length === 0) {
        results.push({ name: automation.name, success: false, error: "No trigger events specified" });
        errorCount++;
        continue;
      }

      const invalidTriggers = triggerEvents.filter(t => !EVENT_TYPES[t]);
      if (invalidTriggers.length > 0) {
        results.push({ name: automation.name, success: false, error: `Invalid trigger events: ${invalidTriggers.join(", ")}` });
        errorCount++;
        continue;
      }

      // Validate action_type
      if (!automation.action_type || (!ACTION_TYPES[automation.action_type] && automation.action_type !== "MULTIPLE")) {
        results.push({ name: automation.name, success: false, error: `Invalid action type: ${automation.action_type}` });
        errorCount++;
        continue;
      }

      // If action_type is MULTIPLE, validate sub-actions
      if (automation.action_type === "MULTIPLE" && automation.action_config?.actions) {
        const invalidActions = automation.action_config.actions.filter(a => !ACTION_TYPES[a.type]);
        if (invalidActions.length > 0) {
          results.push({ name: automation.name, success: false, error: `Invalid sub-action types: ${invalidActions.map(a => a.type).join(", ")}` });
          errorCount++;
          continue;
        }
      }

      try {
        // Clear server-specific references (channel IDs, role IDs, etc.)
        const { cleaned: cleanedConfig, cleared: configCleared } =
          clearActionConfigReferences(automation.action_type, automation.action_config || {});
        const { cleaned: cleanedFilters, cleared: filterCleared } =
          clearFilterReferences(automation.trigger_filters || null);
        const allCleared = [...configCleared, ...filterCleared];
        const needsConfig = summarizeCleared(allCleared);

        const result = await createAutomation(db, {
          guild_id: guildId,
          name: automation.name,
          description: automation.description || null,
          enabled: false, // Always import as disabled
          trigger_event: triggerEvents[0],
          trigger_events: triggerEvents,
          trigger_filters: cleanedFilters,
          action_type: automation.action_type,
          action_config: cleanedConfig,
          created_by: userId,
        });

        if (result.success) {
          results.push({
            name: automation.name,
            success: true,
            id: result.id,
            needs_configuration: needsConfig,
          });
          successCount++;
        } else {
          results.push({ name: automation.name, success: false, error: result.error });
          errorCount++;
        }
      } catch (error) {
        log.error(`Failed to import automation "${automation.name}":`, error);
        results.push({ name: automation.name, success: false, error: "Internal error" });
        errorCount++;
      }
    }

    return json({
      success: errorCount === 0,
      message: `Imported ${successCount} automation${successCount !== 1 ? "s" : ""}${errorCount > 0 ? `, ${errorCount} failed` : ""}. All imported automations are disabled — review and enable them when ready.`,
      results,
      imported: successCount,
      failed: errorCount,
    }, { status: errorCount === 0 ? 201 : 207 });
  } catch (error) {
    log.error("Import automations error:", error);
    return json({ error: "Failed to import automations. Make sure the file is valid JSON." }, { status: 500 });
  }
}
