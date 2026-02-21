/**
 * Integration Authentication
 *
 * Validates integration tokens from external projects communicating with SpaceBot.
 * Integration tokens use the format: sbi_<slug>_<random>
 *
 * This is separate from the API key system (sb_live_...) which is scoped to guilds.
 * Integration tokens are scoped to an integration and work across all guilds.
 */

import { log } from "../log.js";

/**
 * @typedef {Object} IntegrationAuthResult
 * @property {boolean} authenticated
 * @property {number} [integrationId] - The integration record ID
 * @property {string} [slug] - The integration slug
 * @property {string} [error] - Error message if not authenticated
 * @property {number} [status] - HTTP status code for error responses
 */

/**
 * Authenticate a request using an integration token.
 * Supports: `Authorization: Bearer sbi_<slug>_<random>`
 *
 * @param {Request} request - The incoming request
 * @param {object} platform - SvelteKit platform object (for DB access)
 * @returns {Promise<IntegrationAuthResult>}
 */
export async function authenticateIntegration(request, platform) {
  const authHeader = request.headers.get("Authorization");

  if (!authHeader) {
    return { authenticated: false, error: "Missing Authorization header", status: 401 };
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return {
      authenticated: false,
      error: "Invalid Authorization header format. Use: Bearer <integration_token>",
      status: 401,
    };
  }

  const token = parts[1];

  if (!token.startsWith("sbi_")) {
    return { authenticated: false, error: "Invalid integration token format", status: 401 };
  }

  const db = platform?.env?.DB;
  if (!db) {
    log.error("[IntegrationAuth] Database not available");
    return { authenticated: false, error: "Service unavailable", status: 503 };
  }

  try {
    const row = await db
      .prepare("SELECT id, slug, name, status FROM integrations WHERE token = ?")
      .bind(token)
      .first();

    if (!row) {
      return { authenticated: false, error: "Invalid integration token", status: 401 };
    }

    log.debug(`[IntegrationAuth] Authenticated integration: ${row.slug}`);

    return {
      authenticated: true,
      integrationId: row.id,
      slug: row.slug,
      name: row.name,
    };
  } catch (error) {
    log.error("[IntegrationAuth] Error validating token:", error);
    return { authenticated: false, error: "Authentication error", status: 500 };
  }
}

/**
 * Generate a new integration token.
 * Format: sbi_<slug>_<random 32 chars>
 *
 * @param {string} slug - The integration slug
 * @returns {string}
 */
export function generateIntegrationToken(slug) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const randomValues = new Uint8Array(32);

  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(randomValues);
  } else {
    for (let i = 0; i < 32; i++) {
      randomValues[i] = Math.floor(Math.random() * 256);
    }
  }

  let random = "";
  for (let i = 0; i < 32; i++) {
    random += chars[randomValues[i] % chars.length];
  }

  return `sbi_${slug}_${random}`;
}
