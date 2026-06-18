/**
 * Unified Import API
 * POST /api/import/[guildId] - Import all server data from a unified backup file
 * 
 * Handles format: "spacebot-backup"
 * Imports automations, commands, and settings from a single file.
 * Stats payloads are ignored here and must be restored by a superadmin.
 */

import { json } from "@sveltejs/kit";
import { ACTION_TYPES, createAutomation, getAutomations } from "$lib/db/automations.js";
import { createCommand, getGuildCommands } from "$lib/db/commands.js";
import { syncGuildCommands } from "$lib/discord/commands.js";
import { getGuildSettings, saveGuildSettings } from "$lib/db/settings.js";
import { EVENT_TYPES, log } from "$lib/db/logger.js";
import { verifyGuildAdmin } from "$lib/discord/guilds.js";
import { clearActionConfigReferences, clearFilterReferences, summarizeCleared } from "$lib/import-export.js";

/** @type {import('./$types').RequestHandler} */
export async function POST({ params, request, cookies, platform }) {
  const { guildId } = params;
  const accessToken = cookies.get("discord_access_token");

  const auth = await verifyGuildAdmin(guildId, accessToken, cookies);
  if (!auth.authorized) {
    return json({ error: auth.error }, { status: 403 });
  }

  const db = (platform as any)?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 500 });
  }

  try {
    const body = await request.json();

    if (body.format !== "spacebot-backup") {
      return json({ error: "Invalid file format. Expected a SpaceBot backup file." }, { status: 400 });
    }

    // Get user ID for created_by fields
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

    const results = {
      automations: { imported: 0, failed: 0, results: [] },
      commands: { imported: 0, failed: 0, results: [] },
      settings: { imported: false } as { imported: boolean; error?: string },
      skipped: {
        statsRecords: 0,
      },
    };

    const skippedStatsRecords = [
      Array.isArray(body.server_stats) ? body.server_stats.length : 0,
      Array.isArray(body.aggregated_stats) ? body.aggregated_stats.length : 0,
      Array.isArray(body.voice_sessions) ? body.voice_sessions.length : 0,
    ].reduce((sum, count) => sum + count, 0);

    results.skipped.statsRecords = skippedStatsRecords;

    // ── Import automations ─────────────────────────────
    if (body.automations && Array.isArray(body.automations)) {
      for (const automation of body.automations) {
        if (!automation.name) {
          results.automations.results.push({ name: "Unknown", success: false, error: "Missing name" });
          results.automations.failed++;
          continue;
        }

        const triggerEvents = automation.trigger_events || [];
        if (triggerEvents.length === 0) {
          results.automations.results.push({ name: automation.name, success: false, error: "No trigger events" });
          results.automations.failed++;
          continue;
        }

        const invalidTriggers = triggerEvents.filter(t => !EVENT_TYPES[t]);
        if (invalidTriggers.length > 0) {
          results.automations.results.push({ name: automation.name, success: false, error: `Invalid triggers: ${invalidTriggers.join(", ")}` });
          results.automations.failed++;
          continue;
        }

        if (!automation.action_type || (!ACTION_TYPES[automation.action_type] && automation.action_type !== "MULTIPLE")) {
          results.automations.results.push({ name: automation.name, success: false, error: `Invalid action type: ${automation.action_type}` });
          results.automations.failed++;
          continue;
        }

        try {
          const { cleaned: cleanedConfig, cleared: configCleared } =
            clearActionConfigReferences(automation.action_type, automation.action_config || {});
          const { cleaned: cleanedFilters, cleared: filterCleared } =
            clearFilterReferences(automation.trigger_filters || null);
          const needsConfig = summarizeCleared([...configCleared, ...filterCleared]);

          const result = await createAutomation(db, {
            guild_id: guildId,
            name: automation.name,
            description: automation.description || null,
            enabled: false,
            trigger_event: triggerEvents[0],
            trigger_events: triggerEvents,
            trigger_filters: cleanedFilters,
            action_type: automation.action_type,
            action_config: cleanedConfig,
            created_by: userId,
          });

          if (result.success) {
            results.automations.results.push({ name: automation.name, success: true, needs_configuration: needsConfig });
            results.automations.imported++;
          } else {
            results.automations.results.push({ name: automation.name, success: false, error: result.error });
            results.automations.failed++;
          }
        } catch (error) {
          log.error(`Failed to import automation "${automation.name}":`, error);
          results.automations.results.push({ name: automation.name, success: false, error: "Internal error" });
          results.automations.failed++;
        }
      }
    }

    // ── Import commands ────────────────────────────────
    if (body.commands && Array.isArray(body.commands)) {
      for (const command of body.commands) {
        if (!command.name || !command.description) {
          results.commands.results.push({ name: command.name || "Unknown", success: false, error: "Missing name or description" });
          results.commands.failed++;
          continue;
        }

        const nameRegex = /^[\w-]{1,32}$/;
        if (!nameRegex.test(command.name)) {
          results.commands.results.push({ name: command.name, success: false, error: "Invalid command name format" });
          results.commands.failed++;
          continue;
        }

        if (command.action_type && command.action_type !== "NONE" && command.action_type !== "MULTIPLE" && !ACTION_TYPES[command.action_type]) {
          results.commands.results.push({ name: command.name, success: false, error: `Invalid action type: ${command.action_type}` });
          results.commands.failed++;
          continue;
        }

        try {
          const { cleaned: cleanedConfig, cleared: configCleared } =
            clearActionConfigReferences(command.action_type || "NONE", command.action_config || {});
          const needsConfig = summarizeCleared(configCleared);

          const result = await createCommand(db, {
            guild_id: guildId,
            name: command.name.toLowerCase(),
            description: command.description,
            enabled: false,
            options: command.options || [],
            ephemeral: command.ephemeral || false,
            defer: command.defer || false,
            action_type: command.action_type || "NONE",
            action_config: cleanedConfig,
            response_type: command.response_type || "message",
            response_content: command.response_content || null,
            response_embed: command.response_embed || null,
            context_menu_user: command.context_menu_user || false,
            require_voice: command.require_voice || false,
            default_member_permissions: command.default_member_permissions || null,
            created_by: userId,
          });

          if (result.success) {
            results.commands.results.push({ name: command.name, success: true, needs_configuration: needsConfig });
            results.commands.imported++;
          } else {
            results.commands.results.push({ name: command.name, success: false, error: result.error });
            results.commands.failed++;
          }
        } catch (error) {
          log.error(`Failed to import command "${command.name}":`, error);
          results.commands.results.push({ name: command.name, success: false, error: "Internal error" });
          results.commands.failed++;
        }
      }

      // Sync commands with Discord if any were imported
      if (results.commands.imported > 0) {
        try {
          await syncGuildCommands(db, guildId, (platform as any)?.env);
        } catch (syncError) {
          log.warn("Failed to sync commands after import:", syncError);
        }
      }
    }

    // ── Import settings ────────────────────────────────
    if (body.settings && typeof body.settings === "object" && Object.keys(body.settings).length > 0) {
      try {
        // Merge with existing settings rather than overwriting
        const existing = await getGuildSettings(db, guildId) || {};
        const merged = { ...existing, ...body.settings };
        // Remove server-specific IDs that shouldn't transfer
        delete merged.guild_id;
        delete merged.id;
        await saveGuildSettings(db, guildId, merged);
        results.settings.imported = true;
      } catch (error) {
        log.error("Failed to import settings:", error);
        results.settings.error = error.message || String(error);
      }
    }

    // Build summary message
    const parts = [];
    if (results.automations.imported > 0 || results.automations.failed > 0) {
      parts.push(`${results.automations.imported} automation${results.automations.imported !== 1 ? "s" : ""}${results.automations.failed > 0 ? ` (${results.automations.failed} failed)` : ""}`);
    }
    if (results.commands.imported > 0 || results.commands.failed > 0) {
      parts.push(`${results.commands.imported} command${results.commands.imported !== 1 ? "s" : ""}${results.commands.failed > 0 ? ` (${results.commands.failed} failed)` : ""}`);
    }
    if (results.settings.imported) {
      parts.push("settings");
    }

    const hasFailures = results.automations.failed > 0 || results.commands.failed > 0 || results.settings.error;
    const warnings = [];
    if (results.skipped.statsRecords > 0) {
      warnings.push("Stats data was skipped. Use the Superadmin stats import page to restore stats exports.");
    }

    return json({
      success: !hasFailures,
      message: parts.length > 0 ? `Imported: ${parts.join(", ")}` : "No data was imported",
      results,
      warnings,
    }, { status: hasFailures ? 207 : 200 });
  } catch (error) {
    log.error("Unified import error:", error);
    return json({ error: "Failed to import backup. Make sure the file is valid JSON." }, { status: 500 });
  }
}
