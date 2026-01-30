/**
 * Discord Guild Members API
 * GET - Fetch members for a guild using bot token
 * Supports search query for filtering members
 */

import { json } from "@sveltejs/kit";
import { log } from "$lib/db/logger.js";
import { verifyGuildAdmin } from "$lib/discord/guilds.js";

/** @type {import('./$types').RequestHandler} */
export async function GET({ params, cookies, platform, url }) {
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
    // Get search query from URL params
    const searchQuery = url.searchParams.get("query")?.trim() || "";
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 1000);

    let members = [];

    if (searchQuery && searchQuery.length >= 1) {
      // Use search endpoint for filtered results
      const response = await fetch(
        `https://discord.com/api/v10/guilds/${guildId}/members/search?query=${encodeURIComponent(searchQuery)}&limit=${limit}`,
        {
          headers: {
            Authorization: `Bot ${botToken}`,
          },
        },
      );

      if (!response.ok) {
        const error = await response.text();
        log.error("Discord API error (search):", error);
        return json({ error: "Failed to search members" }, { status: 500 });
      }

      members = await response.json();
    } else {
      // Fetch initial batch of members (no search)
      const response = await fetch(
        `https://discord.com/api/v10/guilds/${guildId}/members?limit=${limit}`,
        {
          headers: {
            Authorization: `Bot ${botToken}`,
          },
        },
      );

      if (!response.ok) {
        const error = await response.text();
        log.error("Discord API error (list):", error);
        return json({ error: "Failed to fetch members" }, { status: 500 });
      }

      members = await response.json();
    }

    // Transform members to a simpler format
    const transformedMembers = members.map((member) => ({
      id: member.user.id,
      username: member.user.username,
      displayName: member.nick || member.user.global_name || member.user.username,
      avatar: member.user.avatar
        ? `https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.png?size=32`
        : `https://cdn.discordapp.com/embed/avatars/${parseInt(member.user.discriminator || "0") % 5}.png`,
      isBot: member.user.bot || false,
      joinedAt: member.joined_at,
    }));

    // Sort by display name
    transformedMembers.sort((a, b) => 
      a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase())
    );

    return json({
      members: transformedMembers,
      total: transformedMembers.length,
    });
  } catch (error) {
    log.error("Error fetching guild members:", error);
    return json({ error: "Failed to fetch members" }, { status: 500 });
  }
}
