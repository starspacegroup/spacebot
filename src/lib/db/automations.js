/**
 * Automation database functions
 * Handles CRUD operations for automations and execution logging
 */

import { log } from "../log.js";
import { generateHashId } from "../utils.js";
import { enrichRowsWithActorAvatars } from "./avatar-enrichment.js";

function normalizeTriggerEvent(value) {
  if (value === undefined || value === null) return "";
  return String(value)
    .trim()
    .replace(/[\s-]+/g, "_")
    .toUpperCase();
}

function normalizeTriggerEvents(values) {
  if (!Array.isArray(values)) return [];
  const normalized = values
    .map((value) => normalizeTriggerEvent(value))
    .filter(Boolean);
  return [...new Set(normalized)];
}

function triggerMatchesEvent(trigger, normalizedEventType) {
  const normalizedTrigger = normalizeTriggerEvent(trigger);
  if (!normalizedTrigger) return false;

  // Explicit global wildcards match any event.
  if (normalizedTrigger === "*" || normalizedTrigger === "ALL") {
    return true;
  }

  // Exact event match.
  if (normalizedTrigger === normalizedEventType) {
    return true;
  }

  // Legacy category wildcards such as "GITHUB:*" or "GITHUB_*".
  if (
    normalizedTrigger.endsWith(":*") ||
    normalizedTrigger.endsWith("_*")
  ) {
    const prefix = normalizedTrigger.slice(0, -2);
    return normalizedEventType === prefix ||
      normalizedEventType.startsWith(`${prefix}_`);
  }

  // Generic trailing wildcard support for values like "GITHUB*".
  if (normalizedTrigger.endsWith("*")) {
    const prefix = normalizedTrigger.slice(0, -1);
    return normalizedEventType.startsWith(prefix);
  }

  return false;
}

function parseStoredTriggerEvents(rawTriggerEvents, legacyTriggerEvent = null) {
  if (rawTriggerEvents) {
    try {
      const parsed = JSON.parse(rawTriggerEvents);
      if (Array.isArray(parsed)) {
        return normalizeTriggerEvents(parsed);
      }
      log.warn(
        `[DB] trigger_events is not an array; falling back to legacy trigger_event (${legacyTriggerEvent || "none"})`,
      );
    } catch (error) {
      log.warn(
        `[DB] Failed to parse trigger_events JSON; falling back to legacy trigger_event (${legacyTriggerEvent || "none"}): ${error.message}`,
      );
    }
  }

  const legacy = normalizeTriggerEvent(legacyTriggerEvent);
  return legacy ? [legacy] : [];
}

/**
 * @typedef {Object} Automation
 * @property {number} id
 * @property {string} guild_id
 * @property {string} name
 * @property {string} description
 * @property {boolean} enabled
 * @property {string} trigger_event - Legacy: single event type (deprecated, use trigger_events)
 * @property {string[]} trigger_events - Array of event types that trigger this automation
 * @property {Object} trigger_filters - Conditions that must be met
 * @property {string} action_type - Action to perform
 * @property {Object} action_config - Action-specific configuration
 * @property {string} created_by
 * @property {string} created_at
 * @property {string} updated_at
 * @property {string} last_triggered_at
 * @property {number} trigger_count
 */

/**
 * Action types and their configurations
 */
