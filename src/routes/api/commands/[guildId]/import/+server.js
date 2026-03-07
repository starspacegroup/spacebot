/**
 * Commands Import API
 * POST - Import commands from a JSON export file
 * Creates commands in disabled state so users can configure server-specific values
 */

import { json } from "@sveltejs/kit";
import { ACTION_TYPES, createCommand, getGuildCommands } from "$lib/db/commands.js";
import { syncGuildCommands } from "$lib/discord/commands.js";
import { log } from "$lib/db/logger.js";
import { verifyGuildAdmin } from "$lib/discord/guilds.js";
import { checkPlanLimit } from "$lib/db/server-plans.js";
import { clearActionConfigReferences, summarizeCleared } from "$lib/import-export.js";

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
    if (!body.format || body.format !== "spacebot-commands") {
      return json({ error: "Invalid file format. Expected a SpaceBot commands export file." }, { status: 400 });
    }

    if (!body.commands || !Array.isArray(body.commands) || body.commands.length === 0) {
      return json({ error: "No commands found in the import file." }, { status: 400 });
    }

    if (body.commands.length > 50) {
      return json({ error: "Cannot import more than 50 commands at once." }, { status: 400 });
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

    for (const command of body.commands) {
      // Validate required fields
      if (!command.name || !command.description) {
        results.push({ name: command.name || "Unknown", success: false, error: "Missing name or description" });
        errorCount++;
        continue;
      }

      // Validate command name format
      const nameRegex = /^[\w-]{1,32}$/;
      if (!nameRegex.test(command.name)) {
        results.push({ name: command.name, success: false, error: "Invalid command name format" });
        errorCount++;
        continue;
      }

      // Validate action_type if provided
      if (command.action_type && command.action_type !== "NONE" && command.action_type !== "MULTIPLE" && !ACTION_TYPES[command.action_type]) {
        results.push({ name: command.name, success: false, error: `Invalid action type: ${command.action_type}` });
        errorCount++;
        continue;
      }

      try {
        // Clear server-specific references (channel IDs, role IDs, etc.)
        const { cleaned: cleanedConfig, cleared: configCleared } =
          clearActionConfigReferences(command.action_type || "NONE", command.action_config || {});
        const needsConfig = summarizeCleared(configCleared);

        const result = await createCommand(db, {
          guild_id: guildId,
          name: command.name.toLowerCase(),
          description: command.description,
          enabled: false, // Always import as disabled
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
          results.push({
            name: command.name,
            success: true,
            id: result.id,
            needs_configuration: needsConfig,
          });
          successCount++;
        } else {
          results.push({ name: command.name, success: false, error: result.error });
          errorCount++;
        }
      } catch (error) {
        log.error(`Failed to import command "${command.name}":`, error);
        results.push({ name: command.name, success: false, error: "Internal error" });
        errorCount++;
      }
    }

    // Sync commands with Discord if any were imported
    if (successCount > 0) {
      try {
        await syncGuildCommands(db, guildId, platform?.env);
      } catch (syncError) {
        log.warn("Failed to sync commands after import:", syncError);
      }
    }

    return json({
      success: errorCount === 0,
      message: `Imported ${successCount} command${successCount !== 1 ? "s" : ""}${errorCount > 0 ? `, ${errorCount} failed` : ""}. All imported commands are disabled — review and enable them when ready.`,
      results,
      imported: successCount,
      failed: errorCount,
    }, { status: errorCount === 0 ? 201 : 207 });
  } catch (error) {
    log.error("Import commands error:", error);
    return json({ error: "Failed to import commands. Make sure the file is valid JSON." }, { status: 500 });
  }
}
