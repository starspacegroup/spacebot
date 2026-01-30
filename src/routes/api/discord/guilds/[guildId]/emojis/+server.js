/**
 * Discord Guild Emojis API
 * GET - Fetch emojis for a guild using bot token
 */

import { json } from "@sveltejs/kit";
import { log } from "$lib/db/logger.js";
import { verifyGuildAdmin } from "$lib/discord/guilds.js";

/** @type {import('./$types').RequestHandler} */
export async function GET({ params, cookies, platform }) {
  const { guildId } = params;
  const accessToken = cookies.get("discord_access_token");
  const botToken = platform?.env?.DISCORD_BOT_TOKEN ||
    process.env.DISCORD_BOT_TOKEN;

  // Verify user has access to this guild
  const authCheck = await verifyGuildAdmin(guildId, accessToken, cookies);
  if (!authCheck.authorized) {
    return json({ error: authCheck.error }, { status: 403 });
  }

  if (!botToken) {
    return json({ error: "Bot token not configured" }, { status: 500 });
  }

  try {
    // Fetch emojis from Discord API using bot token
    const response = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/emojis`,
      {
        headers: {
          Authorization: `Bot ${botToken}`,
        },
      },
    );

    if (!response.ok) {
      const error = await response.text();
      log.error("Discord API error:", error);
      return json({ error: "Failed to fetch emojis" }, { status: 500 });
    }

    const rawEmojis = await response.json();

    // Transform emojis to a simpler format
    const emojis = rawEmojis.map((emoji) => ({
      id: emoji.id,
      name: emoji.name,
      animated: emoji.animated || false,
      available: emoji.available !== false, // Default to true if not specified
      // Build the emoji string format Discord expects for reactions
      // For custom emojis: name:id (e.g., "custom_emoji:123456789")
      // The <: or <a: prefix is NOT needed for the reaction API
      reactionString: `${emoji.name}:${emoji.id}`,
      // Display format for messages (includes < > wrapper)
      displayString: emoji.animated 
        ? `<a:${emoji.name}:${emoji.id}>` 
        : `<:${emoji.name}:${emoji.id}>`,
      // URL for displaying the emoji image
      url: `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? 'gif' : 'png'}`,
    }))
    // Only include available emojis
    .filter((emoji) => emoji.available)
    // Sort alphabetically by name
    .sort((a, b) => a.name.localeCompare(b.name));

    return json({
      emojis,
      total: emojis.length,
    });
  } catch (error) {
    log.error("Error fetching emojis:", error);
    return json({ error: "Failed to fetch emojis" }, { status: 500 });
  }
}
