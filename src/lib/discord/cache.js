/**
 * Discord Data Cache
 * Caches channels and roles per guild with 15-minute expiration
 */

import { log } from "$lib/log.js";

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

/** @type {Map<string, CacheEntry>} */
const emojiCache = new Map();

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
  emojiCache.delete(guildId);
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
 * Force refresh emojis - clears cache and fetches fresh data
 * @param {string} guildId
 */
export function invalidateEmojis(guildId) {
  emojiCache.delete(guildId);
}

/**
 * Get cached emojis for a guild
 * @param {string} guildId
 * @returns {any[] | null} - Cached emojis or null if not cached/expired
 */
export function getCachedEmojis(guildId) {
  const entry = emojiCache.get(guildId);
  if (isValid(entry)) {
    return entry.data;
  }
  return null;
}

/**
 * Set cached emojis for a guild
 * @param {string} guildId
 * @param {any[]} emojis
 */
export function setCachedEmojis(guildId, emojis) {
  emojiCache.set(guildId, {
    data: emojis,
    timestamp: Date.now(),
  });
}

/**
 * Fetch channels with caching
 * @param {string} guildId
 * @param {string} [typeFilter='sendable']
 * @returns {Promise<any[]>}
 */
export async function fetchChannelsWithCache(guildId, typeFilter = "sendable") {
  log.debug("[Cache] fetchChannelsWithCache called for guild:", guildId);

  // Check cache first
  const cached = getCachedChannels(guildId);
  if (cached !== null) {
    log.debug("[Cache] Returning cached channels:", cached.length);
    return cached;
  }

  // Fetch from API
  log.debug("[Cache] Cache miss, fetching from API...");
  try {
    const url = `/api/discord/guilds/${guildId}/channels?type=${typeFilter}`;
    log.debug("[Cache] Fetching:", url);
    const response = await fetch(url);
    log.debug("[Cache] Response status:", response.status, response.ok);
    if (response.ok) {
      const result = await response.json();
      log.debug("[Cache] API result:", result);
      const channels = result.channels || [];
      setCachedChannels(guildId, channels);
      return channels;
    } else {
      const errorText = await response.text();
      log.error("[Cache] API error response:", errorText);
    }
  } catch (err) {
    log.error("[Cache] Error fetching channels:", err);
  }

  return [];
}

/**
 * Fetch roles with caching
 * @param {string} guildId
 * @returns {Promise<any[]>}
 */
export async function fetchRolesWithCache(guildId) {
  log.debug("[Cache] fetchRolesWithCache called for guild:", guildId);

  // Check cache first
  const cached = getCachedRoles(guildId);
  if (cached !== null) {
    log.debug("[Cache] Returning cached roles:", cached.length);
    return cached;
  }

  // Fetch from API
  log.debug("[Cache] Cache miss, fetching roles from API...");
  try {
    const response = await fetch(`/api/discord/guilds/${guildId}/roles`);
    if (response.ok) {
      const result = await response.json();
      const roles = result.roles || [];
      setCachedRoles(guildId, roles);
      return roles;
    }
  } catch (err) {
    log.error("[Cache] Error fetching roles:", err);
  }

  return [];
}

/**
 * Fetch emojis with caching
 * @param {string} guildId
 * @returns {Promise<any[]>}
 */
export async function fetchEmojisWithCache(guildId) {
  log.debug("[Cache] fetchEmojisWithCache called for guild:", guildId);

  // Check cache first
  const cached = getCachedEmojis(guildId);
  if (cached !== null) {
    log.debug("[Cache] Returning cached emojis:", cached.length);
    return cached;
  }

  // Fetch from API
  log.debug("[Cache] Cache miss, fetching emojis from API...");
  try {
    const response = await fetch(`/api/discord/guilds/${guildId}/emojis`);
    if (response.ok) {
      const result = await response.json();
      const emojis = result.emojis || [];
      setCachedEmojis(guildId, emojis);
      return emojis;
    }
  } catch (err) {
    log.error("[Cache] Error fetching emojis:", err);
  }

  return [];
}
