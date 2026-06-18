/**
 * Import/Export utilities for automations and commands.
 * Handles detection and clearing of server-specific references
 * (channel IDs, role IDs, user IDs, webhook IDs) so configs are
 * portable between different Discord servers.
 */

import { ACTION_TYPES, FILTER_TYPES } from "./db/automations.js";

// ── Schema-derived field type classification ──────────────────────

/**
 * Config field types that contain server-specific Discord snowflake IDs.
 * Derived from ACTION_TYPES[*].configSchema[*].type
 */
const SERVER_SPECIFIC_FIELD_TYPES = new Set([
  "channel",        // single channel ID
  "channel_multi",  // comma-sep channel IDs or "ALL"
  "roles",          // array of role IDs
  "webhook",        // webhook ID
  "bot_selector",   // bot user ID
  "emoji",          // may be a custom server emoji
]);

/**
 * Filter types (from FILTER_TYPES) that hold server-specific IDs.
 */
const SERVER_SPECIFIC_FILTER_TYPES = new Set([
  "channel",
  "role",
  "user",
  "bot_selector",
]);

/**
 * Build a lookup: configFieldName → { schemaType, label }
 * across all known action types.
 */
function buildConfigFieldLookup() {
  const lookup = {};
  for (const [, actionDef] of Object.entries(ACTION_TYPES)) {
    if (!actionDef.configSchema) continue;
    for (const [fieldName, fieldDef] of Object.entries(actionDef.configSchema)) {
      if (SERVER_SPECIFIC_FIELD_TYPES.has(fieldDef.type)) {
        lookup[fieldName] = {
          schemaType: fieldDef.type,
          label: fieldDef.label || fieldName,
        };
      }
    }
  }
  return lookup;
}

/**
 * Build a lookup: filterKey → { schemaType, label }
 * across all known filter types.
 */
function buildFilterFieldLookup() {
  const lookup = {};
  for (const [filterKey, filterDef] of Object.entries(FILTER_TYPES)) {
    if (SERVER_SPECIFIC_FILTER_TYPES.has(filterDef.type)) {
      lookup[filterKey] = {
        schemaType: filterDef.type,
        label: filterDef.label || filterKey,
      };
    }
  }
  return lookup;
}

const CONFIG_FIELD_LOOKUP = buildConfigFieldLookup();
const FILTER_FIELD_LOOKUP = buildFilterFieldLookup();

// ── Reference type display names ──────────────────────────────────

const REF_TYPE_LABELS = {
  channel: "channel",
  channel_multi: "channel(s)",
  roles: "role(s)",
  webhook: "webhook",
  bot_selector: "bot",
  emoji: "emoji",
  role: "role",
  user: "user",
};

// ── Export helpers ─────────────────────────────────────────────────

/**
 * Scan an action config object for server-specific references.
 * Works with both single-config and multi-action { actions: [...] } format.
 *
 * @param {string} actionType - The action type
 * @param {Object} actionConfig - The action configuration
 * @returns {{ field: string, type: string, label: string, value: any }[]}
 */
function extractConfigReferences(actionType, actionConfig) {
  if (!actionConfig) return [];
  const refs = [];

  // Multi-action format
  if (actionConfig.actions && Array.isArray(actionConfig.actions)) {
    for (const action of actionConfig.actions) {
      if (action.config) {
        const subRefs = extractSingleConfigReferences(action.config);
        refs.push(...subRefs.map(r => ({ ...r, actionType: action.type })));
      }
    }
    return refs;
  }

  // Single action (legacy)
  return extractSingleConfigReferences(actionConfig);
}

/**
 * Extract references from a flat config object.
 */
function extractSingleConfigReferences(config) {
  const refs = [];
  for (const [field, value] of Object.entries(config)) {
    if (value === null || value === undefined || value === "") continue;

    const fieldInfo = CONFIG_FIELD_LOOKUP[field];
    if (fieldInfo) {
      // Skip "ALL" values for channel_multi (they're portable)
      if (fieldInfo.schemaType === "channel_multi" && value === "ALL") continue;
      refs.push({
        field,
        type: fieldInfo.schemaType,
        label: fieldInfo.label,
        value,
      });
    }
    // Also handle user_source with specific_user
    if (field === "target_user" && value === "specific_user") {
      const userId = config.specific_user_id;
      if (userId) {
        refs.push({
          field: "specific_user_id",
          type: "user",
          label: "Specific User",
          value: userId,
        });
      }
    }
  }
  return refs;
}

/**
 * Scan trigger filters for server-specific references.
 *
 * @param {Object|null} triggerFilters
 * @returns {{ field: string, type: string, label: string, value: any }[]}
 */
function extractFilterReferences(triggerFilters) {
  if (!triggerFilters) return [];
  const refs = [];
  for (const [field, value] of Object.entries(triggerFilters)) {
    if (value === null || value === undefined || value === "") continue;
    const filterInfo = FILTER_FIELD_LOOKUP[field];
    if (filterInfo) {
      refs.push({
        field,
        type: filterInfo.schemaType,
        label: filterInfo.label,
        value,
      });
    }
  }
  return refs;
}

/**
 * Annotate an automation with server-specific reference metadata for export.
 * Adds `_references` array describing what values are server-specific
 * and will need reconfiguration on import.
 *
 * @param {Object} automation - Prepared automation export object
 * @returns {Object} - Automation with `_references` annotation
 */
