import { redirect } from "@sveltejs/kit";
import { log } from "$lib/db/logger.js";
import {
  filterAdminGuilds,
  getBotGuildIds,
  getUserGuilds,
} from "$lib/discord/guilds.js";

// Timeout for guild fetching to prevent layout hangs (10 seconds)
const GUILD_FETCH_TIMEOUT = 10000;

/**
 * Fetch and process the admin guild list for a user.
 * Returns a sorted array of guilds with botIsInServer flags.
 */
async function buildAdminGuildsList(accessToken, botToken, isSuperAdmin, cookies) {
  const [allUserGuilds, botGuildIds] = await withTimeout(
    Promise.all([
      getUserGuilds(accessToken, cookies),
      getBotGuildIds(botToken, cookies),
    ]),
    GUILD_FETCH_TIMEOUT,
    [[], new Set()]
  );

  let adminGuilds = [];

  if (isSuperAdmin) {
    adminGuilds = allUserGuilds.map((guild) => ({
      ...guild,
      botIsInServer: botGuildIds.has(guild.id),
    }));
  } else {
    adminGuilds = filterAdminGuilds(allUserGuilds)
      .filter((guild) => botGuildIds.has(guild.id))
      .map((guild) => ({ ...guild, botIsInServer: true }));
  }

  adminGuilds.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return adminGuilds;
}

/**
 * Wrap a promise with a timeout to prevent hanging
 * @param {Promise<T>} promise - The promise to wrap
 * @param {number} ms - Timeout in milliseconds
 * @param {T} fallback - Fallback value if timeout occurs
 * @returns {Promise<T>}
 * @template T
 */
async function withTimeout(promise, ms, fallback) {
  let timeoutId;
  const timeoutPromise = new Promise((resolve) => {
    timeoutId = setTimeout(() => {
      log.warn(`[Layout] Request timed out after ${ms}ms, using fallback`);
      resolve(fallback);
    }, ms);
  });
  
  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId);
    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    log.error("[Layout] Promise error:", error);
    return fallback;
  }
}

/**
 * Safely get environment variable, works in both Node.js and Cloudflare Workers
 * @param {string} name - Environment variable name
 * @param {import('@sveltejs/kit').RequestEvent['platform']} platform - SvelteKit platform object
 * @returns {string|undefined}
 */
function getEnv(name, platform) {
  return platform?.env?.[name] ?? (typeof process !== 'undefined' ? process.env?.[name] : undefined);
}

/** @type {import('./$types').LayoutServerLoad} */
export async function load({ cookies, platform, url }) {
  console.log('[Layout] load() called, pathname:', url.pathname);
  
  // Check if dev auth bypass is enabled
  const isDev = getEnv('NODE_ENV', platform) !== 'production';
  const devAuthEnabled = isDev && getEnv('DEV_AUTH_BYPASS', platform) === 'true';
  
  // Check if user is logged in via cookie
  const userId = cookies.get("discord_user_id");
  console.log('[Layout] userId from cookie:', userId);

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
  const adminUserIds = getEnv('ADMIN_USER_IDS', platform) || "";

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

  // Fetch guilds for admin pages and pages that need guild data (e.g. /account)
  const isAdminPage = url.pathname.startsWith("/admin") || url.pathname.startsWith("/account");
  let adminGuilds = [];
  let selectedGuildId = null;

  // Always read the last viewed guild from cookie for non-admin pages
  // This allows links like "Go to Dashboard" to go directly to the right server
  const lastViewedGuildId = cookies.get("last_viewed_guild");
  if (!isAdminPage && lastViewedGuildId) {
    selectedGuildId = lastViewedGuildId;
  }

  log.debug("[Layout] isAdminPage:", isAdminPage, "pathname:", url.pathname);

  if (isAdminPage) {
    // Check if we're using dev auth bypass with a mock guild
    const devGuildId = getEnv('DISCORD_GUILD_ID', platform);
    const isDevMockToken =
      cookies.get("discord_access_token") === "dev_mock_token";

    if (devAuthEnabled && isDevMockToken && devGuildId) {
      // In dev mode with bypass, use the DISCORD_GUILD_ID as a mock server
      log.debug("[Layout] DEV MODE - Using mock guild:", devGuildId);
      const mockGuilds = [{
        id: devGuildId,
        name: "Dev Test Server",
        icon: null,
        owner: true,
        permissions: "2147483647", // All permissions
        botIsInServer: true,
      }];
      return {
        isLoggedIn: true,
        isAdmin: true,
        isSuperAdmin: true,
        user,
        adminGuilds: mockGuilds,
        selectedGuildId: devGuildId,
      };
    }

    const accessToken = cookies.get("discord_access_token");
    const botToken = getEnv('DISCORD_BOT_TOKEN', platform);

    log.debug(
      "[Layout] Has accessToken:",
      !!accessToken,
      "Has botToken:",
      !!botToken,
    );

    // Determine selectedGuildId immediately from URL path or cookie — no API call needed
    const pathMatch = url.pathname.match(/^\/admin\/(\d+)/);
    const selectedFromUrl = url.searchParams.get("guild") || pathMatch?.[1] || null;
    selectedGuildId = selectedFromUrl || lastViewedGuildId || null;

    // For /admin exact: redirect immediately using the last-viewed cookie.
    // This avoids blocking the redirect on a Discord API round-trip.
    if (url.pathname === "/admin" && !selectedFromUrl) {
      if (lastViewedGuildId) {
        log.debug("[Layout] Fast redirect to last viewed guild:", lastViewedGuildId);
        throw redirect(302, `/admin/${lastViewedGuildId}`);
      }
      // No cookie (first-ever visit): must fetch guilds to find somewhere to land.
      const guilds = await buildAdminGuildsList(accessToken, botToken, isSuperAdmin, cookies);
      const firstGuild = guilds.find((g) => g.botIsInServer !== false) || guilds[0];
      if (firstGuild) {
        cookies.set("last_viewed_guild", firstGuild.id, {
          path: "/",
          httpOnly: false,
          secure: false,
          sameSite: "lax",
          maxAge: 60 * 60 * 24 * 365,
        });
        throw redirect(302, `/admin/${firstGuild.id}`);
      }
      return {
        isLoggedIn: true,
        isAdmin: isSuperAdmin || guilds.length > 0,
        isSuperAdmin,
        user,
        adminGuilds: guilds,
        selectedGuildId: null,
      };
    }

    // Store selected guild in cookie immediately (we know it from URL/cookie already)
    if (selectedGuildId) {
      cookies.set("last_viewed_guild", selectedGuildId, {
        path: "/",
        httpOnly: false,
        secure: false,
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 365,
      });
    }

    // Resolve guilds before returning so child server loaders always receive an array.
    // Returning a Promise here can surface as runtime TypeErrors in routes that call
    // array helpers such as .filter/.some/.find on parentData.adminGuilds.
    adminGuilds = await buildAdminGuildsList(accessToken, botToken, isSuperAdmin, cookies);

    return {
      isLoggedIn: true,
      isAdmin: true, // Logged-in user is on an admin page; individual pages guard auth
      isSuperAdmin,
      user,
      adminGuilds,
      selectedGuildId,
    };
  }

  return {
    isLoggedIn: true,
    isAdmin: isSuperAdmin,
    isSuperAdmin,
    user,
    adminGuilds: [],
    selectedGuildId,
  };
}
