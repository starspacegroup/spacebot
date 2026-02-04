/**
 * Webhooks Database Module
 * 
 * Handles CRUD operations for guild webhooks in the D1 database.
 * Webhooks can be used in automation and command actions.
 */

import { log } from "./logger.js";

/**
 * @typedef {Object} Webhook
 * @property {number} id
 * @property {string} guild_id
 * @property {string} name
 * @property {string} description
 * @property {string} url
 * @property {string} method
 * @property {Object} headers
 * @property {boolean} enabled
 * @property {string} created_by
 * @property {string} created_at
 * @property {string} updated_at
 */

/**
 * Get all webhooks for a guild
 * @param {D1Database} db - D1 database instance
 * @param {string} guildId - The guild ID
 * @returns {Promise<Webhook[]>} - Array of webhooks
 */
export async function getGuildWebhooks(db, guildId) {
  if (!db || !guildId) {
    log.warn("[Webhooks] Missing db or guildId");
    return [];
  }

  try {
    const result = await db
      .prepare("SELECT * FROM webhooks WHERE guild_id = ? ORDER BY name ASC")
      .bind(guildId)
      .all();

    const webhooks = (result.results || []).map((row) => ({
      id: row.id,
      guild_id: row.guild_id,
      name: row.name,
      description: row.description || "",
      url: row.url,
      method: row.method || "POST",
      headers: parseJSON(row.headers, {}),
      enabled: Boolean(row.enabled),
      created_by: row.created_by,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));

    log.debug("[Webhooks] Loaded webhooks for guild:", guildId, webhooks.length);
    return webhooks;
  } catch (error) {
    log.error("[Webhooks] Error loading webhooks:", error);
    return [];
  }
}

/**
 * Get a single webhook by ID
 * @param {D1Database} db - D1 database instance
 * @param {number} webhookId - The webhook ID
 * @param {string} guildId - The guild ID (for security validation)
 * @returns {Promise<Webhook|null>} - The webhook or null
 */
export async function getWebhook(db, webhookId, guildId) {
  if (!db || !webhookId) {
    return null;
  }

  try {
    const result = await db
      .prepare("SELECT * FROM webhooks WHERE id = ? AND guild_id = ?")
      .bind(webhookId, guildId)
      .first();

    if (!result) {
      return null;
    }

    return {
      id: result.id,
      guild_id: result.guild_id,
      name: result.name,
      description: result.description || "",
      url: result.url,
      method: result.method || "POST",
      headers: parseJSON(result.headers, {}),
      enabled: Boolean(result.enabled),
      created_by: result.created_by,
      created_at: result.created_at,
      updated_at: result.updated_at,
    };
  } catch (error) {
    log.error("[Webhooks] Error getting webhook:", error);
    return null;
  }
}

/**
 * Create a new webhook
 * @param {D1Database} db - D1 database instance
 * @param {string} guildId - The guild ID
 * @param {Object} webhook - The webhook data
 * @param {string} createdBy - User ID who created it
 * @returns {Promise<{success: boolean, id?: number, error?: string}>}
 */
export async function createWebhook(db, guildId, webhook, createdBy) {
  if (!db || !guildId) {
    return { success: false, error: "Missing database or guild ID" };
  }

  if (!webhook.name?.trim()) {
    return { success: false, error: "Webhook name is required" };
  }

  if (!webhook.url?.trim()) {
    return { success: false, error: "Webhook URL is required" };
  }

  // Validate URL format
  try {
    new URL(webhook.url);
  } catch {
    return { success: false, error: "Invalid URL format" };
  }

  // Validate method
  const validMethods = ["GET", "POST", "PUT", "PATCH", "DELETE"];
  const method = (webhook.method || "POST").toUpperCase();
  if (!validMethods.includes(method)) {
    return { success: false, error: "Invalid HTTP method" };
  }

  try {
    const now = new Date().toISOString();

    const result = await db
      .prepare(`
        INSERT INTO webhooks (guild_id, name, description, url, method, headers, enabled, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        guildId,
        webhook.name.trim(),
        webhook.description?.trim() || null,
        webhook.url.trim(),
        method,
        JSON.stringify(webhook.headers || {}),
        webhook.enabled !== false ? 1 : 0,
        createdBy,
        now,
        now
      )
      .run();

    log.info("[Webhooks] Created webhook for guild:", guildId, webhook.name);
    return { success: true, id: result.meta?.last_row_id };
  } catch (error) {
    // Check for unique constraint violation
    if (error.message?.includes("UNIQUE constraint failed")) {
      return { success: false, error: "A webhook with this name already exists" };
    }
    log.error("[Webhooks] Error creating webhook:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Update an existing webhook
 * @param {D1Database} db - D1 database instance
 * @param {number} webhookId - The webhook ID
 * @param {string} guildId - The guild ID (for security)
 * @param {Object} updates - The fields to update
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function updateWebhook(db, webhookId, guildId, updates) {
  if (!db || !webhookId || !guildId) {
    return { success: false, error: "Missing required parameters" };
  }

  // Validate URL if being updated
  if (updates.url !== undefined) {
    if (!updates.url?.trim()) {
      return { success: false, error: "Webhook URL is required" };
    }
    try {
      new URL(updates.url);
    } catch {
      return { success: false, error: "Invalid URL format" };
    }
  }

  // Validate method if being updated
  if (updates.method !== undefined) {
    const validMethods = ["GET", "POST", "PUT", "PATCH", "DELETE"];
    const method = (updates.method || "POST").toUpperCase();
    if (!validMethods.includes(method)) {
      return { success: false, error: "Invalid HTTP method" };
    }
  }

  try {
    // Build dynamic update query
    const fields = [];
    const values = [];

    if (updates.name !== undefined) {
      if (!updates.name?.trim()) {
        return { success: false, error: "Webhook name is required" };
      }
      fields.push("name = ?");
      values.push(updates.name.trim());
    }

    if (updates.description !== undefined) {
      fields.push("description = ?");
      values.push(updates.description?.trim() || null);
    }

    if (updates.url !== undefined) {
      fields.push("url = ?");
      values.push(updates.url.trim());
    }

    if (updates.method !== undefined) {
      fields.push("method = ?");
      values.push(updates.method.toUpperCase());
    }

    if (updates.headers !== undefined) {
      fields.push("headers = ?");
      values.push(JSON.stringify(updates.headers || {}));
    }

    if (updates.enabled !== undefined) {
      fields.push("enabled = ?");
      values.push(updates.enabled ? 1 : 0);
    }

    if (fields.length === 0) {
      return { success: true }; // Nothing to update
    }

    fields.push("updated_at = ?");
    values.push(new Date().toISOString());

    // Add WHERE clause values
    values.push(webhookId, guildId);

    await db
      .prepare(`UPDATE webhooks SET ${fields.join(", ")} WHERE id = ? AND guild_id = ?`)
      .bind(...values)
      .run();

    log.info("[Webhooks] Updated webhook:", webhookId);
    return { success: true };
  } catch (error) {
    if (error.message?.includes("UNIQUE constraint failed")) {
      return { success: false, error: "A webhook with this name already exists" };
    }
    log.error("[Webhooks] Error updating webhook:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Delete a webhook
 * @param {D1Database} db - D1 database instance
 * @param {number} webhookId - The webhook ID
 * @param {string} guildId - The guild ID (for security)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deleteWebhook(db, webhookId, guildId) {
  if (!db || !webhookId || !guildId) {
    return { success: false, error: "Missing required parameters" };
  }

  try {
    await db
      .prepare("DELETE FROM webhooks WHERE id = ? AND guild_id = ?")
      .bind(webhookId, guildId)
      .run();

    log.info("[Webhooks] Deleted webhook:", webhookId);
    return { success: true };
  } catch (error) {
    log.error("[Webhooks] Error deleting webhook:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Call a webhook
 * @param {Webhook} webhook - The webhook configuration
 * @param {Object} payload - The data to send
 * @returns {Promise<{success: boolean, status?: number, response?: any, error?: string}>}
 */
export async function callWebhook(webhook, payload) {
  if (!webhook?.url) {
    return { success: false, error: "Invalid webhook configuration" };
  }

  if (!webhook.enabled) {
    return { success: false, error: "Webhook is disabled" };
  }

  try {
    const headers = {
      "Content-Type": "application/json",
      "User-Agent": "SpaceBot/1.0",
      ...webhook.headers,
    };

    const options = {
      method: webhook.method || "POST",
      headers,
    };

    // Only include body for methods that support it
    if (["POST", "PUT", "PATCH"].includes(options.method)) {
      options.body = JSON.stringify(payload);
    }

    const response = await fetch(webhook.url, options);

    let responseData = null;
    const contentType = response.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      try {
        responseData = await response.json();
      } catch {
        responseData = await response.text();
      }
    } else {
      responseData = await response.text();
    }

    log.info("[Webhooks] Called webhook:", webhook.name, "Status:", response.status);

    return {
      success: response.ok,
      status: response.status,
      response: responseData,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (error) {
    log.error("[Webhooks] Error calling webhook:", webhook.name, error);
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
