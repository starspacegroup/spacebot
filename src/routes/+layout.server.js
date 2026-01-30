import { redirect } from "@sveltejs/kit";
import "dotenv/config";
import { log } from "$lib/db/logger.js";
import {
  filterAdminGuilds,
  getBotGuildIds,
  getBotGuildsWithDetails,
  getUserGuilds,
} from "$lib/discord/guilds.js";

log.debug(
  "[Layout] Module loaded, BOT_TOKEN exists:",
  !!process.env.DISCORD_BOT_TOKEN,
);

// Check if dev auth bypass is enabled
const isDev = process.env.NODE_ENV !== "production";
const devAuthEnabled = isDev && process.env.DEV_AUTH_BYPASS === "true";

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

  log.debug(
    "[Layout] userId:",
    userId,
    "superAdminIdList:",
    superAdminIdList,
    "isSuperAdmin:",
    isSuperAdmin,
  );

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

  log.debug("[Layout] isAdminPage:", isAdminPage, "pathname:", url.pathname);

  if (isAdminPage) {
    // Check if we're using dev auth bypass with a mock guild
    const devGuildId = platform?.env?.DISCORD_GUILD_ID ||
      process.env.DISCORD_GUILD_ID;
    const isDevMockToken =
      cookies.get("discord_access_token") === "dev_mock_token";

    if (devAuthEnabled && isDevMockToken && devGuildId) {
      // In dev mode with bypass, use the DISCORD_GUILD_ID as a mock server
      log.debug("[Layout] DEV MODE - Using mock guild:", devGuildId);
      adminGuilds = [{
        id: devGuildId,
        name: "Dev Test Server",
        icon: null,
        owner: true,
        permissions: "2147483647", // All permissions
        botIsInServer: true,
      }];
      selectedGuildId = devGuildId;

      return {
        isLoggedIn: true,
        isAdmin: true,
        isSuperAdmin: true,
        user,
        adminGuilds,
        selectedGuildId,
      };
    }

    const accessToken = cookies.get("discord_access_token");
    const botToken = platform?.env?.DISCORD_BOT_TOKEN ||
      process.env.DISCORD_BOT_TOKEN;

    log.debug(
      "[Layout] Has accessToken:",
      !!accessToken,
      "Has botToken:",
      !!botToken,
    );

    // Fetch user's guilds (with caching)
    const allUserGuilds = await getUserGuilds(accessToken, cookies);
    const botGuildIds = await getBotGuildIds(botToken, cookies);

    log.debug(
      "[Layout] User guilds:",
      allUserGuilds.length,
      "Bot guilds:",
      botGuildIds.size,
    );

    if (isSuperAdmin) {
      // Superadmin sees ALL guilds where the bot is a member plus their admin guilds
      const allBotGuilds = await getBotGuildsWithDetails(botToken, cookies);
      const userAdminGuilds = filterAdminGuilds(allUserGuilds);

      log.debug(
        "[Layout] SUPERADMIN - Bot guilds:",
        allBotGuilds.map((g) => g.name),
      );
      log.debug(
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
            // Bot IS in this guild
            adminGuilds.push({ ...guild, botIsInServer: true });
          } else {
            // Bot is NOT in this guild
            adminGuilds.push({ ...guild, botIsInServer: false });
          }
        }
      });

      log.debug(
        "[Layout] SUPERADMIN - Final combined guilds:",
        adminGuilds.map((g) => ({
          name: g.name,
          botIsInServer: g.botIsInServer,
        })),
      );
    } else {
      // Regular users: only guilds where they have admin permissions AND bot is present
      const userAdminGuilds = filterAdminGuilds(allUserGuilds);
      log.debug(
        "[Layout] User admin guilds:",
        userAdminGuilds.map((g) => g.name),
      );
      log.debug("[Layout] Bot guild IDs:", [...botGuildIds]);
      // Filter to only guilds where bot is present AND mark them as botIsInServer: true
      adminGuilds = userAdminGuilds
        .filter((guild) => botGuildIds.has(guild.id))
        .map((guild) => ({ ...guild, botIsInServer: true }));
      log.debug(
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
    const guildsWithBot = adminGuilds.filter((g) => g.botIsInServer !== false);

    log.debug(
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

    // If we're on the base /admin page and no guild in URL, redirect to /admin/{selectedGuildId}
    if (!selectedFromUrl && selectedGuildId && url.pathname === "/admin") {
      log.debug(
        "[Layout] Redirecting to server-specific admin URL:",
        selectedGuildId,
      );
      throw redirect(302, `/admin/${selectedGuildId}`);
    }

    // Store the selected guild in a cookie for next visit (only if bot is in it)
    if (
      selectedGuildId && guildsWithBot.some((g) => g.id === selectedGuildId)
    ) {
      cookies.set("last_viewed_guild", selectedGuildId, {
        path: "/",
        httpOnly: false,
        secure: false, // Allow on localhost
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 365, // 1 year
      });
    }

    log.debug(
      "[Layout] Final adminGuilds:",
      adminGuilds.length,
      "guildsWithBot:",
      guildsWithBot.map((g) => ({
        id: g.id,
        name: g.name,
        botIsInServer: g.botIsInServer,
      })),
      "selectedGuildId:",
      selectedGuildId,
      "guilds:",
      adminGuilds.map((g) => ({
        id: g.id,
        name: g.name,
        botIsInServer: g.botIsInServer,
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
