/**
 * Unified Export API
 * GET /api/export/[guildId] - Export all server data as a single JSON backup
 * 
 * Includes:
 * - automations
 * - commands
 * - server_stats
 * - aggregated_stats
 * - voice_sessions
 * - settings
 */

import { json } from "@sveltejs/kit";
import { getAutomations } from "$lib/db/automations.js";
import { getGuildCommands } from "$lib/db/commands.js";
import { getGuildSettings } from "$lib/db/settings.js";
import { verifyGuildAdmin } from "$lib/discord/guilds.js";
import { annotateAutomationReferences, annotateCommandReferences } from "$lib/import-export.js";
import { log } from "$lib/log.js";

/**
 * Strip server-specific metadata from an automation for export.
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

/**
 * Strip server-specific metadata from a command for export.
 */
function prepareCommandForExport(command) {
  return {
    name: command.name,
    description: command.description,
    options: command.options || [],
    ephemeral: command.ephemeral || false,
    defer: command.defer || false,
    action_type: command.action_type || "NONE",
    action_config: command.action_config || {},
    response_type: command.response_type || "message",
    response_content: command.response_content || null,
    response_embed: command.response_embed || null,
    context_menu_user: command.context_menu_user || false,
    require_voice: command.require_voice || false,
    default_member_permissions: command.default_member_permissions || null,
  };
}

/** @type {import('./$types').RequestHandler} */
export async function GET({ params, cookies, platform }) {
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
    // Fetch all data in parallel
    const [
      automationsResult,
      allCommands,
      settings,
      serverStats,
      aggregatedStats,
      voiceSessions,
    ] = await Promise.all([
      getAutomations(db, guildId, { limit: 1000 }),
      getGuildCommands(db, guildId),
      getGuildSettings(db, guildId),
      db.prepare(`
        SELECT 
          member_count, online_count, bot_count, human_count,
          channel_count, role_count, emoji_count, boost_count, boost_level,
          recorded_at
        FROM server_stats
        WHERE guild_id = ?
        ORDER BY recorded_at ASC
      `).bind(guildId).all(),
      db.prepare(`
        SELECT 
          period_type, period_start, period_end,
          member_joins, member_leaves, member_net_change,
          voice_total_seconds, voice_unique_users, voice_peak_concurrent,
          message_count, message_unique_users,
          total_events, processed_at
        FROM aggregated_stats
        WHERE guild_id = ?
        ORDER BY period_start ASC
      `).bind(guildId).all(),
      db.prepare(`
        SELECT 
          user_id, channel_id, channel_name,
          joined_at, left_at, duration_seconds
        FROM voice_sessions
        WHERE guild_id = ?
        ORDER BY joined_at ASC
      `).bind(guildId).all(),
    ]);

    const automations = automationsResult.automations || [];
    const commands = allCommands.filter(c => !c.is_built_in);

    const exportData = {
      format: "spacebot-backup",
      version: 1,
      exported_at: new Date().toISOString(),
      guild_id: guildId,
      counts: {
        automations: automations.length,
        commands: commands.length,
        server_stats: serverStats.results?.length || 0,
        aggregated_stats: aggregatedStats.results?.length || 0,
        voice_sessions: voiceSessions.results?.length || 0,
      },
      settings: settings || {},
      automations: automations.map(a => annotateAutomationReferences(prepareAutomationForExport(a))),
      commands: commands.map(c => annotateCommandReferences(prepareCommandForExport(c))),
      server_stats: serverStats.results || [],
      aggregated_stats: aggregatedStats.results || [],
      voice_sessions: voiceSessions.results || [],
    };

    return json(exportData);
  } catch (error) {
    log.error("Failed to export all data:", error);
    return json({ error: "Failed to export data" }, { status: 500 });
  }
}
