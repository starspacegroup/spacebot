import { redirect } from "@sveltejs/kit";
import { log } from "$lib/db/logger.js";

// Discord permission flags
const ADMINISTRATOR = 0x8;
const MANAGE_GUILD = 0x20;

/**
 * Fetch user's guilds from Discord API
 */
async function fetchUserGuilds(accessToken) {
  if (!accessToken) return [];

  try {
    const response = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) return [];
    return await response.json();
  } catch (error) {
    log.error("Error fetching guilds:", error);
    return [];
  }
}

/**
 * Fetch guild info from bot
 */
async function fetchGuildInfo(guildId, botToken) {
  try {
    log.debug(
      "[DEBUG] fetchGuildInfo - guildId:",
      guildId,
      "botToken exists:",
      !!botToken,
    );
    const response = await fetch(`https://discord.com/api/guilds/${guildId}`, {
      headers: { Authorization: `Bot ${botToken}` },
    });

    log.debug("[DEBUG] fetchGuildInfo response status:", response.status);
    if (!response.ok) {
      const text = await response.text();
      log.debug("[DEBUG] fetchGuildInfo error response:", text);
      return null;
    }
    return await response.json();
  } catch (error) {
    log.error("Error fetching guild info:", error);
    return null;
  }
}

export async function load({ params, cookies, platform, parent }) {
  const { serverId } = params;

  // Get parent layout data (includes user info, admin guilds, etc.)
  const parentData = await parent();
  const accessToken = cookies.get("discord_access_token");

  // Check if user is logged in
  if (!parentData.isLoggedIn || !parentData.user) {
    throw redirect(302, "/login");
  }

  const user = parentData.user;
  const botToken = platform?.env?.DISCORD_BOT_TOKEN ||
    process.env.DISCORD_BOT_TOKEN;
  const adminUserIds = platform?.env?.ADMIN_USER_IDS ||
    process.env.ADMIN_USER_IDS || "";

  // Check if superadmin (from parent or recalculated)
  const isSuperAdmin = parentData.isSuperAdmin;

  // Check if using dev auth bypass with mock token
  const isDevMockToken = accessToken === "dev_mock_token";

  // For dev mode, use guilds from parent data; otherwise fetch from Discord API
  let userGuilds = [];
  if (isDevMockToken && parentData.adminGuilds) {
    userGuilds = parentData.adminGuilds;
  } else {
    userGuilds = await fetchUserGuilds(accessToken);
  }

  // Find the requested guild
  const userGuild = userGuilds.find((g) => g.id === serverId);

  // Verify access
  let hasAccess = false;

  if (isSuperAdmin) {
    hasAccess = true;
  } else if (userGuild) {
    const permissions = BigInt(userGuild.permissions);
    hasAccess = userGuild.owner ||
      (permissions & BigInt(ADMINISTRATOR)) !== 0n ||
      (permissions & BigInt(MANAGE_GUILD)) !== 0n;
  }

  if (!hasAccess) {
    throw redirect(302, "/admin");
  }

  // Store this server as the last viewed guild
  cookies.set("last_viewed_guild", serverId, {
    path: "/",
    httpOnly: false,
    secure: false, // Allow on localhost
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });

  // Fetch guild info from bot
  const guildInfo = await fetchGuildInfo(serverId, botToken);

  if (!guildInfo) {
    // Bot not in guild
    return {
      user,
      isSuperAdmin,
      serverId,
      guild: userGuild
        ? {
          id: userGuild.id,
          name: userGuild.name,
          icon: userGuild.icon,
        }
        : null,
      botInGuild: false,
      error: "Bot is not in this server",
    };
  }

  return {
    user,
    isSuperAdmin,
    serverId,
    guild: {
      id: guildInfo.id,
      name: guildInfo.name,
      icon: guildInfo.icon,
      memberCount: guildInfo.approximate_member_count,
    },
    botInGuild: true,
  };
}
