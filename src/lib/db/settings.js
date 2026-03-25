/**
 * Server Settings Database Module
 * 
 * Handles CRUD operations for guild settings in the D1 database.
 */

import { log } from "./logger.js";

/**
 * Default settings for a new guild
 */
const DEFAULT_SETTINGS = {
  prefix: "!",
  logging_enabled: true,
  log_channel_id: null,
  moderation_role_id: null,
  excluded_channels: [],
  excluded_categories: [],
  log_embed_colors: {},
  timezone: null,
  permission_settings: {
    viewDashboard: { permission: "MANAGE_GUILD", roles: [] },
    viewLogs: { permission: "MANAGE_GUILD", roles: [] },
    manageAutomations: { permission: "MANAGE_GUILD", roles: [] },
    manageCommands: { permission: "MANAGE_GUILD", roles: [] },
    manageSettings: { permission: "ADMINISTRATOR", roles: [] },
  },
};

/**
 * Get settings for a guild
 * @param {D1Database} db - D1 database instance
 * @param {string} guildId - The guild ID
 * @returns {Promise<object>} - Guild settings object
 */
export async function getGuildSettings(db, guildId) {
  if (!db || !guildId) {
    log.warn("[Settings] Missing db or guildId");
    return { ...DEFAULT_SETTINGS };
  }

  try {
    const result = await db
      .prepare("SELECT * FROM guild_settings WHERE guild_id = ?")
      .bind(guildId)
      .first();

    if (!result) {
      log.debug("[Settings] No settings found for guild, returning defaults:", guildId);
      return { ...DEFAULT_SETTINGS };
    }

    // Parse JSON fields
    const settings = {
      prefix: result.prefix || DEFAULT_SETTINGS.prefix,
      logging_enabled: Boolean(result.logging_enabled),
      log_channel_id: result.log_channel_id || null,
      moderation_role_id: result.moderation_role_id || null,
      excluded_channels: parseJSON(result.excluded_channels, []),
      excluded_categories: parseJSON(result.excluded_categories, []),
      log_embed_colors: parseJSON(result.log_embed_colors, {}),
      timezone: result.timezone || null,
      permission_settings: parseJSON(result.permission_settings, DEFAULT_SETTINGS.permission_settings),
      created_at: result.created_at,
      updated_at: result.updated_at,
    };

    log.debug("[Settings] Loaded settings for guild:", guildId, settings);
    return settings;
  } catch (error) {
    log.error("[Settings] Error loading settings:", error);
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Save/update settings for a guild
 * @param {D1Database} db - D1 database instance
 * @param {string} guildId - The guild ID
 * @param {object} settings - Settings to save
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function saveGuildSettings(db, guildId, settings) {
  if (!db || !guildId) {
    return { success: false, error: "Missing database or guild ID" };
  }

  try {
    // Check if settings already exist
    const existing = await db
      .prepare("SELECT guild_id FROM guild_settings WHERE guild_id = ?")
      .bind(guildId)
      .first();

    const now = new Date().toISOString();

    if (existing) {
      // Update existing settings
      await db
        .prepare(`
          UPDATE guild_settings SET
            prefix = ?,
            logging_enabled = ?,
            log_channel_id = ?,
            moderation_role_id = ?,
            excluded_channels = ?,
            excluded_categories = ?,
            log_embed_colors = ?,
            timezone = ?,
            permission_settings = ?,
            updated_at = ?
          WHERE guild_id = ?
        `)
        .bind(
          settings.prefix || DEFAULT_SETTINGS.prefix,
          settings.logging_enabled ? 1 : 0,
          settings.log_channel_id || null,
          settings.moderation_role_id || null,
          JSON.stringify(settings.excluded_channels || []),
          JSON.stringify(settings.excluded_categories || []),
          JSON.stringify(settings.log_embed_colors || {}),
          settings.timezone || null,
          JSON.stringify(settings.permission_settings || DEFAULT_SETTINGS.permission_settings),
          now,
          guildId
        )
        .run();

      log.info("[Settings] Updated settings for guild:", guildId);
    } else {
      // Insert new settings
      await db
        .prepare(`
          INSERT INTO guild_settings (
            guild_id, prefix, logging_enabled, log_channel_id,
            moderation_role_id,
            excluded_channels, excluded_categories, log_embed_colors, timezone, permission_settings,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          guildId,
          settings.prefix || DEFAULT_SETTINGS.prefix,
          settings.logging_enabled ? 1 : 0,
          settings.log_channel_id || null,
          settings.moderation_role_id || null,
          JSON.stringify(settings.excluded_channels || []),
          JSON.stringify(settings.excluded_categories || []),
          JSON.stringify(settings.log_embed_colors || {}),
          settings.timezone || null,
          JSON.stringify(settings.permission_settings || DEFAULT_SETTINGS.permission_settings),
          now,
          now
        )
        .run();

      log.info("[Settings] Created settings for guild:", guildId);
    }

    return { success: true };
  } catch (error) {
    log.error("[Settings] Error saving settings:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Delete settings for a guild
 * @param {D1Database} db - D1 database instance
 * @param {string} guildId - The guild ID
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deleteGuildSettings(db, guildId) {
  if (!db || !guildId) {
    return { success: false, error: "Missing database or guild ID" };
  }

  try {
    await db
      .prepare("DELETE FROM guild_settings WHERE guild_id = ?")
      .bind(guildId)
      .run();

    log.info("[Settings] Deleted settings for guild:", guildId);
    return { success: true };
  } catch (error) {
    log.error("[Settings] Error deleting settings:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Helper to safely parse JSON with a fallback
 */
function parseJSON(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/**
 * Get just the timezone setting for a guild (lightweight query for layout)
 * @param {D1Database} db - D1 database instance
 * @param {string} guildId - The guild ID
 * @returns {Promise<string|null>} - IANA timezone name or null
 */
export async function getGuildTimezone(db, guildId) {
  if (!db || !guildId) return null;
  try {
    const result = await db
      .prepare("SELECT timezone FROM guild_settings WHERE guild_id = ?")
      .bind(guildId)
      .first();
    return result?.timezone || null;
  } catch {
    return null;
  }
}

export { DEFAULT_SETTINGS };
