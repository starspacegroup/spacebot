/**
 * Single command API endpoint
 * GET - Get command details
 * PATCH - Update command
 * DELETE - Delete command
 */

import { json } from "@sveltejs/kit";
import {
  ACTION_TYPES,
  deleteCommand,
  getCommand,
  updateCommand,
} from "$lib/db/commands.js";
import { log } from "$lib/db/logger.js";
import { verifyGuildAdmin } from "$lib/discord/guilds.js";

/** @type {import('./$types').RequestHandler} */
export async function GET({ params, cookies, platform }) {
  const { guildId, commandId } = params;
  const accessToken = cookies.get("discord_access_token");

  const auth = await verifyGuildAdmin(guildId, accessToken, cookies);
  if (!auth.authorized) {
    return json({ error: auth.error }, { status: 403 });
  }

  const db = platform?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 500 });
  }

  const command = await getCommand(db, parseInt(commandId), guildId);

  if (!command) {
    return json({ error: "Command not found" }, { status: 404 });
  }

  return json({ command });
}

/** @type {import('./$types').RequestHandler} */
export async function PATCH({ params, request, cookies, platform }) {
  const { guildId, commandId } = params;
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
    const id = parseInt(commandId);

    // Check command exists and belongs to guild
    const existing = await getCommand(db, id, guildId);
    if (!existing) {
      return json({ error: "Command not found" }, { status: 404 });
    }

    // Handle toggle action
    if (body.action === "toggle") {
      const result = await updateCommand(db, id, { enabled: body.enabled });
      if (!result.success) {
        return json({ error: "Failed to toggle command" }, { status: 500 });
      }
      return json({ success: true, enabled: body.enabled });
    }

    // Validate action_type if provided
    if (
      body.action_type && body.action_type !== "NONE" &&
      !ACTION_TYPES[body.action_type]
    ) {
      return json({ error: `Invalid action_type: ${body.action_type}` }, {
        status: 400,
      });
    }

    // Validate command name if changed
    if (body.name) {
      const nameRegex = /^[\w-]{1,32}$/;
      if (!nameRegex.test(body.name)) {
        return json({
          error:
            "Command name must be 1-32 characters, lowercase, alphanumeric or hyphens",
        }, { status: 400 });
      }
    }

    const result = await updateCommand(db, id, body);

    if (!result.success) {
      return json({ error: result.error }, { status: 400 });
    }

    return json({ success: true });
  } catch (error) {
    log.error("Update command error:", error);
    return json({ error: "Failed to update command" }, { status: 500 });
  }
}

/** @type {import('./$types').RequestHandler} */
export async function DELETE({ params, cookies, platform }) {
  const { guildId, commandId } = params;
  const accessToken = cookies.get("discord_access_token");

  const auth = await verifyGuildAdmin(guildId, accessToken, cookies);
  if (!auth.authorized) {
    return json({ error: auth.error }, { status: 403 });
  }

  const db = platform?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 500 });
  }

  const id = parseInt(commandId);

  // Check command exists and belongs to guild
  const existing = await getCommand(db, id, guildId);
  if (!existing) {
    return json({ error: "Command not found" }, { status: 404 });
  }

  const result = await deleteCommand(db, id, guildId);

  if (!result.success) {
    return json({ error: result.error }, { status: 500 });
  }

  // If the command was registered with Discord, we should unregister it
  // This would require calling Discord's API to delete the command
  if (existing.discord_command_id) {
    try {
      const botToken = platform?.env?.DISCORD_BOT_TOKEN ||
        process.env.DISCORD_BOT_TOKEN;
      const clientId = platform?.env?.DISCORD_CLIENT_ID ||
        process.env.DISCORD_CLIENT_ID;

      if (botToken && clientId) {
        await fetch(
          `https://discord.com/api/v10/applications/${clientId}/guilds/${guildId}/commands/${existing.discord_command_id}`,
          {
            method: "DELETE",
            headers: {
              Authorization: `Bot ${botToken}`,
            },
          },
        );
      }
    } catch (error) {
      log.error("Failed to unregister command from Discord:", error);
      // Continue anyway - the command is deleted from our database
    }
  }

  return json({ success: true });
}
