/**
 * Discord Guilds Cache Helper
 *
 * Caches guild data using in-memory cache with cookie fallback.
 * The cache is stored per-user and has a configurable TTL.
 */

import { log } from "../db/logger.js";

// Cache TTL in seconds (15 minutes - longer to reduce API calls over tunnel)
const CACHE_TTL = 15 * 60;

// Cache TTL in milliseconds for in-memory cache
const CACHE_TTL_MS = CACHE_TTL * 1000;

// API timeout in milliseconds (5 seconds)
const API_TIMEOUT = 5000;

// Permission constants
const ADMINISTRATOR = BigInt(0x8);
const MANAGE_GUILD = BigInt(0x20);

// In-memory cache for guilds (keyed by a hash of the access token)
/** @type {Map<string, {data: any, timestamp: number}>} */
const memoryCache = new Map();

/**
 * Generate a simple hash of the access token for cache key
 * @param {string} token
 * @returns {string}
 */
function hashToken(token) {
  // Simple hash - just use first 16 chars + last 8 chars
  // This is NOT cryptographic, just for cache keying
  if (token.length < 24) return token;
  return `${token.slice(0, 16)}...${token.slice(-8)}`;
}

/**
 * Get from in-memory cache
 * @param {string} key
 * @param {boolean} allowStale - If true, return stale data even if expired
 * @returns {any|null}
 */
function getMemoryCache(key, allowStale = false) {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    if (allowStale) {
      log.debug(`[Guilds Cache] Returning stale in-memory cache for ${key}`);
      return entry.data;
    }
    memoryCache.delete(key);
    return null;
  }
  return entry.data;
}

/**
 * Set in-memory cache
 * @param {string} key
 * @param {any} data
 */
function setMemoryCache(key, data) {
  memoryCache.set(key, { data, timestamp: Date.now() });
  
  // Cleanup old entries periodically (keep cache from growing indefinitely)
  if (memoryCache.size > 100) {
    const now = Date.now();
    for (const [k, v] of memoryCache.entries()) {
      if (now - v.timestamp > CACHE_TTL_MS) {
        memoryCache.delete(k);
      }
    }
  }
}

