/**
 * Guild metadata database functions
 *
 * Stores and retrieves comprehensive guild profile data fetched via the bot token.
 * Updated by the daily cron job so the dashboard always has fresh server info
 * (name, icon, banner, description, features, boost level, etc.).
 */

import { log } from "../log.js";

/**
 * @typedef {Object} GuildMetadata
 * @property {string} guild_id
 * @property {string} name
 * @property {string|null} icon
 * @property {string|null} banner
 * @property {string|null} splash
 * @property {string|null} discovery_splash
 * @property {string|null} description
 * @property {string|null} owner_id
 * @property {string|null} vanity_url_code
 * @property {string|null} preferred_locale
 * @property {number} verification_level
 * @property {number} explicit_content_filter
 * @property {number} nsfw_level
 * @property {number} mfa_level
 * @property {number} default_message_notifications
 * @property {number} premium_tier
 * @property {number} premium_subscription_count
 * @property {number|null} approximate_member_count
 * @property {number|null} approximate_presence_count
 * @property {number|null} max_members
 * @property {number|null} max_presences
 * @property {string[]} features
 * @property {string|null} system_channel_id
 * @property {number} system_channel_flags
 * @property {string|null} rules_channel_id
 * @property {string|null} public_updates_channel_id
 * @property {string|null} safety_alerts_channel_id
 * @property {boolean} widget_enabled
 * @property {string|null} widget_channel_id
 * @property {string} fetched_at
 */

/**
 * Upsert guild metadata from a Discord API guild object.
 *
 * @param {D1Database} db
 * @param {Object} guild - The raw guild object from Discord's GET /guilds/{id}
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function upsertGuildMetadata(db, guild) {
  if (!db || !guild?.id) {
    return { success: false, error: "Missing database or guild data" };
  }

  try {
    await db.prepare(`
      INSERT INTO guild_metadata (
        guild_id, name, icon, banner, splash, discovery_splash, description,
        owner_id, vanity_url_code, preferred_locale,
        verification_level, explicit_content_filter, nsfw_level, mfa_level,
        default_message_notifications,
        premium_tier, premium_subscription_count,
        approximate_member_count, approximate_presence_count,
        max_members, max_presences,
        features,
        system_channel_id, system_channel_flags,
        rules_channel_id, public_updates_channel_id, safety_alerts_channel_id,
        widget_enabled, widget_channel_id,
        fetched_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?,
        ?, ?,
        ?, ?,
        ?, ?,
        ?,
        ?, ?,
        ?, ?, ?,
        ?, ?,
        datetime('now'), datetime('now')
      )
      ON CONFLICT(guild_id) DO UPDATE SET
        name = excluded.name,
        icon = excluded.icon,
        banner = excluded.banner,
        splash = excluded.splash,
        discovery_splash = excluded.discovery_splash,
        description = excluded.description,
        owner_id = excluded.owner_id,
        vanity_url_code = excluded.vanity_url_code,
        preferred_locale = excluded.preferred_locale,
        verification_level = excluded.verification_level,
        explicit_content_filter = excluded.explicit_content_filter,
        nsfw_level = excluded.nsfw_level,
        mfa_level = excluded.mfa_level,
        default_message_notifications = excluded.default_message_notifications,
        premium_tier = excluded.premium_tier,
        premium_subscription_count = excluded.premium_subscription_count,
        approximate_member_count = excluded.approximate_member_count,
        approximate_presence_count = excluded.approximate_presence_count,
        max_members = excluded.max_members,
        max_presences = excluded.max_presences,
        features = excluded.features,
        system_channel_id = excluded.system_channel_id,
        system_channel_flags = excluded.system_channel_flags,
        rules_channel_id = excluded.rules_channel_id,
        public_updates_channel_id = excluded.public_updates_channel_id,
        safety_alerts_channel_id = excluded.safety_alerts_channel_id,
        widget_enabled = excluded.widget_enabled,
        widget_channel_id = excluded.widget_channel_id,
        fetched_at = datetime('now'),
        updated_at = datetime('now')
    `).bind(
      guild.id,
      guild.name || "Unknown",
      guild.icon ?? null,
      guild.banner ?? null,
      guild.splash ?? null,
      guild.discovery_splash ?? null,
      guild.description ?? null,
      guild.owner_id ?? null,
      guild.vanity_url_code ?? null,
      guild.preferred_locale ?? null,
      guild.verification_level ?? 0,
      guild.explicit_content_filter ?? 0,
      guild.nsfw_level ?? 0,
      guild.mfa_level ?? 0,
      guild.default_message_notifications ?? 0,
      guild.premium_tier ?? 0,
      guild.premium_subscription_count ?? 0,
      guild.approximate_member_count ?? null,
      guild.approximate_presence_count ?? null,
      guild.max_members ?? null,
      guild.max_presences ?? null,
      JSON.stringify(guild.features || []),
      guild.system_channel_id ?? null,
      guild.system_channel_flags ?? 0,
      guild.rules_channel_id ?? null,
      guild.public_updates_channel_id ?? null,
      guild.safety_alerts_channel_id ?? null,
      guild.widget_enabled ? 1 : 0,
      guild.widget_channel_id ?? null,
    ).run();

    log.debug(`[GuildMetadata] Upserted metadata for ${guild.id} (${guild.name})`);
    return { success: true };
  } catch (error) {
    log.error(`[GuildMetadata] Failed to upsert for ${guild.id}:`, error);
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Get guild metadata from the database.
 *
 * @param {D1Database} db
 * @param {string} guildId
 * @returns {Promise<GuildMetadata|null>}
 */
