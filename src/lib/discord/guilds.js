/**
 * Discord Guilds Cache Helper
 *
 * Caches guild data in cookies to reduce Discord API calls.
 * The cache is stored per-user and has a configurable TTL.
 */

import { log } from "$lib/db/logger.js";

// Cache TTL in seconds (5 minutes)
const CACHE_TTL = 5 * 60;

// Permission constants
const ADMINISTRATOR = BigInt(0x8);
const MANAGE_GUILD = BigInt(0x20);

/**
 * Get user's guilds with caching
 * @param {string} accessToken - Discord OAuth access token
 * @param {import('@sveltejs/kit').Cookies} cookies - SvelteKit cookies
 * @param {boolean} forceRefresh - Force a refresh from Discord API
 * @returns {Promise<Array>} - Array of guild objects
 */
export async function getUserGuilds(
  accessToken,
  cookies,
  forceRefresh = false,
) {
  if (!accessToken) {
    return [];
  }

  // Check cache first
  if (!forceRefresh) {
    const cached = getCachedGuilds(cookies, "user_guilds");
    if (cached) {
      log.debug("[Guilds Cache] Using cached user guilds");
      return cached;
    }
  }

  // Fetch from Discord API
  try {
    log.debug("[Guilds Cache] Fetching user guilds from Discord API");
    const response = await fetch(
      "https://discord.com/api/v10/users/@me/guilds",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    if (!response.ok) {
      log.error("[Guilds Cache] Failed to fetch user guilds:", response.status);
      return [];
    }

    const guilds = await response.json();

    // Cache the result
    setCachedGuilds(cookies, "user_guilds", guilds);

    return guilds;
  } catch (error) {
    log.error("[Guilds Cache] Error fetching user guilds:", error);
    return [];
  }
}

/**
 * Get bot's guilds with caching
 * @param {string} botToken - Discord bot token
 * @param {import('@sveltejs/kit').Cookies} cookies - SvelteKit cookies
 * @param {boolean} forceRefresh - Force a refresh from Discord API
 * @returns {Promise<Set<string>>} - Set of guild IDs where bot is a member
 */
export async function getBotGuildIds(botToken, cookies, forceRefresh = false) {
  if (!botToken) {
    return new Set();
  }

  // Check cache first
  if (!forceRefresh) {
    const cached = getCachedGuilds(cookies, "bot_guild_ids");
    if (cached) {
      log.debug("[Guilds Cache] Using cached bot guild IDs");
      return new Set(cached);
    }
  }

  // Fetch from Discord API
  try {
    log.debug("[Guilds Cache] Fetching bot guilds from Discord API");
    const response = await fetch(
      "https://discord.com/api/v10/users/@me/guilds",
      {
        headers: {
          Authorization: `Bot ${botToken}`,
        },
      },
    );

    if (!response.ok) {
      log.error("[Guilds Cache] Failed to fetch bot guilds:", response.status);
      return new Set();
    }

    const guilds = await response.json();
    const guildIds = guilds.map((g) => g.id);

    // Cache the result (store as array for JSON serialization)
    setCachedGuilds(cookies, "bot_guild_ids", guildIds);

    return new Set(guildIds);
  } catch (error) {
    log.error("[Guilds Cache] Error fetching bot guilds:", error);
    return new Set();
  }
}

/**
 * Get bot's guilds with full details (for superadmins)
 * @param {string} botToken - Discord bot token
 * @param {import('@sveltejs/kit').Cookies} cookies - SvelteKit cookies
 * @param {boolean} forceRefresh - Force a refresh from Discord API
 * @returns {Promise<Array>} - Array of guild objects with details
 */
export async function getBotGuildsWithDetails(
  botToken,
  cookies,
  forceRefresh = false,
) {
  if (!botToken) {
    return [];
  }

  // Check cache first
  if (!forceRefresh) {
    const cached = getCachedGuilds(cookies, "bot_guilds_details");
    if (cached) {
      log.debug("[Guilds Cache] Using cached bot guilds with details");
      return cached;
    }
  }

  // Fetch from Discord API
  try {
    log.debug(
      "[Guilds Cache] Fetching bot guilds with details from Discord API",
    );
    const response = await fetch(
      "https://discord.com/api/v10/users/@me/guilds",
      {
        headers: {
          Authorization: `Bot ${botToken}`,
        },
      },
    );

    if (!response.ok) {
      return [];
    }

    const guilds = await response.json();
    const guildsWithDetails = guilds.map((guild) => ({
      id: guild.id,
      name: guild.name,
      icon: guild.icon,
      owner: false,
      botIsInServer: true,
    }));

    // Cache the result
    setCachedGuilds(cookies, "bot_guilds_details", guildsWithDetails);

    return guildsWithDetails;
  } catch (error) {
    log.error("[Guilds Cache] Error fetching bot guilds with details:", error);
    return [];
  }
}

/**
 * Verify user has admin access to a specific guild
 * Uses cached guild data to avoid redundant API calls
 *
 * @param {string} guildId - The guild ID to check
 * @param {string} accessToken - Discord OAuth access token
 * @param {import('@sveltejs/kit').Cookies} cookies - SvelteKit cookies
 * @returns {Promise<{authorized: boolean, error?: string, guild?: object}>}
 */
export async function verifyGuildAdmin(guildId, accessToken, cookies) {
  if (!accessToken || !guildId) {
    return { authorized: false, error: "Unauthorized" };
  }

  try {
    const guilds = await getUserGuilds(accessToken, cookies);
    const guild = guilds.find((g) => g.id === guildId);

    if (!guild) {
      return { authorized: false, error: "Guild not found" };
    }

    // Check for admin or manage guild permission
    const permissions = BigInt(guild.permissions);

    if ((permissions & ADMINISTRATOR) || (permissions & MANAGE_GUILD)) {
      return { authorized: true, guild };
    }

    return { authorized: false, error: "Insufficient permissions" };
  } catch (error) {
    log.error("[Guilds Cache] Guild verification error:", error);
    return { authorized: false, error: "Verification failed" };
  }
}

/**
 * Verify user has access to a guild (with bot presence check)
 * Includes superadmin bypass and bot guild membership verification
 * Uses cached guild data to avoid redundant API calls
 *
 * @param {string} guildId - The guild ID to check
 * @param {string} accessToken - Discord OAuth access token
 * @param {string} botToken - Discord bot token
 * @param {string} adminUserIds - Comma-separated list of superadmin user IDs
 * @param {import('@sveltejs/kit').Cookies} cookies - SvelteKit cookies
 * @returns {Promise<{hasAccess: boolean, isSuperAdmin?: boolean, reason?: string}>}
 */
export async function verifyGuildAccess(
  guildId,
  accessToken,
  botToken,
  adminUserIds,
  cookies,
) {
  if (!accessToken) return { hasAccess: false };

  try {
    // Fetch user info (not cached as it's user-specific metadata)
    const userResponse = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userResponse.ok) return { hasAccess: false };
    const user = await userResponse.json();

    // Check if superadmin
    const superAdminIds = (adminUserIds || "").split(",").map((id) =>
      id.trim()
    );
    if (superAdminIds.includes(user.id)) {
      return { hasAccess: true, isSuperAdmin: true };
    }

    // Fetch user's guilds (cached)
    const guilds = await getUserGuilds(accessToken, cookies);

    // Find the requested guild
    const guild = guilds.find((g) => g.id === guildId);
    if (!guild) return { hasAccess: false };

    // Check permissions
    const permissions = BigInt(guild.permissions);
    const hasAdmin = guild.owner ||
      (permissions & ADMINISTRATOR) !== 0n ||
      (permissions & MANAGE_GUILD) !== 0n;

    if (!hasAdmin) return { hasAccess: false };

    // Verify bot is in the guild (cached)
    const botGuildIds = await getBotGuildIds(botToken, cookies);
    if (botGuildIds.size > 0 && !botGuildIds.has(guildId)) {
      return { hasAccess: false, reason: "Bot not in guild" };
    }

    return { hasAccess: true };
  } catch (error) {
    log.error("[Guilds Cache] Error verifying guild access:", error);
    return { hasAccess: false };
  }
}