export const ACTION_TYPES = {
  DELETE_USER_MESSAGES: {
    name: "Delete User's Messages",
    description: "Delete messages from a user",
    icon: "🗑️",
    targetUser: true,
    configSchema: {
      target_user: {
        type: "user_source",
        required: true,
        label: "Target User",
        description: "Which user's messages to delete",
      },
      channel_ids: {
        type: "channel_multi",
        required: false,
        label: "Channel(s)",
        showAllOption: true,
        default: "ALL",
      },
      max_age_days: {
        type: "number_source",
        required: false,
        label: "Delete messages from last X days",
        description: "Leave empty to delete all messages regardless of age",
        placeholder: "∞ (all time)",
        supportsOptionRef: true,
      },
      max_messages: {
        type: "number_source",
        required: false,
        label: "Max messages to delete",
        description: "Leave empty for no limit",
        placeholder: "∞",
        supportsOptionRef: true,
      },
      skip_pinned: {
        type: "boolean",
        default: true,
        label: "Skip pinned messages",
      },
    },
  },
  DELETE_MESSAGES: {
    name: "Delete Messages",
    description: "Delete messages from a user in a channel",
    icon: "🗑️",
    targetUser: true,
    configSchema: {
      target_user: {
        type: "user_source",
        required: true,
        label: "Target User",
        description: "Which user's messages to delete",
      },
      channel_ids: {
        type: "channel_multi",
        required: false,
        label: "Channel(s)",
        showAllOption: true,
        allOptionLabel: "Any Channel",
        default: "ALL",
      },
      limit: {
        type: "number",
        default: 100,
        max: 1000,
        label: "Max messages to delete",
      },
    },
  },
  DELETE_MENTIONED_MESSAGES: {
    name: "Delete Messages Mentioning User",
    description: "Delete messages that mention a specific user in a channel",
    icon: "🗑️",
    targetUser: true,
    configSchema: {
      target_user: {
        type: "user_source",
        required: true,
        label: "Mentioned User",
        description: "Which user to find mentions of",
      },
      channel_ids: {
        type: "channel_multi",
        required: true,
        label: "Channel(s)",
        showAllOption: false,
        description: "Which channel(s) to search in",
      },
      limit: {
        type: "number",
        default: 100,
        max: 1000,
        label: "Max messages to delete",
      },
    },
  },
  SEND_MESSAGE: {
    name: "Send Message",
    description: "Send a message to a channel",
    icon: "💬",
    configSchema: {
      ephemeral: { type: "boolean", default: false, label: "Ephemeral (only visible to the user)" },
      channel_id: { type: "channel", required: true, label: "Channel", hideWhen: "ephemeral" },
      content: {
        type: "text",
        required: true,
        label: "Message content",
        supportsVariables: true,
      },
      embed: { type: "boolean", default: false, label: "Send as embed" },
      embed_color: { type: "color", default: "#5865F2", label: "Default embed color", showWhen: "embed" },
      embed_color_rules: { type: "color_rules", default: [], label: "Conditional colors", showWhen: "embed" },
      embed_thumbnail_url: { type: "text", label: "Embed Thumbnail URL", supportsVariables: true, showWhen: "embed" },
      embed_image_url: { type: "text", label: "Embed Image URL", supportsVariables: true, showWhen: "embed" },
      send_later: { type: "boolean", default: false, label: "Schedule for later", hideWhen: "ephemeral" },
      send_later_delay: { type: "delay", label: "Send after", showWhen: "send_later" },
    },
  },
  SEND_MESSAGE_WITH_BUTTONS: {
    name: "Send Message with Buttons",
    description: "Send a message with interactive buttons that trigger actions when clicked",
    icon: "🔘",
    configSchema: {
      ephemeral: { type: "boolean", default: false, label: "Ephemeral (only visible to the user)" },
      channel_id: { type: "channel", required: true, label: "Channel", hideWhen: "ephemeral" },
      content: {
        type: "text",
        required: true,
        label: "Message content",
        supportsVariables: true,
      },
      embed: { type: "boolean", default: false, label: "Send as embed" },
      embed_color: { type: "color", default: "#5865F2", label: "Default embed color", showWhen: "embed" },
      embed_color_rules: { type: "color_rules", default: [], label: "Conditional colors", showWhen: "embed" },
      embed_thumbnail_url: { type: "text", label: "Embed Thumbnail URL", supportsVariables: true, showWhen: "embed" },
      embed_image_url: { type: "text", label: "Embed Image URL", supportsVariables: true, showWhen: "embed" },
      send_later: { type: "boolean", default: false, label: "Schedule for later", hideWhen: "ephemeral" },
      send_later_delay: { type: "delay", label: "Send after", showWhen: "send_later" },
      buttons: {
        type: "button_rows",
        required: true,
        label: "Buttons",
        description: "Configure buttons and their click actions",
      },
    },
  },
  SEND_STATS_WIDGET_IMAGE: {
    name: "Send Stats Widget Image",
    description: "Send a stats widget chart image to a channel",
    icon: "📊",
    configSchema: {
      channel_source: {
        type: "select",
        required: true,
        default: "configured",
        label: "Send To",
        options: [
          { value: "configured", label: "Specific Channel" },
          { value: "trigger", label: "Command/Trigger Channel" },
        ],
      },
      channel_id: {
        type: "channel",
        required: false,
        label: "Channel (when using Specific Channel)",
      },
      widget_type: {
        type: "select",
        required: true,
        default: "voice_time",
        label: "Widget Type",
        options: [
          { value: "voice_time", label: "Voice Time" },
          { value: "voice_users", label: "Voice Users" },
          { value: "voice_peak", label: "Voice Peak" },
          { value: "member_count", label: "Member Count" },
          { value: "member_growth", label: "Member Growth" },
          { value: "member_joins", label: "Member Joins" },
          { value: "member_leaves", label: "Member Leaves" },
          { value: "member_net_change", label: "Member Net Change" },
          { value: "message_count", label: "Message Count" },
          { value: "message_users", label: "Message Authors" },
        ],
      },
      period: {
        type: "select",
        required: true,
        default: "30d",
        label: "Period",
        options: [
          { value: "7d", label: "Last 7 Days" },
          { value: "30d", label: "Last 30 Days" },
        ],
      },
      content: {
        type: "text",
        label: "Optional message",
        supportsVariables: true,
      },
    },
  },
  SEND_DM: {
    name: "Send DM",
    description: "Send a direct message to a user",
    icon: "✉️",
    targetUser: true,
    configSchema: {
      target_user: {
        type: "user_source",
        required: true,
        label: "Recipient",
        description: "Which user to send the DM to",
      },
      content: {
        type: "text",
        required: true,
        label: "Message content",
        supportsVariables: true,
      },
      embed: { type: "boolean", default: false, label: "Send as embed" },
      embed_color: { type: "color", default: "#5865F2", label: "Default embed color", showWhen: "embed" },
      embed_color_rules: { type: "color_rules", default: [], label: "Conditional colors", showWhen: "embed" },
      embed_thumbnail_url: { type: "text", label: "Embed Thumbnail URL", supportsVariables: true, showWhen: "embed" },
      embed_image_url: { type: "text", label: "Embed Image URL", supportsVariables: true, showWhen: "embed" },
      send_later: { type: "boolean", default: false, label: "Schedule for later" },
      send_later_delay: { type: "delay", label: "Send after", showWhen: "send_later" },
    },
  },
  ADD_ROLE: {
    name: "Add Role(s)",
    description: "Add one or more roles to a user",
    icon: "🏷️",
    targetUser: true,
    configSchema: {
      target_user: {
        type: "user_source",
        required: true,
        label: "Target User",
        description: "Which user to add the role(s) to",
      },
      role_ids: { type: "roles", required: true, label: "Role(s)", multiple: true },
    },
  },
  REMOVE_ROLE: {
    name: "Remove Role(s)",
    description: "Remove one or more roles from a user",
    icon: "🏷️",
    targetUser: true,
    configSchema: {
      target_user: {
        type: "user_source",
        required: true,
        label: "Target User",
        description: "Which user to remove the role(s) from",
      },
      role_ids: { type: "roles", required: true, label: "Role(s)", multiple: true },
    },
  },
  KICK_MEMBER: {
    name: "Kick Member",
    description: "Kick a member from the server",
    icon: "👢",
    targetUser: true,
    configSchema: {
      target_user: {
        type: "user_source",
        required: true,
        label: "Target User",
        description: "Which user to kick",
      },
      reason: { type: "text", label: "Reason", supportsVariables: true },
    },
  },
  BAN_MEMBER: {
    name: "Ban Member",
    description: "Ban a member from the server",
    icon: "🔨",
    targetUser: true,
    configSchema: {
      target_user: {
        type: "user_source",
        required: true,
        label: "Target User",
        description: "Which user to ban",
      },
      reason: { type: "text", label: "Reason", supportsVariables: true },
      delete_days: {
        type: "number",
        default: 0,
        max: 7,
        label: "Delete message history (days)",
      },
    },
  },
  TIMEOUT_MEMBER: {
    name: "Timeout Member",
    description: "Timeout a member",
    icon: "⏰",
    targetUser: true,
    configSchema: {
      target_user: {
        type: "user_source",
        required: true,
        label: "Target User",
        description: "Which user to timeout",
      },
      duration_minutes: {
        type: "number_source",
        required: true,
        default: 60,
        label: "Duration (minutes)",
        supportsOptionRef: true,
      },
      reason: { type: "text", label: "Reason", supportsVariables: true },
    },
  },
  LOG_TO_CHANNEL: {
    name: "Log to Channel",
    description: "Send a log message to a channel with event details",
    icon: "📋",
    configSchema: {
      channel_id: { type: "channel", required: true, label: "Log channel" },
      content: {
        type: "text",
        label: "Custom message",
        supportsVariables: true,
      },
      include_details: {
        type: "boolean",
        default: true,
        label: "Include event details",
      },
    },
  },
  CREATE_THREAD: {
    name: "Create Thread",
    description: "Create a thread in a channel",
    icon: "🧵",
    configSchema: {
      channel_id: { type: "channel", required: true, label: "Channel" },
      thread_name: {
        type: "text",
        required: true,
        label: "Thread name",
        supportsVariables: true,
      },
      auto_archive_duration: {
        type: "select",
        options: [60, 1440, 4320, 10080],
        default: 1440,
        label: "Auto-archive after (minutes)",
      },
    },
  },
  ADD_REACTION: {
    name: "Add Reaction",
    description: "Add a reaction emoji to the triggering message",
    icon: "👍",
    configSchema: {
      emoji: {
        type: "emoji",
        required: true,
        label: "Emoji",
        description: "The emoji to react with",
      },
    },
    applicableEvents: ["MESSAGE_CREATE", "MESSAGE_UPDATE"],
  },
  SERVER_MUTE: {
    name: "Server Mute",
    description: "Server mute a member in voice",
    icon: "🔇",
    targetUser: true,
    configSchema: {
      target_user: {
        type: "user_source",
        required: true,
        label: "Target User",
        description: "Which user to server mute",
      },
      reason: { type: "text", label: "Reason", supportsVariables: true },
    },
  },
  SERVER_UNMUTE: {
    name: "Server Unmute",
    description: "Remove server mute from a member in voice",
    icon: "🔊",
    targetUser: true,
    configSchema: {
      target_user: {
        type: "user_source",
        required: true,
        label: "Target User",
        description: "Which user to server unmute",
      },
      reason: { type: "text", label: "Reason", supportsVariables: true },
    },
  },
  SERVER_DEAFEN: {
    name: "Server Deafen",
    description: "Server deafen a member in voice",
    icon: "🔕",
    targetUser: true,
    configSchema: {
      target_user: {
        type: "user_source",
        required: true,
        label: "Target User",
        description: "Which user to server deafen",
      },
      reason: { type: "text", label: "Reason", supportsVariables: true },
    },
  },
  SERVER_UNDEAFEN: {
    name: "Server Undeafen",
    description: "Remove server deafen from a member in voice",
    icon: "🔔",
    targetUser: true,
    configSchema: {
      target_user: {
        type: "user_source",
        required: true,
        label: "Target User",
        description: "Which user to server undeafen",
      },
      reason: { type: "text", label: "Reason", supportsVariables: true },
    },
  },
  CALL_WEBHOOK: {
    name: "Call Webhook",
    description: "Send data to an external webhook endpoint",
    icon: "🔗",
    configSchema: {
      webhook_id: {
        type: "webhook",
        required: true,
        label: "Webhook",
        description: "Select a webhook endpoint to call",
      },
      payload_template: {
        type: "json",
        required: false,
        label: "Custom Payload (JSON)",
        description: "Custom JSON payload to send. Leave empty to send event data.",
        supportsVariables: true,
      },
      include_event_data: {
        type: "boolean",
        default: true,
        label: "Include event data",
        description: "Merge event data into the payload",
      },
    },
  },
};

