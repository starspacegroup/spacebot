/**
 * API Key Authentication Middleware
 * 
 * Validates API keys from the Authorization header and provides
 * guild/scope context for API route handlers.
 * 
 * Usage in API routes:
 *   import { authenticateApiKey } from "$lib/api-auth.js";
 *   
 *   const auth = await authenticateApiKey(request, platform);
 *   if (!auth.authenticated) {
 *     return json({ error: auth.error }, { status: auth.status });
 *   }
 *   // auth.guildId, auth.scopes, auth.keyId available
 */

import { validateApiKey } from "./db/api-keys.js";
import { log } from "./db/logger.js";

/**
 * @typedef {Object} ApiAuthResult
 * @property {boolean} authenticated
 * @property {string} [guildId] - The guild this key is scoped to
 * @property {string[]} [scopes] - The scopes this key has
 * @property {number} [keyId] - The API key record ID
 * @property {string} [error] - Error message if not authenticated
 * @property {number} [status] - HTTP status code for error responses
 */

/**
 * Authenticate a request using an API key from the Authorization header.
 * Supports: `Authorization: Bearer sb_live_...`
 * 
 * @param {Request} request - The incoming request
 * @param {object} platform - SvelteKit platform object (for DB access)
 * @returns {Promise<ApiAuthResult>}
 */
export async function authenticateApiKey(request, platform) {
  const authHeader = request.headers.get("Authorization");

  if (!authHeader) {
    return { authenticated: false, error: "Missing Authorization header", status: 401 };
  }

  // Extract the token from "Bearer <token>"
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return { authenticated: false, error: "Invalid Authorization header format. Use: Bearer <api_key>", status: 401 };
  }

  const apiKey = parts[1];

  if (!apiKey.startsWith("sb_live_")) {
    return { authenticated: false, error: "Invalid API key format", status: 401 };
  }

  const db = platform?.env?.DB;
  if (!db) {
    log.error("[ApiAuth] Database not available");
    return { authenticated: false, error: "Service unavailable", status: 503 };
  }

  const result = await validateApiKey(db, apiKey);

  if (!result.valid) {
    log.debug("[ApiAuth] API key validation failed:", result.error);
    return { authenticated: false, error: result.error, status: 401 };
  }

  log.debug("[ApiAuth] API key authenticated for guild:", result.guildId, "scopes:", result.scopes);

  return {
    authenticated: true,
    guildId: result.guildId,
    scopes: result.scopes,
    keyId: result.keyId,
  };
}

/**
 * Check if an authenticated API key has the required scope
 * @param {ApiAuthResult} auth - The auth result from authenticateApiKey
 * @param {string} requiredScope - The scope to check (e.g. "logs:read")
 * @returns {boolean}
 */
export function hasScope(auth, requiredScope) {
  if (!auth.authenticated || !auth.scopes) return false;
  return auth.scopes.includes(requiredScope);
}

/**
 * Authenticate a request using either session cookies (admin UI) or API key (external).
 * Returns a unified auth result.
 * 
 * @param {Request} request - The incoming request
 * @param {import('@sveltejs/kit').Cookies} cookies - SvelteKit cookies
 * @param {object} platform - SvelteKit platform object
 * @returns {Promise<{method: 'session'|'apikey', userId?: string, guildId?: string, scopes?: string[], keyId?: number, authenticated: boolean, error?: string, status?: number}>}
 */
export async function authenticateRequest(request, cookies, platform) {
  // Check for API key first (external apps)
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer sb_live_")) {
    const result = await authenticateApiKey(request, platform);
    return { method: "apikey", ...result };
  }

  // Fall back to session cookie (admin UI)
  const userId = cookies.get("discord_user_id");
  if (userId) {
    return { method: "session", authenticated: true, userId };
  }

  return { method: "session", authenticated: false, error: "Not authenticated", status: 401 };
}
