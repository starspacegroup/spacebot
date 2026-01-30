/**
 * Discord Guild Channels API
 * GET - Fetch channels for a guild using bot token
 */

import { json } from "@sveltejs/kit";
import { log } from "$lib/db/logger.js";
import { verifyGuildAdmin } from "$lib/discord/guilds.js";

/**
 * Discord channel types
 * @see https://discord.com/developers/docs/resources/channel#channel-object-channel-types
 */
const CHANNEL_TYPES = {
  0: "text",
  1: "dm",
  2: "voice",
  3: "group_dm",
  4: "category",
  5: "announcement",
  10: "announcement_thread",
  11: "public_thread",
  12: "private_thread",
  13: "stage",
  14: "directory",
  15: "forum",
  16: "media",
};

/**
 * Channel types where bots can send text messages
 */
const TEXT_SENDABLE_TYPES = [
  "text", // Regular text channels
  "announcement", // Announcement/news channels
  "voice", // Voice channels (have text chat)
  "public_thread", // Public threads
  "private_thread", // Private threads
  "announcement_thread", // Announcement threads
];

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

  // Get optional type filter from query params
  const typeFilter = url.searchParams.get("type"); // e.g., "text", "voice", "sendable"

  try {
    // Fetch channels from Discord API using bot token
    const response = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/channels`,
      {
        headers: {
          Authorization: `Bot ${botToken}`,
        },
      },
    );

    if (!response.ok) {
      const error = await response.text();
      log.error("Discord API error:", error);
      return json({ error: "Failed to fetch channels" }, { status: 500 });
    }

    const rawChannels = await response.json();

    // Transform all channels first (keep categories for grouping)
    const allChannels = rawChannels.map((ch) => ({
      id: ch.id,
      name: ch.name,
      type: CHANNEL_TYPES[ch.type] || "unknown",
      typeId: ch.type,
      parentId: ch.parent_id,
      position: ch.position,
    }));

    // Extract categories for grouping (always keep these)
    const categories = allChannels.filter((ch) => ch.type === "category");

    // Filter non-category channels by type if specified
    let filteredChannels = allChannels.filter((ch) => ch.type !== "category");

    if (typeFilter) {
      if (typeFilter === "sendable") {
        // Filter to only channels where bot can send text messages
        filteredChannels = filteredChannels.filter((ch) =>
          TEXT_SENDABLE_TYPES.includes(ch.type)
        );
      } else {
        const types = typeFilter.split(",");
        filteredChannels = filteredChannels.filter((ch) =>
          types.includes(ch.type)
        );
      }
    }

    // Group channels by category
    const organizedChannels = [];

    // Add uncategorized channels first
    const uncategorized = filteredChannels
      .filter((ch) => !ch.parentId)
      .sort((a, b) => a.position - b.position);

    if (uncategorized.length > 0) {
      organizedChannels.push({
        category: null,
        categoryName: "No Category",
        channels: uncategorized,
      });
    }

    // Add channels by category
    categories
      .sort((a, b) => a.position - b.position)
      .forEach((category) => {
        const categoryChannels = filteredChannels
          .filter((ch) => ch.parentId === category.id)
          .sort((a, b) => a.position - b.position);

        if (categoryChannels.length > 0) {
          organizedChannels.push({
            category: category.id,
            categoryName: category.name,
            channels: categoryChannels,
          });
        }
      });

    return json({
      channels: organizedChannels,
      total: filteredChannels.length,
    });
  } catch (error) {
    log.error("Error fetching channels:", error);
    return json({ error: "Failed to fetch channels" }, { status: 500 });
  }
}