/**
 * Filter types that can be applied to triggers
 * Each filter has an applicableEvents array to define which event types it applies to
 * Use "*" to apply to all events, or specify event type prefixes/exact matches
 */
export const FILTER_TYPES = {
  channel_id: {
    type: "channel",
    label: "In Channel(s)",
    description: "Only trigger in this channel",
    applicableEvents: [
      "MESSAGE_",
      "VOICE_",
      "THREAD_",
      "REACTION_",
      "CHANNEL_PINS_UPDATE",
    ],
  },
  not_channel_id: {
    type: "channel",
    label: "Not In Channel(s)",
    description: "Don't trigger in this channel",
    applicableEvents: [
      "MESSAGE_",
      "VOICE_",
      "THREAD_",
      "REACTION_",
      "CHANNEL_PINS_UPDATE",
    ],
  },
  actor_has_role: {
    type: "role",
    label: "Actor Has Role",
    description: "Actor must have this role",
    applicableEvents: ["*"], // All events have an actor
  },
  actor_missing_role: {
    type: "role",
    label: "Actor Missing Role",
    description: "Actor must NOT have this role",
    applicableEvents: ["*"], // All events have an actor
  },
  target_has_role: {
    type: "role",
    label: "Target Has Role",
    description: "Target must have this role",
    applicableEvents: [
      "MEMBER_BAN",
      "MEMBER_UNBAN",
      "MEMBER_KICK",
      "MEMBER_TIMEOUT",
      "MEMBER_ROLE_ADD",
      "MEMBER_ROLE_REMOVE",
    ],
  },
  actor_id: {
    type: "user",
    label: "From User(s)",
    description: "Only trigger for messages from specific users",
    applicableEvents: ["MESSAGE_CREATE", "MESSAGE_UPDATE", "MESSAGE_DELETE"],
  },
  not_actor_id: {
    type: "user",
    label: "Not From User(s)",
    description: "Don't trigger for messages from these users",
    applicableEvents: ["MESSAGE_CREATE", "MESSAGE_UPDATE", "MESSAGE_DELETE"],
  },
  content_contains: {
    type: "text",
    label: "Content Contains",
    description: "Message content must contain text",
    applicableEvents: ["MESSAGE_CREATE", "MESSAGE_UPDATE"],
  },
  content_regex: {
    type: "text",
    label: "Content Matches Regex",
    description: "Message content matches pattern",
    applicableEvents: ["MESSAGE_CREATE", "MESSAGE_UPDATE"],
  },
  bot_filter: {
    type: "select",
    label: "Bot Filter",
    description: "Filter by bot status",
    options: [
      { value: "any", label: "Any (Bots & Humans)" },
      { value: "only_bots", label: "Only Bots" },
      { value: "only_humans", label: "Only Humans" },
    ],
    default: "any",
    applicableEvents: ["MESSAGE_", "MEMBER_JOIN", "MEMBER_LEAVE", "REACTION_"],
  },
  min_account_age_days: {
    type: "number",
    label: "Min Account Age (days)",
    description: "Account must be at least X days old",
    applicableEvents: ["MEMBER_JOIN"],
  },
  max_account_age_days: {
    type: "number",
    label: "Max Account Age (days)",
    description: "Account must be less than X days old",
    applicableEvents: ["MEMBER_JOIN"],
  },
  // Bot command filters (for SLASH_COMMAND_USE and SLASH_COMMAND_RESPONSE events)
  target_bot_id: {
    type: "bot_selector",
    label: "Target Bot",
    description: "Filter by which bot responded to the command",
    applicableEvents: ["SLASH_COMMAND_USE", "SLASH_COMMAND_RESPONSE"],
  },
  command_name: {
    type: "command_selector",
    label: "Command Name",
    description: "Filter by the specific command used",
    applicableEvents: ["SLASH_COMMAND_USE", "SLASH_COMMAND_RESPONSE"],
    dependsOn: "target_bot_id", // Only show if target_bot_id is set
  },
  command_result: {
    type: "select",
    label: "Command Result",
    description: "Filter by whether the command succeeded or failed",
    options: [
      { value: "any", label: "Any Result" },
      { value: "success", label: "✅ Success Only" },
      { value: "failure", label: "❌ Failure Only" },
    ],
    default: "any",
    applicableEvents: ["SLASH_COMMAND_USE", "SLASH_COMMAND_RESPONSE"],
    dependsOn: "command_name", // Only show if command_name is set
  },
  embed_contains: {
    type: "text",
    label: "Embed Contains",
    description: "Bot response embed must contain this text",
    applicableEvents: ["SLASH_COMMAND_USE", "SLASH_COMMAND_RESPONSE", "MESSAGE_CREATE"],
  },
  member_update_type: {
    type: "select",
    label: "Update Type",
    description: "Filter by what changed on the member",
    options: [
      { value: "any", label: "Any Update" },
      { value: "rules_accepted", label: "✅ Accepted Server Rules" },
      { value: "nickname_changed", label: "📝 Nickname Changed" },
    ],
    default: "any",
    applicableEvents: ["MEMBER_UPDATE"],
  },
  voice_from_channel_id: {
    type: "channel",
    label: "From Channel(s)",
    description: "Only trigger when moved FROM this channel",
    applicableEvents: ["VOICE_MOVE"],
    voiceOnly: true,
  },
  voice_to_channel_id: {
    type: "channel",
    label: "To Channel(s)",
    description: "Only trigger when moved TO this channel",
    applicableEvents: ["VOICE_MOVE"],
    voiceOnly: true,
  },
  // GitHub-specific filters (for GITHUB_* events)
  github_repo: {
    type: "text",
    label: "Repository",
    description: "Filter by one or more repositories (e.g. owner/repo)",
    applicableEvents: ["GITHUB_"],
  },
  github_action: {
    type: "select",
    label: "Action",
    description: "Filter by the specific action (e.g. opened, closed, merged)",
    options: [
      { value: "any", label: "Any Action" },
      { value: "opened", label: "Opened" },
      { value: "closed", label: "Closed" },
      { value: "merged", label: "Merged" },
      { value: "reopened", label: "Reopened" },
      { value: "created", label: "Created" },
      { value: "deleted", label: "Deleted" },
      { value: "edited", label: "Edited" },
      { value: "published", label: "Published" },
      { value: "completed", label: "Completed" },
    ],
    default: "any",
    applicableEvents: [
      "GITHUB_PULL_REQUEST",
      "GITHUB_ISSUES",
      "GITHUB_ISSUE_COMMENT",
      "GITHUB_RELEASE",
      "GITHUB_STAR",
      "GITHUB_WORKFLOW_RUN",
      "GITHUB_WORKFLOW_JOB",
      "GITHUB_CHECK_RUN",
      "GITHUB_CHECK_SUITE",
    ],
  },
  github_branch: {
    type: "text",
    label: "Branch",
    description: "Filter by branch name",
    applicableEvents: ["GITHUB_PUSH", "GITHUB_WORKFLOW_RUN", "GITHUB_WORKFLOW_JOB", "GITHUB_CHECK_RUN", "GITHUB_CHECK_SUITE", "GITHUB_DEPLOYMENT_STATUS"],
  },
  github_workflow_conclusion: {
    type: "select",
    label: "Conclusion / State",
    description: "Filter by workflow run, check, or deployment result",
    options: [
      { value: "any", label: "Any Conclusion" },
      { value: "success", label: "✅ Success" },
      { value: "failure", label: "❌ Failure" },
      { value: "cancelled", label: "🚫 Cancelled" },
    ],
    default: "any",
    applicableEvents: ["GITHUB_WORKFLOW_RUN", "GITHUB_WORKFLOW_JOB", "GITHUB_CHECK_RUN", "GITHUB_CHECK_SUITE", "GITHUB_DEPLOYMENT_STATUS"],
  },
  github_repo_visibility: {
    type: "select",
    label: "Repository Visibility",
    description: "Filter by whether the repository is public or private",
    options: [
      { value: "any", label: "Any Visibility" },
      { value: "public", label: "🌐 Public" },
      { value: "private", label: "🔒 Private" },
    ],
    default: "any",
    applicableEvents: ["GITHUB_"],
  },
  // Button click filters
  button_custom_id: {
    type: "text",
    label: "Button ID",
    description: "Filter by the button's custom ID (supports comma-separated list)",
    applicableEvents: ["BUTTON_CLICK"],
  },
};