/**
 * Filter guilds where user has admin permissions
 * @param {Array} guilds - Array of guild objects
 * @returns {Array} - Filtered array of admin guilds
 */
export function filterAdminGuilds(guilds) {
  const filtered = guilds.filter((guild) => {
    const permissions = BigInt(guild.permissions);
    const isAdmin = guild.owner ||
      (permissions & ADMINISTRATOR) !== 0n ||
      (permissions & MANAGE_GUILD) !== 0n;
    return isAdmin;
  }).map((guild) => ({
    id: guild.id,
    name: guild.name,
    icon: guild.icon,
    owner: guild.owner,
  }));

  log.debug(
    "[Guilds Cache] filterAdminGuilds: Filtered",
    guilds.length,
    "to",
    filtered.length,
    "admin guilds",
  );
  return filtered;
}

/**
 * Invalidate all guild caches (call after bot install/uninstall)
 * @param {import('@sveltejs/kit').Cookies} cookies - SvelteKit cookies
 */
export function invalidateGuildCache(cookies) {
  log.debug("[Guilds Cache] Invalidating all guild caches");
  cookies.delete("cached_user_guilds", { path: "/" });
  cookies.delete("cached_bot_guild_ids", { path: "/" });
  cookies.delete("cached_bot_guilds_details", { path: "/" });
}

// --- Private helper functions ---

/**
 * Get cached guilds from cookie
 * @param {import('@sveltejs/kit').Cookies} cookies
 * @param {string} key - Cache key
 * @returns {Array|null} - Cached data or null if expired/missing
 */
function getCachedGuilds(cookies, key) {
  try {
    const cached = cookies.get(`cached_${key}`);
    if (!cached) return null;

    const { data, timestamp } = JSON.parse(cached);
    const age = (Date.now() - timestamp) / 1000;

    if (age > CACHE_TTL) {
      log.debug(`[Guilds Cache] Cache expired for ${key} (age: ${age}s)`);
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

/**
 * Set cached guilds in cookie
 * @param {import('@sveltejs/kit').Cookies} cookies
 * @param {string} key - Cache key
 * @param {Array} data - Data to cache
 */
function setCachedGuilds(cookies, key, data) {
  const cacheValue = JSON.stringify({
    data,
    timestamp: Date.now(),
  });

  cookies.set(`cached_${key}`, cacheValue, {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: CACHE_TTL,
  });
}
