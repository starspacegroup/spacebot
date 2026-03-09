/**
 * Unified Import API
 * POST /api/import/[guildId] - Import all server data from a unified backup file
 * 
 * Handles format: "spacebot-backup"
 * Imports automations, commands, stats, and settings from a single file.
 */

import { json } from "@sveltejs/kit";
import { ACTION_TYPES, createAutomation, getAutomations } from "$lib/db/automations.js";
import { createCommand, getGuildCommands } from "$lib/db/commands.js";
import { syncGuildCommands } from "$lib/discord/commands.js";
import { getGuildSettings, saveGuildSettings } from "$lib/db/settings.js";
import { EVENT_TYPES, log } from "$lib/db/logger.js";
import { verifyGuildAdmin } from "$lib/discord/guilds.js";
import { clearActionConfigReferences, clearFilterReferences, summarizeCleared } from "$lib/import-export.js";

/**
 * Batch insert rows using D1 batch API for efficiency.
 */
async function batchInsert(db, statements) {
  if (statements.length === 0) return 0;

  const BATCH_SIZE = 100;
  let totalInserted = 0;

  for (let i = 0; i < statements.length; i += BATCH_SIZE) {
    const batch = statements.slice(i, i + BATCH_SIZE);
    try {
      const results = await db.batch(batch);
      for (const result of results) {
        if (result.meta?.changes) {
          totalInserted += result.meta.changes;
        }
      }
    } catch (error) {
      log.error(`Batch insert error (batch ${Math.floor(i / BATCH_SIZE) + 1}):`, error);
    }
  }

  return totalInserted;
}

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
      settings: { imported: false },
      stats: {
        server_stats: { imported: 0, total: 0 },
        aggregated_stats: { imported: 0, total: 0 },
        voice_sessions: { imported: 0, total: 0 },
      },
    };

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
          await syncGuildCommands(db, guildId, platform?.env);
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

    // ── Import stats ───────────────────────────────────
    if (body.server_stats && Array.isArray(body.server_stats)) {
      results.stats.server_stats.total = body.server_stats.length;
      const statements = body.server_stats.map(row =>
        db.prepare(`
          INSERT OR IGNORE INTO server_stats (
            guild_id, member_count, online_count, bot_count, human_count,
            channel_count, role_count, emoji_count, boost_count, boost_level,
            recorded_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          guildId,
          row.member_count || 0,
          row.online_count ?? null,
          row.bot_count ?? null,
          row.human_count ?? null,
          row.channel_count ?? null,
          row.role_count ?? null,
          row.emoji_count ?? null,
          row.boost_count ?? null,
          row.boost_level ?? null,
          row.recorded_at,
        )
      );
      results.stats.server_stats.imported = await batchInsert(db, statements);
    }

    if (body.aggregated_stats && Array.isArray(body.aggregated_stats)) {
      results.stats.aggregated_stats.total = body.aggregated_stats.length;
      const statements = body.aggregated_stats.map(row =>
        db.prepare(`
          INSERT OR IGNORE INTO aggregated_stats (
            guild_id, period_type, period_start, period_end,
            member_joins, member_leaves, member_net_change,
            voice_total_seconds, voice_unique_users, voice_peak_concurrent,
            message_count, message_unique_users,
            total_events, processed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          guildId,
          row.period_type,
          row.period_start,
          row.period_end,
          row.member_joins || 0,
          row.member_leaves || 0,
          row.member_net_change || 0,
          row.voice_total_seconds || 0,
          row.voice_unique_users || 0,
          row.voice_peak_concurrent || 0,
          row.message_count || 0,
          row.message_unique_users || 0,
          row.total_events || 0,
          row.processed_at || new Date().toISOString(),
        )
      );
      results.stats.aggregated_stats.imported = await batchInsert(db, statements);
    }

    if (body.voice_sessions && Array.isArray(body.voice_sessions)) {
      results.stats.voice_sessions.total = body.voice_sessions.length;
      const statements = body.voice_sessions.map(row =>
        db.prepare(`
          INSERT OR IGNORE INTO voice_sessions (
            guild_id, user_id, channel_id, channel_name,
            joined_at, left_at, duration_seconds
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
          guildId,
          row.user_id,
          row.channel_id,
          row.channel_name ?? null,
          row.joined_at,
          row.left_at ?? null,
          row.duration_seconds ?? null,
        )
      );
      results.stats.voice_sessions.imported = await batchInsert(db, statements);
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
    const totalStats = results.stats.server_stats.imported + results.stats.aggregated_stats.imported + results.stats.voice_sessions.imported;
    if (totalStats > 0) {
      parts.push(`${totalStats} stats record${totalStats !== 1 ? "s" : ""}`);
    }

    const hasFailures = results.automations.failed > 0 || results.commands.failed > 0 || results.settings.error;

    return json({
      success: !hasFailures,
      message: parts.length > 0 ? `Imported: ${parts.join(", ")}` : "No data was imported",
      results,
    }, { status: hasFailures ? 207 : 200 });
  } catch (error) {
    log.error("Unified import error:", error);
    return json({ error: "Failed to import backup. Make sure the file is valid JSON." }, { status: 500 });
  }
}