/**
 * Check if a filter applies to a given event type
 * @param {Object} filterInfo - The filter configuration object
 * @param {string} eventType - The event type to check
 * @returns {boolean} - Whether the filter applies to the event type
 */
export function filterAppliesToEvent(filterInfo, eventType) {
  if (!filterInfo.applicableEvents || !eventType) {
    return true; // If no restrictions, apply to all
  }

  for (const pattern of filterInfo.applicableEvents) {
    if (pattern === "*") {
      return true;
    }
    // Check if it's a prefix match (ends with _) or exact match
    if (pattern.endsWith("_")) {
      if (eventType.startsWith(pattern)) {
        return true;
      }
    } else if (eventType === pattern) {
      return true;
    }
  }

  return false;
}

/**
 * Get filters applicable to a specific event type
 * @param {string} eventType - The event type
 * @returns {Object} - Filtered FILTER_TYPES object
 */
export function getFiltersForEvent(eventType) {
  const applicableFilters = {};
  for (const [filterKey, filterInfo] of Object.entries(FILTER_TYPES)) {
    if (filterAppliesToEvent(filterInfo, eventType)) {
      applicableFilters[filterKey] = filterInfo;
    }
  }
  return applicableFilters;
}

/**
 * Template variables available for use in automation messages
 */
