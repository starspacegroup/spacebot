import "dotenv/config";

console.log(
  "[Layout] Module loaded, BOT_TOKEN exists:",
  !!process.env.DISCORD_BOT_TOKEN,
);

/** @type {import('./$types').LayoutServerLoad} */
export async function load({ cookies, platform, url }) {
  // Check if user is logged in via cookie
  const userId = cookies.get("discord_user_id");

  if (!userId) {
    return {
      isLoggedIn: false,
      isAdmin: false,
      isSuperAdmin: false,
      user: null,
      adminGuilds: [],
      selectedGuildId: null,
    };
  }

  // Get ADMIN_USER_IDS from environment (these are superadmins with full access)
  const adminUserIds = platform?.env?.ADMIN_USER_IDS ||
    process.env.ADMIN_USER_IDS || "";

  // Parse comma-separated list of superadmin IDs
  const superAdminIdList = adminUserIds.split(",").map((id) => id.trim())
    .filter(
      Boolean,
    );

  // Check if current user is a superadmin (defined in ADMIN_USER_IDS)
  const isSuperAdmin = superAdminIdList.includes(userId);

  // Get user info from cookies
  const user = {
    id: userId,
    username: cookies.get("discord_username") || "User",
    avatar: cookies.get("discord_avatar") || null,
    globalName: cookies.get("discord_global_name") || null,
    discriminator: cookies.get("discord_discriminator") || "0",
  };

  // Only fetch guilds if we're on an admin page
  const isAdminPage = url.pathname.startsWith("/admin");
  let adminGuilds = [];
  let selectedGuildId = null;

  console.log("[Layout] isAdminPage:", isAdminPage, "pathname:", url.pathname);

  if (isAdminPage) {
    const accessToken = cookies.get("discord_access_token");
    const botToken = platform?.env?.DISCORD_BOT_TOKEN ||
      process.env.DISCORD_BOT_TOKEN;

    console.log(
      "[Layout] Has accessToken:",
      !!accessToken,
      "Has botToken:",
      !!botToken,
    );

    // Fetch user's guilds
    const allUserGuilds = await fetchUserGuilds(accessToken);
    const botGuildIds = await fetchBotGuilds(botToken);

    console.log(
      "[Layout] User guilds:",
      allUserGuilds.length,
      "Bot guilds:",
      botGuildIds.size,
    );

    if (isSuperAdmin) {
      // Superadmin sees ALL guilds where the bot is a member plus their admin guilds
      const allBotGuilds = await fetchBotGuildsWithDetails(botToken);
      const userAdminGuilds = filterAdminGuilds(allUserGuilds);

      console.log(
        "[Layout] SUPERADMIN - Bot guilds:",
        allBotGuilds.map((g) => g.name),
      );
      console.log(
        "[Layout] SUPERADMIN - User admin guilds:",
        userAdminGuilds.map((g) => g.name),
      );

      // Start with bot guilds
      adminGuilds = [...allBotGuilds];
      const addedGuildIds = new Set(allBotGuilds.map((g) => g.id));

      // Add user's admin guilds, marking whether bot is in them or not
      userAdminGuilds.forEach((guild) => {
        if (!addedGuildIds.has(guild.id)) {
          // Guild not already added from bot guilds
          if (botGuildIds.has(guild.id)) {
            // Bot IS in this guild, add it without botNotIn flag
            adminGuilds.push({ ...guild });
          } else {
            // Bot is NOT in this guild
            adminGuilds.push({ ...guild, botNotIn: true });
          }
        }
      });

      console.log(
        "[Layout] SUPERADMIN - Final combined guilds:",
        adminGuilds.map((g) => ({ name: g.name, botNotIn: g.botNotIn })),
      );
    } else {
      // Regular users: only guilds where they have admin permissions AND bot is present
      const userAdminGuilds = filterAdminGuilds(allUserGuilds);
      console.log(
        "[Layout] User admin guilds:",
        userAdminGuilds.map((g) => g.name),
      );
      console.log("[Layout] Bot guild IDs:", [...botGuildIds]);
      adminGuilds = userAdminGuilds.filter(
        (guild) => botGuildIds.has(guild.id),
      );
      console.log(
        "[Layout] Intersection (admin guilds with bot):",
        adminGuilds.map((g) => g.name),
      );
    }

    // Get selected guild from URL params, path params, or cookie
    // First check URL query param
    let selectedFromUrl = url.searchParams.get("guild");

    // If not in query, check if we're on a /admin/{serverId}/* route
    if (!selectedFromUrl) {
      const pathMatch = url.pathname.match(/^\/admin\/(\d+)/);
      if (pathMatch) {
        selectedFromUrl = pathMatch[1];
      }
    }

    // Check for last viewed guild in cookie
    const lastViewedGuildId = cookies.get("last_viewed_guild");

    // Filter guilds where bot is actually installed (for default selection)
    const guildsWithBot = adminGuilds.filter((g) => !g.botNotIn);

    console.log(
      "[Layout] selectedFromUrl:",
      selectedFromUrl,
      "lastViewedGuildId:",
      lastViewedGuildId,
      "guildsWithBot:",
      guildsWithBot.length,
    );

    // Determine selected guild: URL > cookie (if bot is in it) > first guild with bot > first guild
    if (selectedFromUrl) {
      selectedGuildId = selectedFromUrl;
    } else if (
      lastViewedGuildId && guildsWithBot.some((g) => g.id === lastViewedGuildId)
    ) {
      // Cookie guild is valid AND bot is in it
      selectedGuildId = lastViewedGuildId;
    } else if (guildsWithBot.length > 0) {
      // Default to first guild where bot is installed
      selectedGuildId = guildsWithBot[0].id;
    } else if (adminGuilds.length > 0) {
      // Fallback to first guild even if bot isn't in it
      selectedGuildId = adminGuilds[0].id;
    }

    console.log(
      "[Layout] Final adminGuilds:",
      adminGuilds.length,
      "selectedGuildId:",
      selectedGuildId,
      "guilds:",
      adminGuilds.map((g) => ({
        id: g.id,
        name: g.name,
        botNotIn: g.botNotIn,
      })),
    );
  }

  return {
    isLoggedIn: true,
    isAdmin: isSuperAdmin || adminGuilds.length > 0,
    isSuperAdmin,
    user,
    adminGuilds,
    selectedGuildId,
  };
}