export async function getGuildMetadata(db, guildId) {
  if (!db || !guildId) return null;

  try {
    const row = await db.prepare(
      "SELECT * FROM guild_metadata WHERE guild_id = ?"
    ).bind(guildId).first();

    if (!row) return null;

    return {
      ...row,
      features: parseJsonSafe(row.features, []),
      widget_enabled: Boolean(row.widget_enabled),
    };
  } catch (error) {
    log.error(`[GuildMetadata] Failed to get metadata for ${guildId}:`, error);
    return null;
  }
}

/**
 * Get guild metadata for multiple guilds.
 *
 * @param {D1Database} db
 * @param {string[]} guildIds
 * @returns {Promise<Map<string, GuildMetadata>>}
 */
export async function getGuildMetadataBatch(db, guildIds) {
  /** @type {Map<string, GuildMetadata>} */
  const results = new Map();
  if (!db || !guildIds?.length) return results;

  try {
    // D1 doesn't support array bindings, so batch in chunks
    const chunkSize = 20;
    for (let i = 0; i < guildIds.length; i += chunkSize) {
      const chunk = guildIds.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => "?").join(",");
      const rows = await db.prepare(
        `SELECT * FROM guild_metadata WHERE guild_id IN (${placeholders})`
      ).bind(...chunk).all();

      for (const row of rows.results || []) {
        results.set(row.guild_id, {
          ...row,
          features: parseJsonSafe(row.features, []),
          widget_enabled: Boolean(row.widget_enabled),
        });
      }
    }

    return results;
  } catch (error) {
    log.error("[GuildMetadata] Failed to batch get metadata:", error);
    return results;
  }
}

/**
 * Get all stored guild metadata (for superadmin overview).
 *
 * @param {D1Database} db
 * @returns {Promise<GuildMetadata[]>}
 */
export async function getAllGuildMetadata(db) {
  if (!db) return [];

  try {
    const result = await db.prepare(
      "SELECT * FROM guild_metadata ORDER BY name COLLATE NOCASE"
    ).all();

    return (result.results || []).map((row) => ({
      ...row,
      features: parseJsonSafe(row.features, []),
      widget_enabled: Boolean(row.widget_enabled),
    }));
  } catch (error) {
    log.error("[GuildMetadata] Failed to get all metadata:", error);
    return [];
  }
}

/**
 * Safely parse a JSON string, returning a fallback on error.
 * @param {string|null} str
 * @param {*} fallback
 * @returns {*}
 */
function parseJsonSafe(str, fallback) {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}