export function annotateAutomationReferences(automation) {
  const refs = [];

  // Action config references
  const configRefs = extractConfigReferences(automation.action_type, automation.action_config);
  for (const ref of configRefs) {
    refs.push({
      location: ref.actionType ? `action (${ref.actionType})` : "action",
      field: ref.field,
      type: REF_TYPE_LABELS[ref.type] || ref.type,
      label: ref.label,
    });
  }

  // Trigger filter references
  const filterRefs = extractFilterReferences(automation.trigger_filters);
  for (const ref of filterRefs) {
    refs.push({
      location: "filter",
      field: ref.field,
      type: REF_TYPE_LABELS[ref.type] || ref.type,
      label: ref.label,
    });
  }

  return {
    ...automation,
    _references: refs.length > 0 ? refs : undefined,
  };
}

/**
 * Annotate a command with server-specific reference metadata for export.
 *
 * @param {Object} command - Prepared command export object
 * @returns {Object} - Command with `_references` annotation
 */
export function annotateCommandReferences(command) {
  const refs = [];

  // Action config references
  const configRefs = extractConfigReferences(command.action_type, command.action_config);
  for (const ref of configRefs) {
    refs.push({
      location: ref.actionType ? `action (${ref.actionType})` : "action",
      field: ref.field,
      type: REF_TYPE_LABELS[ref.type] || ref.type,
      label: ref.label,
    });
  }

  return {
    ...command,
    _references: refs.length > 0 ? refs : undefined,
  };
}

// ── Import helpers ────────────────────────────────────────────────

/**
 * Clear server-specific references from a flat config object.
 * Returns a cleaned copy and a list of what was cleared.
 */
function clearSingleConfigReferences(config) {
  const cleaned = { ...config };
  const cleared = [];

  for (const [field, value] of Object.entries(config)) {
    if (value === null || value === undefined || value === "") continue;

    const fieldInfo = CONFIG_FIELD_LOOKUP[field];
    if (fieldInfo) {
      // Skip "ALL" values - they're portable
      if (fieldInfo.schemaType === "channel_multi" && value === "ALL") continue;

      // Clear the value based on type
      if (fieldInfo.schemaType === "channel_multi" || fieldInfo.schemaType === "roles") {
        cleaned[field] = fieldInfo.schemaType === "channel_multi" ? "" : [];
      } else {
        cleaned[field] = "";
      }
      cleared.push({
        field,
        type: REF_TYPE_LABELS[fieldInfo.schemaType] || fieldInfo.schemaType,
        label: fieldInfo.label,
        originalValue: value,
      });
    }

    // Handle specific_user references
    if (field === "target_user" && value === "specific_user") {
      // Reset user source to a default portable value
      cleaned.target_user = "actor";
      if (config.specific_user_id) {
        cleaned.specific_user_id = "";
        cleared.push({
          field: "specific_user_id",
          type: "user",
          label: "Specific User",
          originalValue: config.specific_user_id,
        });
      }
    }
  }

  return { cleaned, cleared };
}

/**
 * Clear server-specific references from an action config.
 * Works with both single-config and multi-action format.
 *
 * @param {string} actionType
 * @param {Object} actionConfig
 * @returns {{ cleaned: Object, cleared: { field: string, type: string, label: string }[] }}
 */
export function clearActionConfigReferences(actionType, actionConfig) {
  if (!actionConfig) return { cleaned: {}, cleared: [] };

  // Multi-action format
  if (actionConfig.actions && Array.isArray(actionConfig.actions)) {
    const allCleared = [];
    const cleanedActions = actionConfig.actions.map((action) => {
      if (!action.config) return action;
      const { cleaned, cleared } = clearSingleConfigReferences(action.config);
      allCleared.push(...cleared.map(c => ({ ...c, actionType: action.type })));
      return { ...action, config: cleaned };
    });
    return {
      cleaned: { ...actionConfig, actions: cleanedActions },
      cleared: allCleared,
    };
  }

  // Single config (legacy)
  const { cleaned, cleared } = clearSingleConfigReferences(actionConfig);
  return { cleaned, cleared };
}

/**
 * Clear server-specific references from trigger filters.
 *
 * @param {Object|null} triggerFilters
 * @returns {{ cleaned: Object|null, cleared: { field: string, type: string, label: string }[] }}
 */
export function clearFilterReferences(triggerFilters) {
  if (!triggerFilters) return { cleaned: null, cleared: [] };

  const cleaned = { ...triggerFilters };
  const cleared = [];

  for (const [field, value] of Object.entries(triggerFilters)) {
    if (value === null || value === undefined || value === "") continue;

    const filterInfo = FILTER_FIELD_LOOKUP[field];
    if (filterInfo) {
      delete cleaned[field];
      cleared.push({
        field,
        type: REF_TYPE_LABELS[filterInfo.schemaType] || filterInfo.schemaType,
        label: filterInfo.label,
      });
    }
  }

  // If all filters were server-specific, return null
  const hasRemainingFilters = Object.keys(cleaned).length > 0;
  return {
    cleaned: hasRemainingFilters ? cleaned : null,
    cleared,
  };
}

/**
 * Summarize what server-specific references an item has that need configuration.
 * Returns a human-readable string like "channel, role(s), user"
 *
 * @param {{ type: string }[]} clearedRefs
 * @returns {string|null}
 */
export function summarizeCleared(clearedRefs) {
  if (!clearedRefs || clearedRefs.length === 0) return null;
  const types = [...new Set(clearedRefs.map(r => r.type))];
  return types.join(", ");
}
