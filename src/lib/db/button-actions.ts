/**
 * Button action sets database functions
 * Handles CRUD operations for button action sets and click logging
 */

import { log } from "../log.js";

/**
 * Create a new button action set
 * @param {D1Database} db
 * @param {Object} buttonSet
 * @returns {Promise<{success: boolean, id?: number, error?: string}>}
 */
export async function createButtonActionSet(db, buttonSet) {
  if (!db) return { success: false, error: "Database not available" };

  try {
    const result = await db.prepare(`
      INSERT INTO button_action_sets (guild_id, name, description, buttons, row_count, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      buttonSet.guild_id,
      buttonSet.name,
      buttonSet.description || null,
      JSON.stringify(buttonSet.buttons || []),
      buttonSet.row_count || 1,
      buttonSet.created_by || null,
    ).run();

    return { success: true, id: result.meta?.last_row_id };
  } catch (error) {
    log.error("Failed to create button action set:", error);
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Get all button action sets for a guild
 * @param {D1Database} db
 * @param {string} guildId
 * @returns {Promise<Array>}
 */
export async function getButtonActionSets(db, guildId) {
  if (!db) return [];

  try {
    const { results } = await db.prepare(
      "SELECT * FROM button_action_sets WHERE guild_id = ? ORDER BY created_at DESC"
    ).bind(guildId).all();

    return results.map(parseButtonSet);
  } catch (error) {
    log.error("Failed to get button action sets:", error);
    return [];
  }
}

/**
 * Get a single button action set
 * @param {D1Database} db
 * @param {number} id
 * @param {string} guildId
 * @returns {Promise<Object|null>}
 */
export async function getButtonActionSet(db, id, guildId) {
  if (!db) return null;

  try {
    const result = await db.prepare(
      "SELECT * FROM button_action_sets WHERE id = ? AND guild_id = ?"
    ).bind(id, guildId).first();

    return result ? parseButtonSet(result) : null;
  } catch (error) {
    log.error("Failed to get button action set:", error);
    return null;
  }
}

/**
 * Update a button action set
 * @param {D1Database} db
 * @param {number} id
 * @param {string} guildId
 * @param {Object} updates
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function updateButtonActionSet(db, id, guildId, updates) {
  if (!db) return { success: false, error: "Database not available" };

  try {
    const fields = [];
    const values = [];

    if (updates.name !== undefined) {
      fields.push("name = ?");
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      fields.push("description = ?");
      values.push(updates.description);
    }
    if (updates.buttons !== undefined) {
      fields.push("buttons = ?");
      values.push(JSON.stringify(updates.buttons));
    }
    if (updates.row_count !== undefined) {
      fields.push("row_count = ?");
      values.push(updates.row_count);
    }

    if (fields.length === 0) return { success: true };

    fields.push("updated_at = CURRENT_TIMESTAMP");
    values.push(id, guildId);

    await db.prepare(`
      UPDATE button_action_sets SET ${fields.join(", ")} WHERE id = ? AND guild_id = ?
    `).bind(...values).run();

    return { success: true };
  } catch (error) {
    log.error("Failed to update button action set:", error);
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Delete a button action set
 * @param {D1Database} db
 * @param {number} id
 * @param {string} guildId
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deleteButtonActionSet(db, id, guildId) {
  if (!db) return { success: false, error: "Database not available" };

  try {
    await db.prepare(
      "DELETE FROM button_action_sets WHERE id = ? AND guild_id = ?"
    ).bind(id, guildId).run();

    return { success: true };
  } catch (error) {
    log.error("Failed to delete button action set:", error);
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Find button actions by custom_id
 * Parses the custom_id format: sb_{guildId}_{sourceId}_{buttonId}
 * Then looks up the button's actions from the source (automation or command)
 * @param {D1Database} db
 * @param {string} customId - The button's custom_id
 * @param {string} guildId - Guild ID for validation
 * @returns {Promise<{actions: Array, buttonLabel: string, sourceId: string, sourceName: string}|null>}
 */
export async function findButtonActions(db, customId, guildId) {
  if (!db || !customId) return null;

  // Parse custom_id: sb_{guildId}_{sourceId}_{buttonId}
  const parts = customId.split("_");
  if (parts.length < 4 || parts[0] !== "sb") return null;

  const sourceGuildId = parts[1];
  const sourceId = parts[2];
  const buttonId = parts.slice(3).join("_"); // Button ID may contain underscores

  // Validate guild ID matches
  if (sourceGuildId !== guildId) return null;

  try {
    // Look in automations first
    const automation = await db.prepare(
      "SELECT * FROM automations WHERE id = ? AND guild_id = ?"
    ).bind(parseInt(sourceId), guildId).first();

    if (automation) {
      const actionConfig = automation.action_config ? JSON.parse(automation.action_config) : {};
      return findButtonInActionConfig(actionConfig, buttonId, sourceId, automation.name);
    }

    // Fall back to commands
    const command = await db.prepare(
      "SELECT * FROM commands WHERE id = ? AND guild_id = ?"
    ).bind(parseInt(sourceId), guildId).first();

    if (command) {
      const actionConfig = command.action_config ? JSON.parse(command.action_config) : {};
      return findButtonInActionConfig(actionConfig, buttonId, sourceId, command.name);
    }

    return null;
  } catch (error) {
    log.error("Failed to find button actions:", error);
    return null;
  }
}

/**
 * Search for a button definition within an action config's actions array
 * @param {Object} actionConfig - The action_config JSON
 * @param {string} buttonId - The button ID to find
 * @param {string} sourceId - Source automation/command ID
 * @param {string} sourceName - Source name
 * @returns {Object|null}
 */
function findButtonInActionConfig(actionConfig, buttonId, sourceId, sourceName) {
  const actions = actionConfig.actions || [];

  for (const action of actions) {
    if (action.type === "SEND_MESSAGE_WITH_BUTTONS" && action.config?.buttons) {
      const rows = Array.isArray(action.config.buttons[0])
        ? action.config.buttons
        : [action.config.buttons];

      for (const row of rows) {
        for (const btn of row) {
          const btnId = btn.id || btn.label?.replace(/\s+/g, '_').toLowerCase();
          if (btnId === buttonId) {
            return {
              actions: btn.actions || [],
              buttonLabel: btn.label,
              sourceId,
              sourceName,
            };
          }
        }
      }
    }
  }

  // Also check if the action_config itself is a SEND_MESSAGE_WITH_BUTTONS
  if (actionConfig.buttons) {
    const rows = Array.isArray(actionConfig.buttons[0])
      ? actionConfig.buttons
      : [actionConfig.buttons];

    for (const row of rows) {
      for (const btn of row) {
        const btnId = btn.id || btn.label?.replace(/\s+/g, '_').toLowerCase();
        if (btnId === buttonId) {
          return {
            actions: btn.actions || [],
            buttonLabel: btn.label,
            sourceId,
            sourceName,
          };
        }
      }
    }
  }

  return null;
}

/**
 * Log a button click execution
 * @param {D1Database} db
 * @param {Object} logEntry
 */
export async function logButtonClick(db, logEntry) {
  if (!db) return;

  try {
    await db.prepare(`
      INSERT INTO button_click_logs (
        guild_id, button_set_id, button_id, user_id, user_name,
        channel_id, message_id, actions_executed, success, error_message, execution_time_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      logEntry.guild_id,
      logEntry.button_set_id || null,
      logEntry.button_id,
      logEntry.user_id,
      logEntry.user_name || null,
      logEntry.channel_id || null,
      logEntry.message_id || null,
      logEntry.actions_executed ? JSON.stringify(logEntry.actions_executed) : null,
      logEntry.success ? 1 : 0,
      logEntry.error_message || null,
      logEntry.execution_time_ms || null,
    ).run();
  } catch (error) {
    log.error("Failed to log button click:", error);
  }
}

/**
 * Parse button set from database row
 */
function parseButtonSet(row) {
  return {
    ...row,
    buttons: row.buttons ? JSON.parse(row.buttons) : [],
  };
}