export const TEMPLATE_VARIABLES = {
  "user.id": "Actor's Discord ID",
  "user.name": "Actor's username",
  "user.mention": "Mention the actor",
  "user.tag": "Actor's tag (username#0000)",
  "target.id": "Target's Discord ID",
  "target.name": "Target's username",
  "target.mention": "Mention the target",
  "channel.id": "Channel ID",
  "channel.name": "Channel name",
  "channel.mention": "Mention the channel",
  "guild.id": "Server ID",
  "guild.name": "Server name",
  "guild.member_count": "Total member count",
  "guild.human_count": "Human (non-bot) member count",
  "guild.bot_count": "Bot count",
  "guild.boost_count": "Number of boosts",
  "guild.boost_level": "Server boost level (0-3)",
  "trigger.event": "Event type that triggered",
  "trigger.category": "Event category",
  "trigger.icon": "Event type emoji icon",
  "trigger.time": "When the event occurred",
  // GitHub-specific variables (available for GITHUB_* events)
  "github.repo": "GitHub repository (owner/repo)",
  "github.branch": "Branch name",
  "github.action": "GitHub action (opened, closed, merged, etc.)",
  "github.title": "PR/Issue title",
  "github.number": "PR/Issue number",
  "github.url": "URL to the PR/Issue/Release",
  "github.sender": "GitHub username who triggered the event",
  "github.sender_avatar_url": "GitHub avatar URL of the sender (use as embed thumbnail)",
  "github.conclusion": "Workflow run conclusion (success, failure, etc.)",
  "github.tag": "Release tag name",
  "github_logo_url": "GitHub logo image URL (use as embed thumbnail)",
};

/**
 * User source options for automations
 * These define which user to target in user-related actions
 */
export const AUTOMATION_USER_SOURCES = {
  actor: {
    value: "actor",
    label: "Event Actor",
    description: "The user who triggered the event",
  },
  target: {
    value: "target",
    label: "Event Target",
    description: "The user who was the target of the event (if any)",
  },
  specific_user: {
    value: "specific_user",
    label: "Specific User",
    description: "A specific user selected from the server members list",
  },
};

/**
 * User source options for commands
 * These define which user to target in user-related actions
 * Dynamic options are added based on command options
 */
export const COMMAND_USER_SOURCES = {
  invoker: {
    value: "invoker",
    label: "Command Invoker",
    description: "The user who ran the command",
  },
};

