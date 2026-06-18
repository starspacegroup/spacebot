/**
 * API Keys Database Module
 * 
 * Handles CRUD operations for API keys in the D1 database.
 * API keys allow external applications to authenticate with the SpaceBot API.
 * 
 * Security: Raw API keys are NEVER stored. We store a SHA-256 hash and a 
 * key prefix (first 8 chars) for identification purposes.
 */

import { log } from "./logger.js";

/**
 * @typedef {Object} ApiKey
 * @property {number} id
 * @property {string} guild_id
 * @property {string} name
 * @property {string} description
 * @property {string} key_prefix
 * @property {string} key_hash
 * @property {string[]} scopes
 * @property {string} created_by
 * @property {string|null} expires_at
 * @property {string|null} last_used_at
 * @property {boolean} revoked
 * @property {string} created_at
 * @property {string} updated_at
 */

/**
 * Available API key scopes
 */
export const API_KEY_SCOPES = {
  "logs:read": "Read event logs",
  "automations:read": "Read automations",
  "automations:write": "Create/update automations",
  "commands:read": "Read slash commands",
  "commands:write": "Create/update slash commands",
  "stats:read": "Read server statistics",
  "settings:read": "Read server settings",
  "webhooks:read": "Read webhooks",
};

/**
 * Generate a cryptographically secure API key
 * Format: sb_live_<32 random hex chars> (total ~40 chars)
 * @returns {string} The raw API key
 */
