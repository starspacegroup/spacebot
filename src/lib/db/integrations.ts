/**
 * Integrations Database Module
 *
 * Handles CRUD operations for integrations and guild-integration state in D1.
 * Also handles integration authentication tokens and heartbeat/status tracking.
 */

import { log } from "./logger.js";
import { generateIntegrationToken } from "../integrations/auth.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseJSON(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseIntegration(row) {
  if (!row) return null;
  return {
    ...row,
    is_official: !!row.is_official,
    manifest: parseJSON(row.manifest_json, null),
  };
}

function parseGuildIntegration(row) {
  if (!row) return null;
  return {
    ...row,
    enabled: !!row.enabled,
    config: parseJSON(row.config, {}),
  };
}

// ---------------------------------------------------------------------------
// Integration catalog (global)
// ---------------------------------------------------------------------------

/**
 * List all registered integrations.
 */
export async function listIntegrations(db) {
  if (!db) return [];
  try {
    const { results } = await db
      .prepare("SELECT * FROM integrations ORDER BY is_official DESC, name ASC")
      .all();
    return (results || []).map(parseIntegration);
  } catch (error) {
    log.error("[Integrations] Error listing integrations:", error);
    return [];
  }
}

/**
 * Get a single integration by slug.
 */
export async function getIntegrationBySlug(db, slug) {
  if (!db || !slug) return null;
  try {
    const row = await db
      .prepare("SELECT * FROM integrations WHERE slug = ?")
      .bind(slug)
      .first();
    return parseIntegration(row);
  } catch (error) {
    log.error("[Integrations] Error getting integration:", error);
    return null;
  }
}

/**
 * Get a single integration by id.
 */
export async function getIntegrationById(db, id) {
  if (!db || !id) return null;
  try {
    const row = await db
      .prepare("SELECT * FROM integrations WHERE id = ?")
      .bind(id)
      .first();
    return parseIntegration(row);
  } catch (error) {
    log.error("[Integrations] Error getting integration:", error);
    return null;
  }
}

/**
 * Upsert an integration by slug (used by the registry seeder).
 */
