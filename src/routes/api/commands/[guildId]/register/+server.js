/**
 * Command Registration API endpoint
 * POST - Register commands with Discord
 */

import { json } from "@sveltejs/kit";
import {
  getGuildCommands,
  getUnregisteredCommands,
  markCommandRegistered,
  toDiscordCommand,
} from "$lib/db/commands.js";
import { commands as builtInCommands } from "$lib/discord/commands.js";
import { log } from "$lib/db/logger.js";
import { verifyGuildAdmin } from "$lib/discord/guilds.js";

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

  const botToken = platform?.env?.DISCORD_BOT_TOKEN ||
    process.env.DISCORD_BOT_TOKEN;
  const clientId = platform?.env?.DISCORD_CLIENT_ID ||
    process.env.DISCORD_CLIENT_ID;

  if (!botToken || !clientId) {
    return json({ error: "Bot configuration not available" }, { status: 500 });
  }

  try {
    const body = await request.json();
    const mode = body.mode || "sync"; // 'sync' = all commands, 'pending' = only unregistered

    // Get custom commands from database
    let customCommands;
    if (mode === "pending") {
      customCommands = await getUnregisteredCommands(db, guildId);
    } else {
      customCommands = await getGuildCommands(db, guildId, {
        enabledOnly: true,
      });
    }

    // Convert to Discord format
    const discordCommands = customCommands.map((cmd) => ({
      ...toDiscordCommand(cmd),
      _dbId: cmd.id, // Track database ID for updating
    }));

    // Include built-in commands
    const allCommands = [
      ...builtInCommands,
      ...discordCommands.map(({ _dbId, ...cmd }) => cmd),
    ];

    // Register all commands with Discord
    const url =
      `https://discord.com/api/v10/applications/${clientId}/guilds/${guildId}/commands`;

    const response = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bot ${botToken}`,
      },
      body: JSON.stringify(allCommands),
    });

    if (!response.ok) {
      const error = await response.text();
      log.error("Discord registration error:", error);
      return json({
        error: "Failed to register commands with Discord",
        details: error,
      }, { status: 500 });
    }

    const registeredCommands = await response.json();

    // Update database with Discord command IDs
    for (const dbCommand of discordCommands) {
      const registered = registeredCommands.find((rc) =>
        rc.name === dbCommand.name
      );
      if (registered) {
        await markCommandRegistered(db, dbCommand._dbId, registered.id);
      }
    }

    return json({
      success: true,
      registered: registeredCommands.length,
      commands: registeredCommands.map((cmd) => ({
        id: cmd.id,
        name: cmd.name,
        description: cmd.description,
      })),
    });
  } catch (error) {
    log.error("Register commands error:", error);
    return json({ error: "Failed to register commands" }, { status: 500 });
  }
}

/** @type {import('./$types').RequestHandler} */
export async function GET({ params, cookies, platform }) {
  const { guildId } = params;
  const accessToken = cookies.get("discord_access_token");

  const auth = await verifyGuildAdmin(guildId, accessToken, cookies);
  if (!auth.authorized) {
    return json({ error: auth.error }, { status: 403 });
  }

  const botToken = platform?.env?.DISCORD_BOT_TOKEN ||
    process.env.DISCORD_BOT_TOKEN;
  const clientId = platform?.env?.DISCORD_CLIENT_ID ||
    process.env.DISCORD_CLIENT_ID;

  if (!botToken || !clientId) {
    return json({ error: "Bot configuration not available" }, { status: 500 });
  }

  try {
    // Get currently registered commands from Discord
    const url =
      `https://discord.com/api/v10/applications/${clientId}/guilds/${guildId}/commands`;

    const response = await fetch(url, {
      headers: {
        "Authorization": `Bot ${botToken}`,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      return json({
        error: "Failed to fetch commands from Discord",
        details: error,
      }, { status: 500 });
    }

    const commands = await response.json();

    return json({
      commands: commands.map((cmd) => ({
        id: cmd.id,
        name: cmd.name,
        description: cmd.description,
        options: cmd.options || [],
      })),
      total: commands.length,
    });
  } catch (error) {
    log.error("Fetch commands error:", error);
    return json({ error: "Failed to fetch commands" }, { status: 500 });
  }
}