/**
 * Create a new automation
 * @param {D1Database} db
 * @param {Partial<Automation>} automation
 * @returns {Promise<{success: boolean, id?: number, error?: string}>}
 */
export async function createAutomation(db, automation) {
  if (!db) {
    return { success: false, error: "Database not available" };
  }

  try {
    // Support both single trigger_event and multiple trigger_events
    const triggerEvents = normalizeTriggerEvents(
      automation.trigger_events ||
        (automation.trigger_event ? [automation.trigger_event] : []),
    );
    // For backwards compatibility, store first event in trigger_event
    const primaryTrigger = triggerEvents[0] || null;

    // Clean action_config to avoid circular references
    let cleanActionConfig = {};
    if (automation.action_config) {
      // Deep clone to strip any reactive wrappers
      if (automation.action_config.actions) {
        cleanActionConfig.actions = automation.action_config.actions.map(
          (action) => ({
            type: action.type,
            config: { ...action.config },
          }),
        );
      }
      // Copy other properties
      for (const [key, value] of Object.entries(automation.action_config)) {
        if (key !== "actions") {
          cleanActionConfig[key] = value;
        }
      }
    }

    // Generate a unique public_id for URL-safe references
    const publicId = generateHashId(12);

    const result = await db.prepare(`
      INSERT INTO automations (
        guild_id, name, description, enabled,
        trigger_event, trigger_events, trigger_filters,
        action_type, action_config,
        created_by, public_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      automation.guild_id,
      automation.name,
      automation.description || null,
      automation.enabled !== false ? 1 : 0,
      primaryTrigger,
      JSON.stringify(triggerEvents),
      automation.trigger_filters
        ? JSON.stringify(automation.trigger_filters)
        : null,
      automation.action_type,
      JSON.stringify(cleanActionConfig),
      automation.created_by || null,
      publicId,
    ).run();

    return { success: true, id: result.meta?.last_row_id, publicId };
  } catch (error) {
    log.error("Failed to create automation:", error);
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Update an existing automation (supports both numeric ID and public_id hash)
 * @param {D1Database} db
 * @param {number|string} id - Numeric ID or public_id hash
 * @param {Partial<Automation>} updates
 * @param {string} [guildId] - Optional guild ID for extra security with public_id
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function updateAutomation(db, id, updates, guildId = null) {
  if (!db) {
    return { success: false, error: "Database not available" };
  }

  try {
    const isNumericId = typeof id === 'number' || /^\d+$/.test(String(id));
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
    if (updates.enabled !== undefined) {
      fields.push("enabled = ?");
      values.push(updates.enabled ? 1 : 0);
    }
    if (updates.trigger_events !== undefined) {
      // Handle multiple triggers
      const triggerEvents = normalizeTriggerEvents(
        Array.isArray(updates.trigger_events)
          ? updates.trigger_events
          : [updates.trigger_events],
      );
      fields.push("trigger_events = ?");
      values.push(JSON.stringify(triggerEvents));
      // Also update legacy trigger_event field for backwards compatibility
      fields.push("trigger_event = ?");
      values.push(triggerEvents[0] || null);
    } else if (updates.trigger_event !== undefined) {
      // Legacy single trigger update - also update trigger_events
      const normalizedTrigger = normalizeTriggerEvent(updates.trigger_event);
      fields.push("trigger_event = ?");
      values.push(normalizedTrigger || null);
      fields.push("trigger_events = ?");
      values.push(JSON.stringify(normalizedTrigger ? [normalizedTrigger] : []));
    }
    if (updates.trigger_filters !== undefined) {
      fields.push("trigger_filters = ?");
      values.push(
        updates.trigger_filters
          ? JSON.stringify(updates.trigger_filters)
          : null,
      );
    }
    if (updates.action_type !== undefined) {
      fields.push("action_type = ?");
      values.push(updates.action_type);
    }
    if (updates.action_config !== undefined || updates.actions !== undefined) {
      fields.push("action_config = ?");
      // If we have a new actions array, store it in action_config
      // Create a clean copy to avoid circular references from reactive state
      const actionConfig = updates.action_config
        ? JSON.parse(JSON.stringify(updates.action_config))
        : {};
      if (updates.actions !== undefined) {
        // Deep clone actions to strip any reactive wrappers or circular refs
        actionConfig.actions = updates.actions.map((action) => ({
          type: action.type,
          config: { ...action.config },
        }));
      }
      values.push(JSON.stringify(actionConfig));
    }

    fields.push("updated_at = CURRENT_TIMESTAMP");

    // Build WHERE clause based on ID type
    let whereClause;
    if (isNumericId) {
      whereClause = "id = ?";
      values.push(parseInt(id));
    } else {
      whereClause = "public_id = ?";
      values.push(String(id));
    }
    
    // Add guild_id restriction if provided
    if (guildId) {
      whereClause += " AND guild_id = ?";
      values.push(guildId);
    }

    await db.prepare(`
      UPDATE automations SET ${fields.join(", ")} WHERE ${whereClause}
    `).bind(...values).run();

    return { success: true };
  } catch (error) {
    log.error("Failed to update automation:", error);
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Delete an automation (supports both numeric ID and public_id hash)
 * @param {D1Database} db
 * @param {number|string} id - Numeric ID or public_id hash
 * @param {string} guildId - Ensure deletion is for correct guild
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deleteAutomation(db, id, guildId) {
  if (!db) {
    return { success: false, error: "Database not available" };
  }

  try {
    const isNumericId = typeof id === 'number' || /^\d+$/.test(String(id));
    
    if (isNumericId) {
      await db.prepare(`
        DELETE FROM automations WHERE id = ? AND guild_id = ?
      `).bind(parseInt(id), guildId).run();
    } else {
      await db.prepare(`
        DELETE FROM automations WHERE public_id = ? AND guild_id = ?
      `).bind(String(id), guildId).run();
    }

    return { success: true };
  } catch (error) {
    log.error("Failed to delete automation:", error);
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Get a single automation by ID (supports both numeric ID and public_id hash)
 * @param {D1Database} db
 * @param {number|string} id - Numeric ID or public_id hash
 * @param {string} guildId
 * @returns {Promise<Automation|null>}
 */
export async function getAutomation(db, id, guildId) {
  if (!db) return null;

  try {
    // Determine if we're looking up by numeric ID or public_id
    const isNumericId = typeof id === 'number' || /^\d+$/.test(String(id));
    
    let result;
    if (isNumericId) {
      result = await db.prepare(`
        SELECT * FROM automations WHERE id = ? AND guild_id = ?
      `).bind(parseInt(id), guildId).first();
    } else {
      // Lookup by public_id (hash)
      result = await db.prepare(`
        SELECT * FROM automations WHERE public_id = ? AND guild_id = ?
      `).bind(String(id), guildId).first();
    }

    if (!result) return null;

    const parsed = {
      ...result,
      enabled: !!result.enabled,
      trigger_filters: result.trigger_filters
        ? JSON.parse(result.trigger_filters)
        : null,
      action_config: result.action_config
        ? JSON.parse(result.action_config)
        : {},
    };

    parsed.trigger_events = parseStoredTriggerEvents(
      result.trigger_events,
      result.trigger_event,
    );
    parsed.trigger_event = parsed.trigger_events[0] || null;

    // Parse actions array if present, or construct from legacy single action
    if (parsed.action_config?.actions) {
      parsed.actions = parsed.action_config.actions;
    } else if (
      parsed.action_type && parsed.action_type !== "NONE" &&
      parsed.action_type !== "MULTIPLE"
    ) {
      // Legacy format: convert single action to array
      parsed.actions = [{
        type: parsed.action_type,
        config: parsed.action_config || {},
      }];
    } else {
      parsed.actions = [];
    }

    return parsed;
  } catch (error) {
    log.error("Failed to get automation:", error);
    return null;
  }
}

/**
 * Get all automations for a guild
 * @param {D1Database} db
 * @param {string} guildId
 * @param {Object} options
 * @returns {Promise<{automations: Automation[], total: number}>}
 */
export async function getAutomations(db, guildId, options = {}) {
  if (!db) {
    log.warn("[DB] getAutomations called but db is not available");
    return { automations: [], total: 0 };
  }

  const { limit = 50, offset = 0, eventType, enabled } = options;
  log.info(`[DB] getAutomations called: guildId=${guildId}, eventType=${eventType}, enabled=${enabled}, limit=${limit}, offset=${offset}`);

  try {
    let whereClause = "WHERE guild_id = ?";
    const params = [guildId];

    if (eventType) {
      whereClause += " AND UPPER(REPLACE(TRIM(trigger_event), ' ', '_')) = ?";
      params.push(normalizeTriggerEvent(eventType));
    }

    if (enabled !== undefined) {
      whereClause += " AND enabled = ?";
      params.push(enabled ? 1 : 0);
    }

    const countResult = await db.prepare(`
      SELECT COUNT(*) as total FROM automations ${whereClause}
    `).bind(...params).first();

    const results = await db.prepare(`
      SELECT * FROM automations ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all();

    log.info(`[DB] getAutomations query results: count=${countResult?.total}, rows=${results.results?.length}`);

    return {
      automations: (results.results || []).map((a) => {
        const parsed = {
          ...a,
          enabled: !!a.enabled,
          trigger_filters: a.trigger_filters
            ? JSON.parse(a.trigger_filters)
            : null,
          action_config: a.action_config ? JSON.parse(a.action_config) : {},
        };
        parsed.trigger_events = parseStoredTriggerEvents(
          a.trigger_events,
          a.trigger_event,
        );
        parsed.trigger_event = parsed.trigger_events[0] || null;
        return parsed;
      }),
      total: countResult?.total || 0,
    };
  } catch (error) {
    log.error("Failed to get automations:", error);
    return { automations: [], total: 0 };
  }
}

/**
 * Get automations that should trigger for a specific event
 * @param {D1Database} db
 * @param {string} guildId
 * @param {string} eventType
 * @returns {Promise<Automation[]>}
 */
export async function getTriggeredAutomations(db, guildId, eventType) {
  if (!db) return [];

  try {
    const normalizedEventType = normalizeTriggerEvent(eventType);

    // Load enabled automations for this guild, then match triggers in JS.
    // This keeps compatibility with legacy wildcard trigger values like
    // "GITHUB:*" that can exist in production data.
    const results = await db.prepare(`
      SELECT * FROM automations 
      WHERE guild_id = ? AND enabled = 1
    `).bind(guildId).all();

    const allEnabled = results.results || [];

    if (allEnabled.length === 0) {
      log.info(
        `[DB] getTriggeredAutomations: no enabled automations for guild=${guildId} (event=${normalizedEventType})`,
      );
    }

    const matched = allEnabled.filter((a) => {
      const triggerEvents = parseStoredTriggerEvents(
        a.trigger_events,
        a.trigger_event,
      );

      const matches = triggerEvents.some((trigger) =>
        triggerMatchesEvent(trigger, normalizedEventType)
      );

      if (!matches) {
        log.info(
          `[DB] Automation "${a.name}" (id=${a.id}) skipped for ${normalizedEventType} — stored triggers: ${JSON.stringify(triggerEvents)}`,
        );
      }

      return matches;
    });

    log.info(
      `[DB] getTriggeredAutomations for ${normalizedEventType} in guild=${guildId}: ${matched.length}/${allEnabled.length} automation(s) matched`,
    );

    const parsedMatched = [];

    for (const a of matched) {
      try {
        const parsed = {
          ...a,
          enabled: !!a.enabled,
          trigger_filters: a.trigger_filters
            ? JSON.parse(a.trigger_filters)
            : null,
          action_config: a.action_config ? JSON.parse(a.action_config) : {},
        };
        parsed.trigger_events = parseStoredTriggerEvents(
          a.trigger_events,
          a.trigger_event,
        );
        parsed.trigger_event = parsed.trigger_events[0] || null;
        parsedMatched.push(parsed);
      } catch (rowError) {
        log.error(
          `[DB] getTriggeredAutomations: skipping malformed automation id=${a.id} name="${a.name}" for guild=${guildId}: ${rowError.message}`,
        );
      }
    }

    return parsedMatched;
  } catch (error) {
    log.error("Failed to get triggered automations:", error);
    return [];
  }
}

/**
 * Log automation execution
 * @param {D1Database} db
 * @param {Object} log
 * @returns {Promise<{success: boolean}>}
 */
export async function logAutomationExecution(db, log) {
  if (!db) return { success: false };

  try {
    await db.prepare(`
      INSERT INTO automation_logs (
        automation_id, guild_id, trigger_event,
        trigger_data, action_result, success, error_message, execution_time_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      log.automation_id,
      log.guild_id,
      log.trigger_event,
      log.trigger_data ? JSON.stringify(log.trigger_data) : null,
      log.action_result ? JSON.stringify(log.action_result) : null,
      log.success ? 1 : 0,
      log.error_message || null,
      log.execution_time_ms || null,
    ).run();

    // Update automation trigger stats
    await db.prepare(`
      UPDATE automations 
      SET trigger_count = trigger_count + 1, last_triggered_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(log.automation_id).run();

    return { success: true };
  } catch (error) {
    log.error("Failed to log automation execution:", error);
    return { success: false };
  }
}

/**
 * Get automation execution logs
 * @param {D1Database} db
 * @param {string} guildId
 * @param {Object} options
 * @returns {Promise<{logs: Array, total: number}>}
 */
export async function getAutomationLogs(db, guildId, options = {}) {
  if (!db) return { logs: [], total: 0 };

  const { limit = 50, offset = 0, automationId, success } = options;

  try {
    let whereClause = "WHERE al.guild_id = ?";
    const params = [guildId];

    if (automationId) {
      whereClause += " AND al.automation_id = ?";
      params.push(automationId);
    }

    if (success !== undefined) {
      whereClause += " AND al.success = ?";
      params.push(success ? 1 : 0);
    }

    const countResult = await db.prepare(`
      SELECT COUNT(*) as total FROM automation_logs al ${whereClause}
    `).bind(...params).first();

    const results = await db.prepare(`
      SELECT al.*, a.name as automation_name 
      FROM automation_logs al
      LEFT JOIN automations a ON al.automation_id = a.id
      ${whereClause}
      ORDER BY al.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all();

    const parsedLogs = (results.results || []).map((log) => ({
        ...log,
        success: !!log.success,
        trigger_data: log.trigger_data ? JSON.parse(log.trigger_data) : null,
        action_result: log.action_result ? JSON.parse(log.action_result) : null,
      }));

    const actorRows = parsedLogs.map((entry, index) => ({
      __idx: index,
      actor_id: entry?.trigger_data?.actor_id || null,
      actor_avatar: entry?.trigger_data?.actor_avatar || null,
      actor_name: entry?.trigger_data?.actor_name || null,
      actor_discriminator: entry?.trigger_data?.actor_discriminator || "0",
    }));

    const enrichedActors = await enrichRowsWithActorAvatars(db, guildId, actorRows, {
      idField: "actor_id",
      avatarField: "actor_avatar",
      nameField: "actor_name",
      discriminatorField: "actor_discriminator",
    });

    const enrichedLogs = parsedLogs.map((entry, index) => {
      const actor = enrichedActors[index];
      if (!entry?.trigger_data || !actor?.actor_id) return entry;
      return {
        ...entry,
        trigger_data: {
          ...entry.trigger_data,
          actor_avatar: actor.actor_avatar || null,
          actor_name: actor.actor_name || entry.trigger_data.actor_name || null,
          actor_discriminator: actor.actor_discriminator || entry.trigger_data.actor_discriminator || "0",
        },
      };
    });

    return {
      logs: enrichedLogs,
      total: countResult?.total || 0,
    };
  } catch (error) {
    log.error("Failed to get automation logs:", error);
    return { logs: [], total: 0 };
  }
}

/**
 * Toggle automation enabled state (supports both numeric ID and public_id hash)
 * @param {D1Database} db
 * @param {number|string} id - Numeric ID or public_id hash
 * @param {string} guildId
 * @param {boolean} enabled
 * @returns {Promise<{success: boolean}>}
 */
export async function toggleAutomation(db, id, guildId, enabled) {
  if (!db) return { success: false };

  try {
    const isNumericId = typeof id === 'number' || /^\d+$/.test(String(id));
    
    if (isNumericId) {
      await db.prepare(`
        UPDATE automations SET enabled = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND guild_id = ?
      `).bind(enabled ? 1 : 0, parseInt(id), guildId).run();
    } else {
      await db.prepare(`
        UPDATE automations SET enabled = ?, updated_at = CURRENT_TIMESTAMP
        WHERE public_id = ? AND guild_id = ?
      `).bind(enabled ? 1 : 0, String(id), guildId).run();
    }

    return { success: true };
  } catch (error) {
    log.error("Failed to toggle automation:", error);
    return { success: false };
  }
}