/**
 * Fetch with timeout to prevent hanging requests
 * @param {string} url - URL to fetch
 * @param {RequestInit} options - Fetch options
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}, timeout = API_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

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
    log.debug("[Guilds Cache] No accessToken provided");
    return [];
  }

  const cacheKey = `user_guilds_${hashToken(accessToken)}`;

  // Check in-memory cache first (fastest)
  if (!forceRefresh) {
    const memCached = getMemoryCache(cacheKey);
    if (memCached) {
      log.debug("[Guilds Cache] Using in-memory cached user guilds, count:", memCached.length);
      return memCached;
    }

    // Fallback to cookie cache
    const cookieCached = getCachedGuilds(cookies, "user_guilds");
    if (cookieCached) {
      log.debug("[Guilds Cache] Using cookie cached user guilds, count:", cookieCached.length);
      // Populate in-memory cache from cookie
      setMemoryCache(cacheKey, cookieCached);
      return cookieCached;
    }
    log.debug("[Guilds Cache] No valid cache for user_guilds");
  }

  // Fetch from Discord API
  try {
    log.debug("[Guilds Cache] Fetching user guilds from Discord API");
    const response = await fetchWithTimeout(
      "https://discord.com/api/v10/users/@me/guilds",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    if (!response.ok) {
      log.error("[Guilds Cache] Failed to fetch user guilds:", response.status);
      // Return stale cache data if available, rather than empty array
      const staleData = getMemoryCache(cacheKey, true);
      if (staleData) {
        log.debug("[Guilds Cache] API failed, using stale user guilds cache");
        return staleData;
      }
      return [];
    }

    const guilds = await response.json();
    log.debug(
      "[Guilds Cache] Fetched",
      guilds.length,
      "guilds from Discord API",
    );

    // Cache in memory (always works, regardless of size)
    setMemoryCache(cacheKey, guilds);
    
    // Try to cache in cookie (may fail if too large, but that's okay)
    setCachedGuilds(cookies, "user_guilds", guilds);

    return guilds;
  } catch (error) {
    log.error("[Guilds Cache] Error fetching user guilds:", error);
    // Return stale cache data if available, rather than empty array
    const staleData = getMemoryCache(cacheKey, true);
    if (staleData) {
      log.debug("[Guilds Cache] API error, using stale user guilds cache");
      return staleData;
    }
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

  const cacheKey = `bot_guild_ids_${hashToken(botToken)}`;

  // Check in-memory cache first
  if (!forceRefresh) {
    const memCached = getMemoryCache(cacheKey);
    if (memCached) {
      log.debug("[Guilds Cache] Using in-memory cached bot guild IDs");
      return new Set(memCached);
    }

    // Fallback to cookie cache
    const cookieCached = getCachedGuilds(cookies, "bot_guild_ids");
    if (cookieCached) {
      log.debug("[Guilds Cache] Using cookie cached bot guild IDs");
      setMemoryCache(cacheKey, cookieCached);
      return new Set(cookieCached);
    }
  }

  // Fetch from Discord API
  try {
    log.debug("[Guilds Cache] Fetching bot guilds from Discord API");
    const response = await fetchWithTimeout(
      "https://discord.com/api/v10/users/@me/guilds",
      {
        headers: {
          Authorization: `Bot ${botToken}`,
        },
      },
    );

    if (!response.ok) {
      log.error("[Guilds Cache] Failed to fetch bot guilds:", response.status);
      // Return stale cache data if available
      const staleData = getMemoryCache(cacheKey, true);
      if (staleData) {
        log.debug("[Guilds Cache] API failed, using stale bot guild IDs cache");
        return new Set(staleData);
      }
      return new Set();
    }

    const guilds = await response.json();
    const guildIds = guilds.map((g) => g.id);

    // Cache in memory
    setMemoryCache(cacheKey, guildIds);
    
    // Try to cache in cookie (store as array for JSON serialization)
    setCachedGuilds(cookies, "bot_guild_ids", guildIds);

    return new Set(guildIds);
  } catch (error) {
    log.error("[Guilds Cache] Error fetching bot guilds:", error);
    // Return stale cache data if available
    const staleData = getMemoryCache(cacheKey, true);
    if (staleData) {
      log.debug("[Guilds Cache] API error, using stale bot guild IDs cache");
      return new Set(staleData);
    }
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
    const response = await fetchWithTimeout(
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
    log.debug("[verifyGuildAdmin] Missing accessToken or guildId");
    return { authorized: false, error: "Unauthorized" };
  }

  // Check for dev auth bypass - allow any request in dev mode with bypass enabled
  const isDev = typeof process !== "undefined" &&
    process.env?.NODE_ENV !== "production";
  const devAuthEnabled = isDev && process.env?.DEV_AUTH_BYPASS === "true";

  if (devAuthEnabled) {
    log.debug(
      "[verifyGuildAdmin] DEV MODE - bypassing auth check for guild:",
      guildId,
    );
    // In dev mode with bypass enabled, allow access to any guild
    return {
      authorized: true,
      guild: {
        id: guildId,
        name: "Dev Server",
        permissions: "2147483647",
      },
    };
  }

  try {
    const guilds = await getUserGuilds(accessToken, cookies);
    log.debug(
      "[verifyGuildAdmin] getUserGuilds returned",
      guilds.length,
      "guilds, looking for",
      guildId,
    );
    const guild = guilds.find((g) => g.id === guildId);

    if (!guild) {
      log.debug(
        "[verifyGuildAdmin] Guild not found in user guilds. Available guild IDs:",
        guilds.map((g) => g.id),
      );
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
    const userResponse = await fetchWithTimeout("https://discord.com/api/users/@me", {
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
 * Check if user has full Administrator permission for a guild
 * @param {object} guild - Guild object with permissions
 * @returns {boolean} - True if user has ADMINISTRATOR permission or is owner
 */
export function hasFullAdminPermission(guild) {
  if (!guild) return false;
  if (guild.owner) return true;
  
  const permissions = BigInt(guild.permissions || 0);
  return (permissions & ADMINISTRATOR) !== 0n;
}

/**
 * Invalidate all guild caches (call after bot install/uninstall)
 * @param {import('@sveltejs/kit').Cookies} cookies - SvelteKit cookies
 */
export function invalidateGuildCache(cookies) {
  log.debug("[Guilds Cache] Invalidating all guild caches");
  
  // Clear cookie caches
  cookies.delete("cached_user_guilds", { path: "/" });
  cookies.delete("cached_bot_guild_ids", { path: "/" });
  cookies.delete("cached_bot_guilds_details", { path: "/" });
  
  // Clear in-memory cache entirely to ensure fresh data on next request
  memoryCache.clear();
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

  // Skip caching if data is too large (cookies have ~4KB limit per cookie)
  // This is expected for users with many guilds - in-memory cache handles it
  const MAX_COOKIE_SIZE = 3500; // Leave room for cookie metadata
  if (cacheValue.length > MAX_COOKIE_SIZE) {
    log.debug(`[Guilds Cache] Data too large for cookie (${cacheValue.length} bytes), using in-memory cache only for ${key}`);
    return;
  }

  // Only use secure cookies in production
  const isProduction = typeof process !== "undefined" &&
    process.env?.NODE_ENV === "production";

  cookies.set(`cached_${key}`, cacheValue, {
    path: "/",
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge: CACHE_TTL,
  });
}
