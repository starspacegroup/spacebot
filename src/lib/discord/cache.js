/**
 * Discord Data Cache
 * Caches channels and roles per guild with 15-minute expiration
 */

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * @typedef {Object} CacheEntry
 * @property {any} data - The cached data
 * @property {number} timestamp - When the data was cached
 */

/** @type {Map<string, CacheEntry>} */
const channelCache = new Map();

/** @type {Map<string, CacheEntry>} */
const roleCache = new Map();

/**
 * Check if a cache entry is still valid
 * @param {CacheEntry | undefined} entry
 * @returns {boolean}
 */
function isValid(entry) {
  if (!entry) return false;
  return Date.now() - entry.timestamp < CACHE_TTL_MS;
}

/**
 * Get cached channels for a guild
 * @param {string} guildId
 * @returns {any[] | null} - Cached channels or null if not cached/expired
 */
export function getCachedChannels(guildId) {
  const entry = channelCache.get(guildId);
  if (isValid(entry)) {
    return entry.data;
  }
  return null;
}

/**
 * Set cached channels for a guild
 * @param {string} guildId
 * @param {any[]} channels
 */
export function setCachedChannels(guildId, channels) {
  channelCache.set(guildId, {
    data: channels,
    timestamp: Date.now(),
  });
}

/**
 * Get cached roles for a guild
 * @param {string} guildId
 * @returns {any[] | null} - Cached roles or null if not cached/expired
 */
export function getCachedRoles(guildId) {
  const entry = roleCache.get(guildId);
  if (isValid(entry)) {
    return entry.data;
  }
  return null;
}

/**
 * Set cached roles for a guild
 * @param {string} guildId
 * @param {any[]} roles
 */
export function setCachedRoles(guildId, roles) {
  roleCache.set(guildId, {
    data: roles,
    timestamp: Date.now(),
  });
}

/**
 * Clear all cache for a guild
 * @param {string} guildId
 */
export function clearGuildCache(guildId) {
  channelCache.delete(guildId);
  roleCache.delete(guildId);
}

/**
 * Force refresh channels - clears cache and fetches fresh data
 * @param {string} guildId
 */
export function invalidateChannels(guildId) {
  channelCache.delete(guildId);
}

/**
 * Force refresh roles - clears cache and fetches fresh data
 * @param {string} guildId
 */
export function invalidateRoles(guildId) {
  roleCache.delete(guildId);
}

/**
 * Fetch channels with caching
 * @param {string} guildId
 * @param {string} [typeFilter='sendable']
 * @returns {Promise<any[]>}
 */
export async function fetchChannelsWithCache(guildId, typeFilter = "sendable") {
  console.log("[Cache] fetchChannelsWithCache called for guild:", guildId);

  // Check cache first
  const cached = getCachedChannels(guildId);
  if (cached !== null) {
    console.log("[Cache] Returning cached channels:", cached.length);
    return cached;
  }

  // Fetch from API
  console.log("[Cache] Cache miss, fetching from API...");
  try {
    const url = `/api/discord/guilds/${guildId}/channels?type=${typeFilter}`;
    console.log("[Cache] Fetching:", url);
    const response = await fetch(url);
    console.log("[Cache] Response status:", response.status, response.ok);
    if (response.ok) {
      const result = await response.json();
      console.log("[Cache] API result:", result);
      const channels = result.channels || [];
      setCachedChannels(guildId, channels);
      return channels;
    } else {
      const errorText = await response.text();
      console.error("[Cache] API error response:", errorText);
    }
  } catch (err) {
    console.error("[Cache] Error fetching channels:", err);
  }

  return [];
}

/**
 * Fetch roles with caching
 * @param {string} guildId
 * @returns {Promise<any[]>}
 */
export async function fetchRolesWithCache(guildId) {
  console.log("[Cache] fetchRolesWithCache called for guild:", guildId);

  // Check cache first
  const cached = getCachedRoles(guildId);
  if (cached !== null) {
    console.log("[Cache] Returning cached roles:", cached.length);
    return cached;
  }

  // Fetch from API
  console.log("[Cache] Cache miss, fetching roles from API...");
  try {
    const response = await fetch(`/api/discord/guilds/${guildId}/roles`);
    if (response.ok) {
      const result = await response.json();
      const roles = result.roles || [];
      setCachedRoles(guildId, roles);
      return roles;
    }
  } catch (err) {
    console.error("[Cache] Error fetching roles:", err);
  }

  return [];
}