export async function upsertIntegration(db, data) {
  if (!db || !data?.slug) return { success: false, error: "Missing db or slug" };

  try {
    const existing = await db
      .prepare("SELECT id FROM integrations WHERE slug = ?")
      .bind(data.slug)
      .first();

    const now = new Date().toISOString();

    if (existing) {
      await db
        .prepare(`
          UPDATE integrations SET
            name = ?, description = ?, icon = ?, author = ?, version = ?,
            manifest_url = ?, manifest_json = ?, category = ?, is_official = ?,
            updated_at = ?
          WHERE slug = ?
        `)
        .bind(
          data.name,
          data.description || null,
          data.icon || null,
          data.author || null,
          data.version || "1.0.0",
          data.manifest_url || null,
          data.manifest_json ? JSON.stringify(data.manifest_json) : null,
          data.category || "general",
          data.is_official ? 1 : 0,
          now,
          data.slug,
        )
        .run();
      return { success: true, id: existing.id };
    }

    const result = await db
      .prepare(`
        INSERT INTO integrations (
          slug, name, description, icon, author, version,
          manifest_url, manifest_json, category, is_official,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        data.slug,
        data.name,
        data.description || null,
        data.icon || null,
        data.author || null,
        data.version || "1.0.0",
        data.manifest_url || null,
        data.manifest_json ? JSON.stringify(data.manifest_json) : null,
        data.category || "general",
        data.is_official ? 1 : 0,
        now,
        now,
      )
      .run();

    return { success: true, id: result.meta?.last_row_id };
  } catch (error) {
    log.error("[Integrations] Error upserting integration:", error);
    return { success: false, error: error.message };
  }
}

// ---------------------------------------------------------------------------
// Guild ↔ Integration state
// ---------------------------------------------------------------------------

/**
 * Get all integrations for a guild with their enabled state merged in.
 * Returns the full catalog with an `enabled` + `config` overlay per guild.
 */
export async function getGuildIntegrations(db, guildId) {
  if (!db || !guildId) return [];

  try {
    const { results } = await db
      .prepare(`
        SELECT
          i.*,
          gi.enabled AS guild_enabled,
          gi.config AS guild_config,
          gi.enabled_by,
          gi.enabled_at
        FROM integrations i
        LEFT JOIN guild_integrations gi
          ON gi.integration_id = i.id AND gi.guild_id = ?
        ORDER BY i.is_official DESC, i.name ASC
      `)
      .bind(guildId)
      .all();

    return (results || []).map((row) => ({
      ...parseIntegration(row),
      guild_enabled: !!row.guild_enabled,
      guild_config: parseJSON(row.guild_config, {}),
      enabled_by: row.enabled_by || null,
      enabled_at: row.enabled_at || null,
    }));
  } catch (error) {
    log.error("[Integrations] Error getting guild integrations:", error);
    return [];
  }
}

/**
 * Get only the enabled integrations for a guild.
 */
export async function getEnabledGuildIntegrations(db, guildId) {
  if (!db || !guildId) return [];

  try {
    const { results } = await db
      .prepare(`
        SELECT i.*, gi.config AS guild_config
        FROM integrations i
        INNER JOIN guild_integrations gi
          ON gi.integration_id = i.id AND gi.guild_id = ? AND gi.enabled = 1
        ORDER BY i.name ASC
      `)
      .bind(guildId)
      .all();

    return (results || []).map((row) => ({
      ...parseIntegration(row),
      guild_config: parseJSON(row.guild_config, {}),
    }));
  } catch (error) {
    log.error("[Integrations] Error getting enabled guild integrations:", error);
    return [];
  }
}

/**
 * Enable an integration for a guild.
 */
export async function enableGuildIntegration(db, guildId, integrationId, userId, config = {}) {
  if (!db || !guildId || !integrationId) {
    return { success: false, error: "Missing required parameters" };
  }

  try {
    const now = new Date().toISOString();

    // Upsert the guild_integrations row
    await db
      .prepare(`
        INSERT INTO guild_integrations (guild_id, integration_id, enabled, config, enabled_by, enabled_at, updated_at)
        VALUES (?, ?, 1, ?, ?, ?, ?)
        ON CONFLICT(guild_id, integration_id)
        DO UPDATE SET enabled = 1, config = ?, enabled_by = ?, enabled_at = ?, updated_at = ?
      `)
      .bind(
        guildId,
        integrationId,
        JSON.stringify(config),
        userId,
        now,
        now,
        // ON CONFLICT SET values
        JSON.stringify(config),
        userId,
        now,
        now,
      )
      .run();

    log.info(`[Integrations] Enabled integration ${integrationId} for guild ${guildId}`);
    return { success: true };
  } catch (error) {
    log.error("[Integrations] Error enabling integration:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Disable an integration for a guild (keeps the row for config persistence).
 */
export async function disableGuildIntegration(db, guildId, integrationId) {
  if (!db || !guildId || !integrationId) {
    return { success: false, error: "Missing required parameters" };
  }

  try {
    const now = new Date().toISOString();

    await db
      .prepare(`
        UPDATE guild_integrations
        SET enabled = 0, updated_at = ?
        WHERE guild_id = ? AND integration_id = ?
      `)
      .bind(now, guildId, integrationId)
      .run();

    log.info(`[Integrations] Disabled integration ${integrationId} for guild ${guildId}`);
    return { success: true };
  } catch (error) {
    log.error("[Integrations] Error disabling integration:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Update config for an enabled guild integration.
 */
export async function updateGuildIntegrationConfig(db, guildId, integrationId, config) {
  if (!db || !guildId || !integrationId) {
    return { success: false, error: "Missing required parameters" };
  }

  try {
    const now = new Date().toISOString();

    await db
      .prepare(`
        UPDATE guild_integrations
        SET config = ?, updated_at = ?
        WHERE guild_id = ? AND integration_id = ?
      `)
      .bind(JSON.stringify(config), now, guildId, integrationId)
      .run();

    log.info(`[Integrations] Updated config for integration ${integrationId} in guild ${guildId}`);
    return { success: true };
  } catch (error) {
    log.error("[Integrations] Error updating integration config:", error);
    return { success: false, error: error.message };
  }
}

// ---------------------------------------------------------------------------
// Integration tokens & status
// ---------------------------------------------------------------------------

/**
 * Generate and store a new token for an integration.
 * Replaces any existing token.
 *
 * @param {D1Database} db
 * @param {number} integrationId
 * @param {string} slug
 * @returns {Promise<{success: boolean, token?: string, error?: string}>}
 */
export async function createIntegrationToken(db, integrationId, slug) {
  if (!db || !integrationId || !slug) {
    return { success: false, error: "Missing required parameters" };
  }

  try {
    const token = generateIntegrationToken(slug);
    const now = new Date().toISOString();

    await db
      .prepare("UPDATE integrations SET token = ?, updated_at = ? WHERE id = ?")
      .bind(token, now, integrationId)
      .run();

    log.info(`[Integrations] Generated token for integration ${slug}`);
    return { success: true, token };
  } catch (error) {
    log.error("[Integrations] Error creating integration token:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Revoke (delete) an integration's token.
 */
export async function revokeIntegrationToken(db, integrationId) {
  if (!db || !integrationId) {
    return { success: false, error: "Missing required parameters" };
  }

  try {
    const now = new Date().toISOString();
    await db
      .prepare("UPDATE integrations SET token = NULL, updated_at = ? WHERE id = ?")
      .bind(now, integrationId)
      .run();

    log.info(`[Integrations] Revoked token for integration ${integrationId}`);
    return { success: true };
  } catch (error) {
    log.error("[Integrations] Error revoking integration token:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Record a heartbeat from an integration.
 * Updates last_heartbeat_at and sets status to 'online'.
 */
export async function recordHeartbeat(db, integrationId, metadata = {}) {
  if (!db || !integrationId) {
    return { success: false, error: "Missing required parameters" };
  }

  try {
    const now = new Date().toISOString();

    await db
      .prepare(`
        UPDATE integrations
        SET status = 'online', last_heartbeat_at = ?, updated_at = ?
        WHERE id = ?
      `)
      .bind(now, now, integrationId)
      .run();

    return { success: true, recorded_at: now };
  } catch (error) {
    log.error("[Integrations] Error recording heartbeat:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Update an integration's manifest via the sync API.
 * Called when an external project pushes its manifest to SpaceBot.
 *
 * @param {D1Database} db
 * @param {number} integrationId
 * @param {object} manifest - The full manifest object
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function updateIntegrationManifest(db, integrationId, manifest) {
  if (!db || !integrationId || !manifest) {
    return { success: false, error: "Missing required parameters" };
  }

  try {
    const now = new Date().toISOString();

    // Set connected_at on first sync (handshake)
    await db
      .prepare(`
        UPDATE integrations
        SET manifest_json = ?,
            version = ?,
            description = COALESCE(?, description),
            health_endpoint = ?,
            status = 'online',
            last_heartbeat_at = ?,
            connected_at = COALESCE(connected_at, ?),
            updated_at = ?
        WHERE id = ?
      `)
      .bind(
        JSON.stringify(manifest),
        manifest.version || "1.0.0",
        manifest.description || null,
        manifest.health_endpoint || null,
        now,
        now,
        now,
        integrationId,
      )
      .run();

    log.info(`[Integrations] Updated manifest for integration ${integrationId} (handshake complete)`);
    return { success: true };
  } catch (error) {
    log.error("[Integrations] Error updating manifest:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Get all guild IDs that have a specific integration enabled.
 * Used to re-sync Discord commands after a manifest update.
 */
export async function getGuildsWithIntegration(db, integrationId) {
  if (!db || !integrationId) return [];

  try {
    const { results } = await db
      .prepare(
        "SELECT guild_id FROM guild_integrations WHERE integration_id = ? AND enabled = 1",
      )
      .bind(integrationId)
      .all();

    return (results || []).map((r) => r.guild_id);
  } catch (error) {
    log.error("[Integrations] Error getting guilds with integration:", error);
    return [];
  }
}

/**
 * Get all guilds with a specific integration enabled, including their config.
 * Used by built-in integrations (e.g. GitHub) that need per-guild config.
 */
export async function getGuildsWithIntegrationConfig(db, integrationId) {
  if (!db || !integrationId) return [];

  try {
    const { results } = await db
      .prepare(
        "SELECT guild_id, config FROM guild_integrations WHERE integration_id = ? AND enabled = 1",
      )
      .bind(integrationId)
      .all();

    return (results || []).map((r) => ({
      guild_id: r.guild_id,
      config: parseJSON(r.config, {}),
    }));
  } catch (error) {
    log.error("[Integrations] Error getting guilds with integration config:", error);
    return [];
  }
}

/**
 * Mark stale integrations as offline.
 * Called periodically (e.g. via cron) to detect integrations that missed heartbeats.
 *
 * @param {D1Database} db
 * @param {number} staleMinutes - Minutes without heartbeat before marking offline (default: 5)
 */
export async function markStaleIntegrationsOffline(db, staleMinutes = 5) {
  if (!db) return { success: false, error: "No database" };

  try {
    const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    const result = await db
      .prepare(`
        UPDATE integrations
        SET status = 'offline', updated_at = ?
        WHERE status = 'online'
          AND last_heartbeat_at IS NOT NULL
          AND last_heartbeat_at < ?
      `)
      .bind(now, cutoff)
      .run();

    const changed = result.meta?.changes || 0;
    if (changed > 0) {
      log.info(`[Integrations] Marked ${changed} stale integration(s) as offline`);
    }

    return { success: true, marked_offline: changed };
  } catch (error) {
    log.error("[Integrations] Error marking stale integrations:", error);
    return { success: false, error: error.message };
  }
}
