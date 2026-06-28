/**
 * Commands Export API
 * GET - Export commands for a guild as shareable JSON
 * Supports exporting all or specific commands via ?ids=1,2,3
 */

import { json } from "@sveltejs/kit";
import { getCommand, getGuildCommands } from "$lib/db/commands.js";
import { verifyGuildAdmin } from "$lib/discord/guilds.js";
import { annotateCommandReferences } from "$lib/import-export.js";

/**
 * Strip server-specific metadata from a command for export.
 * Keeps the full configuration so it can be imported elsewhere.
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
export async function GET({ params, url, cookies, platform }) {
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
    const idsParam = url.searchParams.get("ids");
    let commandsToExport = [];

    if (idsParam) {
      // Export specific commands by ID
      const ids = idsParam.split(",").map(s => s.trim()).filter(Boolean);
      for (const id of ids) {
        const command = await getCommand(db, parseInt(id), guildId);
        if (command && !command.is_built_in) {
          commandsToExport.push(command);
        }
      }
    } else {
      // Export all custom commands (not built-in)
      const commands = await getGuildCommands(db, guildId);
      commandsToExport = commands.filter(c => !c.is_built_in);
    }

    if (commandsToExport.length === 0) {
      return json({ error: "No commands found to export" }, { status: 404 });
    }

    const exportData = {
      format: "spacebot-commands",
      version: 1,
      exported_at: new Date().toISOString(),
      count: commandsToExport.length,
      commands: commandsToExport.map(c => annotateCommandReferences(prepareCommandForExport(c))),
    };

    return json(exportData);
  } catch {
    return json({ error: "Failed to export commands" }, { status: 500 });
  }
}