/**
 * Fetch user's guilds from Discord API
 */
async function fetchUserGuilds(accessToken) {
  if (!accessToken) {
    console.log("[Layout] fetchUserGuilds: No access token");
    return [];
  }

  try {
    const response = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) return [];
    return await response.json();
  } catch (error) {
    console.error("Error fetching guilds:", error);
    return [];
  }
}

/**
 * Fetch guilds where the bot is a member
 */
async function fetchBotGuilds(botToken) {
  if (!botToken) {
    console.log("[Layout] fetchBotGuilds: No bot token");
    return new Set();
  }

  try {
    const response = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: {
        Authorization: `Bot ${botToken}`,
      },
    });

    if (!response.ok) {
      console.log("[Layout] fetchBotGuilds: Response not ok:", response.status);
      return new Set();
    }
    const guilds = await response.json();
    console.log("[Layout] fetchBotGuilds: Got", guilds.length, "guilds");
    return new Set(guilds.map((g) => g.id));
  } catch (error) {
    console.error("Error fetching bot guilds:", error);
    return new Set();
  }
}

/**
 * Fetch bot guilds with full details (for superadmins)
 */
async function fetchBotGuildsWithDetails(botToken) {
  if (!botToken) return [];

  try {
    const response = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: {
        Authorization: `Bot ${botToken}`,
      },
    });

    if (!response.ok) return [];
    const guilds = await response.json();
    return guilds.map((guild) => ({
      id: guild.id,
      name: guild.name,
      icon: guild.icon,
      owner: false,
    }));
  } catch (error) {
    console.error("Error fetching bot guilds:", error);
    return [];
  }
}

/**
 * Filter guilds where user has admin permissions
 */
function filterAdminGuilds(guilds) {
  const ADMINISTRATOR = 0x8;
  const MANAGE_GUILD = 0x20;

  const filtered = guilds.filter((guild) => {
    const permissions = BigInt(guild.permissions);
    const isAdmin = guild.owner ||
      (permissions & BigInt(ADMINISTRATOR)) !== 0n ||
      (permissions & BigInt(MANAGE_GUILD)) !== 0n;
    return isAdmin;
  }).map((guild) => ({
    id: guild.id,
    name: guild.name,
    icon: guild.icon,
    owner: guild.owner,
  }));

  console.log(
    "[Layout] filterAdminGuilds: Filtered",
    guilds.length,
    "to",
    filtered.length,
    "admin guilds",
  );
  return filtered;
}
