/**
 * Discord Guild Roles API
 * GET - Fetch roles for a guild using bot token
 */

import { json } from "@sveltejs/kit";

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

    // Check for admin or manage guild permission
    const permissions = BigInt(guild.permissions);
    const ADMINISTRATOR = BigInt(0x8);
    const MANAGE_GUILD = BigInt(0x20);

    if ((permissions & ADMINISTRATOR) || (permissions & MANAGE_GUILD)) {
      return { authorized: true };
    }

    return { authorized: false, error: "Insufficient permissions" };
  } catch (error) {
    console.error("Error verifying guild admin:", error);
    return { authorized: false, error: "Failed to verify permissions" };
  }
}

/** @type {import('./$types').RequestHandler} */
export async function GET({ params, cookies, platform }) {
  const { guildId } = params;
  const accessToken = cookies.get("discord_access_token");
  const botToken = platform?.env?.DISCORD_BOT_TOKEN ||
    process.env.DISCORD_BOT_TOKEN;

  // Verify user has access to this guild
  const authCheck = await verifyGuildAdmin(guildId, accessToken);
  if (!authCheck.authorized) {
    return json({ error: authCheck.error }, { status: 403 });
  }

  if (!botToken) {
    return json({ error: "Bot token not configured" }, { status: 500 });
  }

  try {
    // Fetch roles from Discord API using bot token
    const response = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/roles`,
      {
        headers: {
          Authorization: `Bot ${botToken}`,
        },
      },
    );

    if (!response.ok) {
      const error = await response.text();
      console.error("Discord API error:", error);
      return json({ error: "Failed to fetch roles" }, { status: 500 });
    }

    const rawRoles = await response.json();

    // Transform and sort roles by position (higher position = higher in hierarchy)
    const roles = rawRoles
      .map((role) => ({
        id: role.id,
        name: role.name,
        color: role.color
          ? `#${role.color.toString(16).padStart(6, "0")}`
          : null,
        position: role.position,
        managed: role.managed, // Bot/integration managed roles
        mentionable: role.mentionable,
        hoist: role.hoist, // Displayed separately in member list
      }))
      // Filter out @everyone role (position 0) and managed roles
      .filter((role) => role.position > 0 && !role.managed)
      // Sort by position descending (highest roles first)
      .sort((a, b) => b.position - a.position);

    return json({
      roles,
      total: roles.length,
    });
  } catch (error) {
    console.error("Error fetching roles:", error);
    return json({ error: "Failed to fetch roles" }, { status: 500 });
  }
}
