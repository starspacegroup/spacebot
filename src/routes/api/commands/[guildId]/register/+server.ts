/**
 * Command Registration API endpoint
 * POST - Force sync all commands with Discord
 * GET - List currently registered commands from Discord
 */

import { json } from "@sveltejs/kit";
import { syncGuildCommands } from "$lib/discord/commands.js";
import { log } from "$lib/db/logger.js";
import { verifyGuildAdmin } from "$lib/discord/guilds.js";

/** @type {import('./$types').RequestHandler} */
export async function POST({ params, cookies, platform }) {
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
    const result = await syncGuildCommands(db, guildId, (platform as any)?.env);

    if (!result.success) {
      return json({ error: result.error }, { status: 500 });
    }

    return json({
      success: true,
      registered: result.registered,
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

  const botToken = (platform as any)?.env?.DISCORD_BOT_TOKEN ||
    process.env.DISCORD_BOT_TOKEN;
  const clientId = (platform as any)?.env?.DISCORD_CLIENT_ID ||
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
