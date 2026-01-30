/**
 * Commands API endpoint
 * GET - List commands for a guild
 * POST - Create a new command
 */

import { json } from "@sveltejs/kit";
import {
  ACTION_TYPES,
  COMMAND_TEMPLATE_VARIABLES,
  COMMON_OPTION_TYPES,
  createCommand,
  getGuildCommands,
  OPTION_TYPES,
  RESPONSE_TYPES,
} from "$lib/db/commands.js";
import { log } from "$lib/db/logger.js";

/**
 * Verify user has admin access to the guild
 */
async function verifyGuildAdmin(guildId, accessToken) {
  if (!accessToken || !guildId) {
    return { authorized: false, error: "Unauthorized" };
  }

  try {
    const response = await fetch(
      "https://discord.com/api/v10/users/@me/guilds",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    if (!response.ok) {
      return { authorized: false, error: "Failed to verify permissions" };
    }

    const guilds = await response.json();
    const guild = guilds.find((g) => g.id === guildId);

    if (!guild) {
      return { authorized: false, error: "Guild not found" };
    }

    const permissions = BigInt(guild.permissions);
    const ADMINISTRATOR = BigInt(0x8);
    const MANAGE_GUILD = BigInt(0x20);

    if ((permissions & ADMINISTRATOR) || (permissions & MANAGE_GUILD)) {
      return { authorized: true, guild };
    }

    return { authorized: false, error: "Insufficient permissions" };
  } catch (error) {
    log.error("Guild verification error:", error);
    return { authorized: false, error: "Verification failed" };
  }
}

/** @type {import('./$types').RequestHandler} */
export async function GET({ params, url, cookies, platform }) {
  const { guildId } = params;
  const accessToken = cookies.get("discord_access_token");

  const auth = await verifyGuildAdmin(guildId, accessToken);
  if (!auth.authorized) {
    return json({ error: auth.error }, { status: 403 });
  }

  const db = platform?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 500 });
  }

  const enabledOnly = url.searchParams.get("enabled") === "true";

  const commands = await getGuildCommands(db, guildId, { enabledOnly });

  return json({
    commands,
    total: commands.length,
    meta: {
      actionTypes: ACTION_TYPES,
      optionTypes: OPTION_TYPES,
      commonOptionTypes: COMMON_OPTION_TYPES,
      responseTypes: RESPONSE_TYPES,
      templateVariables: COMMAND_TEMPLATE_VARIABLES,
    },
  });
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ params, request, cookies, platform }) {
  const { guildId } = params;
  const accessToken = cookies.get("discord_access_token");

  const auth = await verifyGuildAdmin(guildId, accessToken);
  if (!auth.authorized) {
    return json({ error: auth.error }, { status: 403 });
  }

  const db = platform?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 500 });
  }

  try {
    const body = await request.json();

    // Validate required fields
    if (!body.name || !body.description) {
      return json({
        error: "Missing required fields: name, description",
      }, { status: 400 });
    }

    // Validate command name format
    const nameRegex = /^[\w-]{1,32}$/;
    if (!nameRegex.test(body.name)) {
      return json({
        error:
          "Command name must be 1-32 characters, lowercase, alphanumeric or hyphens",
      }, { status: 400 });
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

    // Get user ID from Discord
    let userId = null;
    try {
      const userResponse = await fetch(
        "https://discord.com/api/v10/users/@me",
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
      if (userResponse.ok) {
        const user = await userResponse.json();
        userId = user.id;
      }
    } catch {
      // Continue without user ID
    }

    const result = await createCommand(db, {
      guild_id: guildId,
      name: body.name.toLowerCase(),
      description: body.description,
      enabled: body.enabled !== false,
      options: body.options || [],
      ephemeral: body.ephemeral || false,
      defer: body.defer || false,
      action_type: body.action_type || "NONE",
      action_config: body.action_config || {},
      response_type: body.response_type || "message",
      response_content: body.response_content || null,
      response_embed: body.response_embed || null,
      created_by: userId,
    });

    if (!result.success) {
      return json({ error: result.error }, { status: 400 });
    }

    return json({ success: true, id: result.id }, { status: 201 });
  } catch (error) {
    log.error("Create command error:", error);
    return json({ error: "Failed to create command" }, { status: 500 });
  }
}