export function generateApiKey() {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  const hex = Array.from(randomBytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `sb_live_${hex}`;
}

/**
 * Hash an API key using SHA-256
 * @param {string} key - The raw API key
 * @returns {Promise<string>} The hex-encoded SHA-256 hash
 */
export async function hashApiKey(key) {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Get all API keys for a guild (without exposing hashes)
 * @param {D1Database} db - D1 database instance
 * @param {string} guildId - The guild ID
 * @returns {Promise<ApiKey[]>} Array of API keys (without key_hash)
 */
export async function getGuildApiKeys(db, guildId) {
  if (!db || !guildId) {
    log.warn("[ApiKeys] Missing db or guildId");
    return [];
  }

  try {
    const result = await db
      .prepare(
        "SELECT id, guild_id, name, description, key_prefix, scopes, created_by, expires_at, last_used_at, revoked, created_at, updated_at FROM api_keys WHERE guild_id = ? ORDER BY created_at DESC"
      )
      .bind(guildId)
      .all();

    return (result.results || []).map((row) => ({
      id: row.id,
      guild_id: row.guild_id,
      name: row.name,
      description: row.description || "",
      key_prefix: row.key_prefix,
      scopes: parseJSON(row.scopes, []),
      created_by: row.created_by,
      expires_at: row.expires_at,
      last_used_at: row.last_used_at,
      revoked: Boolean(row.revoked),
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  } catch (error) {
    log.error("[ApiKeys] Error loading API keys:", error);
    return [];
  }
}

/**
 * Create a new API key for a guild
 * @param {D1Database} db - D1 database instance
 * @param {string} guildId - The guild ID
 * @param {Object} keyData - API key data
 * @param {string} keyData.name - Key name
 * @param {string} [keyData.description] - Key description
 * @param {string[]} keyData.scopes - Array of scope strings
 * @param {string} keyData.created_by - User ID who created the key
 * @param {string} [keyData.expires_at] - Optional expiration date (ISO string)
 * @returns {Promise<{success: boolean, id?: number, rawKey?: string, error?: string}>}
 */
export async function createApiKey(db, guildId, keyData) {
  if (!db || !guildId) {
    return { success: false, error: "Missing database or guild ID" };
  }

  if (!keyData.name?.trim()) {
    return { success: false, error: "API key name is required" };
  }

  if (!keyData.scopes || keyData.scopes.length === 0) {
    return { success: false, error: "At least one scope is required" };
  }

  // Validate scopes
  const validScopes = Object.keys(API_KEY_SCOPES);
  const invalidScopes = keyData.scopes.filter((s) => !validScopes.includes(s));
  if (invalidScopes.length > 0) {
    return { success: false, error: `Invalid scopes: ${invalidScopes.join(", ")}` };
  }

  try {
    // Generate the raw API key
    const rawKey = generateApiKey();
    const keyPrefix = rawKey.substring(0, 16); // "sb_live_" + first 8 hex chars
    const keyHash = await hashApiKey(rawKey);

    const now = new Date().toISOString();

    const result = await db
      .prepare(
        `INSERT INTO api_keys (guild_id, name, description, key_prefix, key_hash, scopes, created_by, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        guildId,
        keyData.name.trim(),
        keyData.description?.trim() || "",
        keyPrefix,
        keyHash,
        JSON.stringify(keyData.scopes),
        keyData.created_by,
        keyData.expires_at || null,
        now,
        now
      )
      .run();

    log.info("[ApiKeys] Created API key for guild:", guildId, "name:", keyData.name);

    return {
      success: true,
      id: result.meta?.last_row_id,
      rawKey, // Return the raw key ONLY on creation - it can never be retrieved again
    };
  } catch (error) {
    log.error("[ApiKeys] Error creating API key:", error);

    if (error.message?.includes("UNIQUE constraint")) {
      return { success: false, error: "An API key with that name already exists" };
    }

    return { success: false, error: "Failed to create API key" };
  }
}

/**
 * Validate an API key and return the associated guild and scopes
 * @param {D1Database} db - D1 database instance
 * @param {string} rawKey - The raw API key to validate
 * @returns {Promise<{valid: boolean, guildId?: string, scopes?: string[], keyId?: number, error?: string}>}
 */
export async function validateApiKey(db, rawKey) {
  if (!db || !rawKey) {
    return { valid: false, error: "Missing database or API key" };
  }

  // Quick format check
  if (!rawKey.startsWith("sb_live_")) {
    return { valid: false, error: "Invalid API key format" };
  }

  try {
    const keyHash = await hashApiKey(rawKey);
    const keyPrefix = rawKey.substring(0, 16);

    // Look up by hash (prefix is used as a secondary check)
    const result = await db
      .prepare(
        "SELECT id, guild_id, scopes, expires_at, revoked FROM api_keys WHERE key_hash = ? AND key_prefix = ?"
      )
      .bind(keyHash, keyPrefix)
      .first();

    if (!result) {
      return { valid: false, error: "Invalid API key" };
    }

    if (result.revoked) {
      return { valid: false, error: "API key has been revoked" };
    }

    if (result.expires_at && new Date(result.expires_at) < new Date()) {
      return { valid: false, error: "API key has expired" };
    }

    // Update last_used_at timestamp (fire-and-forget, don't block the response)
    db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?")
      .bind(result.id)
      .run()
      .catch((err) => log.warn("[ApiKeys] Failed to update last_used_at:", err));

    return {
      valid: true,
      keyId: result.id,
      guildId: result.guild_id,
      scopes: parseJSON(result.scopes, []),
    };
  } catch (error) {
    log.error("[ApiKeys] Error validating API key:", error);
    return { valid: false, error: "Failed to validate API key" };
  }
}

/**
 * Revoke an API key
 * @param {D1Database} db - D1 database instance
 * @param {string} guildId - The guild ID (for access control)
 * @param {number} keyId - The API key ID to revoke
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function revokeApiKey(db, guildId, keyId) {
  if (!db || !guildId || !keyId) {
    return { success: false, error: "Missing required parameters" };
  }

  try {
    const result = await db
      .prepare(
        "UPDATE api_keys SET revoked = 1, updated_at = datetime('now') WHERE id = ? AND guild_id = ?"
      )
      .bind(keyId, guildId)
      .run();

    if (result.meta?.changes === 0) {
      return { success: false, error: "API key not found" };
    }

    log.info("[ApiKeys] Revoked API key:", keyId, "for guild:", guildId);
    return { success: true };
  } catch (error) {
    log.error("[ApiKeys] Error revoking API key:", error);
    return { success: false, error: "Failed to revoke API key" };
  }
}

/**
 * Delete an API key permanently
 * @param {D1Database} db - D1 database instance
 * @param {string} guildId - The guild ID (for access control)
 * @param {number} keyId - The API key ID to delete
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deleteApiKey(db, guildId, keyId) {
  if (!db || !guildId || !keyId) {
    return { success: false, error: "Missing required parameters" };
  }

  try {
    const result = await db
      .prepare("DELETE FROM api_keys WHERE id = ? AND guild_id = ?")
      .bind(keyId, guildId)
      .run();

    if (result.meta?.changes === 0) {
      return { success: false, error: "API key not found" };
    }

    log.info("[ApiKeys] Deleted API key:", keyId, "for guild:", guildId);
    return { success: true };
  } catch (error) {
    log.error("[ApiKeys] Error deleting API key:", error);
    return { success: false, error: "Failed to delete API key" };
  }
}

/**
 * Safely parse JSON with a fallback value
 * @param {string} value - JSON string
 * @param {*} fallback - Fallback value
 * @returns {*}
 */
function parseJSON(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
