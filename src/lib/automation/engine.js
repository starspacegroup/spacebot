/**
 * Automation Engine
 * Processes events and executes matching automations
 */

import {
  getTriggeredAutomations,
  logAutomationExecution,
} from "../db/automations.js";
import { getWebhook, callWebhook } from "../db/webhooks.js";
import { createScheduledMessage, parseDelay } from "../db/scheduled-messages.js";
import { log } from "../log.js";
import { detectCommandResult, getBot } from "../discord/bots.js";
import { fetchSignedWidgetPng, resolveWidgetOrigin } from "../stats-widget-delivery.js";

/**
 * Resolve the target user ID from action config
 * @param {Object} action_config - The action configuration
 * @param {Object} event - The event data (contains actor_id, target_id, and option values)
 * @returns {string|null} - The resolved user ID or null
 */
export function resolveTargetUser(action_config, event) {
  const targetUserSource = action_config.target_user;

  // If no target_user config, fall back to legacy behavior (actor or target)
  if (!targetUserSource) {
    return event.actor_id || event.target_id;
  }

  switch (targetUserSource) {
    case "actor":
    case "invoker": // Command invoker maps to actor_id
      return event.actor_id;
    case "target":
      return event.target_id;
    default:
      // Check if it's a specific user reference (specific:<userId>)
      if (targetUserSource.startsWith("specific:")) {
        const userId = targetUserSource.substring(9);
        if (userId) return userId;
        // Fall back to actor if no user ID provided
        return event.actor_id;
      }
      // Check if it's an option reference (option:<optionName>)
      if (targetUserSource.startsWith("option:")) {
        const optionName = targetUserSource.substring(7);
        // Look for the option value in event.options or event.option_<name>
        if (event.options?.[optionName]) {
          return event.options[optionName];
        }
        // Also check flat properties (e.g., event.option_spammer)
        if (event[`option_${optionName}`]) {
          return event[`option_${optionName}`];
        }
      }
      // Unknown source, fall back to actor
      return event.actor_id;
  }
}

/**
 * Resolve a number value from action config
 * Supports static values or command option references (option:<optionName>)
 * @param {string|number|Object} configValue - The config value (can be static, option ref string, or object with source)
 * @param {Object} event - The event data (contains option values)
 * @param {number|null} defaultValue - Default value if not resolvable
 * @returns {number|null} - The resolved number or default
 */
export function resolveNumberValue(configValue, event, defaultValue = null) {
  // If no config value, return default
  if (configValue === undefined || configValue === null || configValue === "") {
    return defaultValue;
  }

  // If it's already a number, return it
  if (typeof configValue === "number") {
    return configValue;
  }

  // If it's a string, check if it's an option reference or static value
  if (typeof configValue === "string") {
    // Check if it's an option reference (option:<optionName>)
    if (configValue.startsWith("option:")) {
      const optionName = configValue.substring(7);
      // Look for the option value in event.options
      if (event.options?.[optionName] !== undefined) {
        const val = parseFloat(event.options[optionName]);
        return isNaN(val) ? defaultValue : val;
      }
      // Also check flat properties (e.g., event.option_days)
      if (event[`option_${optionName}`] !== undefined) {
        const val = parseFloat(event[`option_${optionName}`]);
        return isNaN(val) ? defaultValue : val;
      }
      // Option not found, return default
      return defaultValue;
    }

    // Try to parse as static number
    const parsed = parseFloat(configValue);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  // If it's an object with source/value properties (for more complex configs)
  if (typeof configValue === "object") {
    if (configValue.source === "static") {
      const val = parseFloat(configValue.value);
      return isNaN(val) ? defaultValue : val;
    }
    if (configValue.source === "option" && configValue.optionName) {
      return resolveNumberValue(
        `option:${configValue.optionName}`,
        event,
        defaultValue,
      );
    }
  }

  return defaultValue;
}

/**
 * Send an image attachment to a channel-like object.
 * Works with both discord.js channels and REST wrapper channels.
 * @param {Object} channel
 * @param {Uint8Array} pngData
 * @param {string} filename
 * @param {string} [content]
 */
async function sendChannelImage(channel, pngData, filename, content = "") {
  const payload = {
    files: [{ attachment: pngData, name: filename }],
  };

  if (content) {
    payload.content = content;
  }

  await channel.send(payload);
}

/**
 * Process template variables in a string
 * @param {string} template - Template string with {variable} placeholders
 * @param {Object} context - Variable context
 * @returns {string}
 */
export function processTemplate(template, context) {
  if (!template) return template;

  return template.replace(/\{([^}]+)\}/g, (match, path) => {
    const parts = path.split(".");
    let value = context;
    let pathExists = true;

    for (const part of parts) {
      if (value === undefined || value === null) {
        pathExists = false;
        break;
      }
      value = value[part];
    }

    // If path exists in context, return the value (even if null/undefined becomes empty string)
    // If path doesn't exist at all, keep the original template placeholder
    if (pathExists) {
      return value !== undefined && value !== null ? String(value) : "";
    }
    return match;
  });
}

/**
 * Send an ephemeral followup message via the Discord interaction webhook
 */
async function sendInteractionFollowup(applicationId, interactionToken, payload, botToken) {
  const res = await fetch(
    `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to send ephemeral followup: ${res.status} ${errText}`);
  }
  return res.json();
}

/**
 * Resolve embed color from config, evaluating conditional color rules against context
 * @param {Object} actionConfig - The action configuration
 * @param {Object} context - Variable context (same as template variables)
 * @returns {number} - Discord color integer
 */
function resolveEmbedColor(actionConfig, context) {
  const defaultColor = actionConfig.embed_color && /^#[0-9a-fA-F]{6}$/.test(actionConfig.embed_color)
    ? parseInt(actionConfig.embed_color.slice(1), 16)
    : 0x5865F2;

  let rules = actionConfig.embed_color_rules;
  if (!rules || !Array.isArray(rules)) {
    // Try parsing if stored as JSON string
    if (typeof rules === 'string') {
      try { rules = JSON.parse(rules); } catch { return defaultColor; }
    } else {
      return defaultColor;
    }
  }

  for (const rule of rules) {
    if (!rule.variable || !rule.color || !rule.operator) continue;
    if (!/^#[0-9a-fA-F]{6}$/.test(rule.color)) continue;

    // Resolve the variable value from context using dot-path
    const parts = rule.variable.split(".");
    let actual = context;
    for (const part of parts) {
      if (actual === undefined || actual === null) { actual = undefined; break; }
      actual = actual[part];
    }
    if (actual === undefined || actual === null) continue;
    const actualStr = String(actual).toLowerCase();
    const expected = (rule.value || "").toLowerCase();

    let match = false;
    switch (rule.operator) {
      case "equals": match = actualStr === expected; break;
      case "contains": match = actualStr.includes(expected); break;
      case "starts_with": match = actualStr.startsWith(expected); break;
      case "ends_with": match = actualStr.endsWith(expected); break;
      case "not_equals": match = actualStr !== expected; break;
    }

    if (match) {
      return parseInt(rule.color.slice(1), 16);
    }
  }

  return defaultColor;
}

/**
 * Check if an event matches the automation's filters
 * @param {Object} event - The event data
 * @param {Object} filters - The filter conditions
 * @param {Object} context - Additional context (member roles, etc.)
 * @returns {boolean}
 */
export function matchesFilters(event, filters, context = {}) {
  if (!filters || Object.keys(filters).length === 0) {
    return true;
  }

  const isAllSentinel = (value) => {
    if (value === undefined || value === null) return true;
    if (typeof value !== "string") return false;
    return value.trim().toUpperCase() === "ALL";
  };

  for (const [filterType, filterValue] of Object.entries(filters)) {
    switch (filterType) {
      case "channel_id":
        // "ALL" means match any channel, comma-separated list for multiple channels
        if (filterValue !== "ALL") {
          const allowedChannels = filterValue.split(",").map((id) => id.trim());
          if (!allowedChannels.includes(event.channel_id)) return false;
        }
        break;

      case "not_channel_id":
        // "ALL" for not_channel_id doesn't make sense, skip if set to ALL
        if (filterValue !== "ALL") {
          const blockedChannels = filterValue.split(",").map((id) => id.trim());
          if (blockedChannels.includes(event.channel_id)) return false;
        }
        break;

      case "actor_has_role":
        // "ALL" means match any role (no filter), comma-separated list for multiple roles
        if (!isAllSentinel(filterValue)) {
          const requiredRoles = filterValue.split(",").map((id) => id.trim());
          // Actor must have at least one of the specified roles
          if (
            !requiredRoles.some((role) => context.actorRoles?.includes(role))
          ) return false;
        }
        break;

      case "actor_missing_role":
        // "ALL" for actor_missing_role doesn't make sense, skip if set to ALL
        if (!isAllSentinel(filterValue)) {
          const blockedRoles = filterValue.split(",").map((id) => id.trim());
          // Actor must not have any of the specified roles
          if (blockedRoles.some((role) => context.actorRoles?.includes(role))) {
            return false;
          }
        }
        break;

      case "target_has_role":
        // "ALL" means match any role (no filter), comma-separated list for multiple roles
        if (!isAllSentinel(filterValue)) {
          const requiredRoles = filterValue.split(",").map((id) => id.trim());
          // Target must have at least one of the specified roles
          if (
            !requiredRoles.some((role) => context.targetRoles?.includes(role))
          ) return false;
        }
        break;

      case "content_contains":
        if (
          !event.details?.content?.toLowerCase().includes(
            filterValue.toLowerCase(),
          )
        ) return false;
        break;

      case "content_regex":
        try {
          const regex = new RegExp(filterValue, "i");
          if (!regex.test(event.details?.content || "")) return false;
        } catch {
          return false;
        }
        break;

      case "bot_filter":
        // "any" means no filter, "only_bots" means only bots, "only_humans" means only humans
        if (filterValue === "only_bots") {
          if (event.details?.isBot !== true) return false;
        } else if (filterValue === "only_humans") {
          if (event.details?.isBot === true) return false;
        }
        // "any" or any other value means no filter
        break;

      case "actor_id":
        // Filter by specific user/bot IDs (comma-separated)
        if (filterValue !== "ALL") {
          const allowedActors = filterValue.split(",").map((id) => id.trim());
          if (!allowedActors.includes(event.actor_id)) return false;
        }
        break;

      case "not_actor_id":
        // Exclude specific user/bot IDs (comma-separated)
        if (filterValue !== "ALL") {
          const blockedActors = filterValue.split(",").map((id) => id.trim());
          if (blockedActors.includes(event.actor_id)) return false;
        }
        break;

      case "embed_contains":
        // Check if any embed contains the specified text
        if (
          !event.details?.embedTexts?.some((text) =>
            text.toLowerCase().includes(filterValue.toLowerCase())
          )
        ) return false;
        break;

      case "min_account_age_days":
        if (
          context.accountAgeDays !== undefined &&
          context.accountAgeDays < filterValue
        ) return false;
        break;

      case "max_account_age_days":
        if (
          context.accountAgeDays !== undefined &&
          context.accountAgeDays > filterValue
        ) return false;
        break;

      case "target_bot_id":
        // Filter by the bot that responded to the command
        // For SLASH_COMMAND_USE, target_id is the bot that responded
        if (filterValue && filterValue !== "ALL") {
          log.debug(`[Filter] target_bot_id: expected=${filterValue}, actual=${event.target_id}`);
          if (event.target_id !== filterValue) return false;
        }
        break;

      case "command_name":
        // Filter by the specific command used
        if (filterValue && filterValue !== "ALL" && filterValue !== "") {
          const eventCommandName = event.details?.commandName?.toLowerCase();
          log.debug(`[Filter] command_name: expected=${filterValue.toLowerCase()}, actual=${eventCommandName}`);
          if (eventCommandName !== filterValue.toLowerCase()) return false;
        }
        break;

      case "command_result":
        // Filter by command success/failure using bot registry patterns
        if (filterValue && filterValue !== "any") {
          const botId = event.target_id;
          const commandName = event.details?.commandName;
          
          // Get the detected result from bot registry patterns
          const detectedResult = detectCommandResult(botId, commandName, event.details || {});
          log.debug(`[Filter] command_result: expected=${filterValue}, detected=${detectedResult}, embedTexts=${JSON.stringify(event.details?.embedTexts)}`);
          
          if (filterValue === "success" && detectedResult !== "success") return false;
          if (filterValue === "failure" && detectedResult !== "failure") return false;
        }
        break;

      case "member_update_type":
        // Filter MEMBER_UPDATE events by what changed
        if (filterValue && filterValue !== "any") {
          if (filterValue === "rules_accepted") {
            if (event.details?.rules_accepted !== true) return false;
          } else if (filterValue === "nickname_changed") {
            if (!event.details?.nickname) return false;
          }
        }
        break;

      case "voice_from_channel_id":
        // Filter VOICE_MOVE by source channel (where user moved FROM)
        if (filterValue !== "ALL" && event.event_type === "VOICE_MOVE") {
          const allowedFromChannels = filterValue.split(",").map((id) => id.trim());
          if (!allowedFromChannels.includes(event.details?.fromChannelId)) return false;
        }
        break;

      case "voice_to_channel_id":
        // Filter VOICE_MOVE by destination channel (where user moved TO)
        if (filterValue !== "ALL" && event.event_type === "VOICE_MOVE") {
          const allowedToChannels = filterValue.split(",").map((id) => id.trim());
          if (!allowedToChannels.includes(event.channel_id)) return false;
        }
        break;

      // GitHub-specific filters
      case "github_repo":
        if (filterValue && event.details?.repo) {
          if (event.details.repo.toLowerCase() !== filterValue.toLowerCase()) return false;
        }
        break;

      case "github_action":
        if (filterValue && filterValue !== "any") {
          if (event.details?.action !== filterValue) return false;
        }
        break;

      case "github_branch":
        if (filterValue) {
          const branch = event.details?.branch || event.details?.head_branch;
          if (!branch || branch.toLowerCase() !== filterValue.toLowerCase()) return false;
        }
        break;

      case "github_workflow_conclusion":
        if (filterValue && filterValue !== "any") {
          if (event.details?.conclusion !== filterValue) return false;
        }
        break;

      case "github_repo_visibility":
        if (filterValue && filterValue !== "any") {
          const isPrivate = event.details?.repo_private === true;
          if (filterValue === "public" && isPrivate) return false;
          if (filterValue === "private" && !isPrivate) return false;
        }
        break;

      case "button_custom_id":
        // Filter BUTTON_CLICK events by button custom ID (comma-separated list)
        if (filterValue) {
          const allowedIds = filterValue.split(",").map((id) => id.trim());
          if (!allowedIds.includes(event.details?.customId)) return false;
        }
        break;
    }
  }

  return true;
}

/**
 * Build variable context from event data
 * @param {Object} event - The event data
 * @param {Object} guildInfo - Guild information
 * @returns {Object}
 */
export function buildContext(event, guildInfo = {}) {
  // For events that only have a target (e.g. VOICE_SERVER_MUTE, VOICE_SERVER_DEAFEN,
  // VOICE_STAGE_SUPPRESS) where the actor (moderator) is unknown, fall back to target
  // so {user.mention} etc. still resolve to the affected user.
  const userId = event.actor_id || event.target_id;
  const userName = event.actor_name || event.target_name;

  return {
    user: {
      id: userId,
      name: userName?.split("#")[0] || userName,
      tag: userName,
      mention: userId ? `<@${userId}>` : "",
    },
    target: {
      id: event.target_id,
      name: event.target_name?.split("#")[0] || event.target_name,
      tag: event.target_name,
      mention: event.target_id ? `<@${event.target_id}>` : "",
    },
    channel: {
      id: event.channel_id,
      name: event.channel_name,
      mention: event.channel_id ? `<#${event.channel_id}>` : "",
    },
    guild: {
      id: event.guild_id,
      name: guildInfo.name || "Unknown Server",
      member_count: guildInfo.member_count ?? "",
      human_count: guildInfo.human_count ?? "",
      bot_count: guildInfo.bot_count ?? "",
      boost_count: guildInfo.boost_count ?? "",
      boost_level: guildInfo.boost_level ?? "",
    },
    trigger: {
      event: event.event_type,
      category: event.event_category,
      time: new Date().toISOString(),
    },
    github: event.details || {},
    details: event.details || {},
    github_logo_url: "https://avatars.githubusercontent.com/u/9919?v=4",
    widget_signing_secret: event._widget_signing_secret,
    widget_origin: event._widget_origin,
  };
}

/**
 * Execute a single action
 * @param {Object} automation - The automation config
 * @param {Object} event - The event that triggered this
 * @param {Object} context - Variable context
 * @param {Object} discord - Discord client or API interface
 * @param {D1Database} [db] - Database for scheduled messages
 * @returns {Promise<{success: boolean, result?: any, error?: string}>}
 */
export async function executeAction(automation, event, context, discord, db = null) {
  const { action_type, action_config } = automation;

  try {
    switch (action_type) {
      case "DELETE_USER_MESSAGES": {
        // Enhanced version that supports multiple channels
        const channelIds = action_config.channel_ids || "ALL";
        const maxAgeDays = resolveNumberValue(
          action_config.max_age_days,
          event,
          null,
        );
        const maxMessages = resolveNumberValue(
          action_config.max_messages,
          event,
          null,
        );
        const skipPinned = action_config.skip_pinned !== false &&
          action_config.skip_pinned !== "false";
        const userId = resolveTargetUser(action_config, event);

        if (!userId) {
          return { success: false, error: "Missing user ID" };
        }

        const guild = await discord.guilds.fetch(event.guild_id).catch(() =>
          null
        );
        if (!guild) {
          return { success: false, error: "Guild not found" };
        }

        let channelsToProcess = [];

        // Handle "ALL" option or empty - get all text channels in the guild
        if (!channelIds || channelIds === "ALL") {
          const allChannels = await guild.channels.fetch();
          channelsToProcess = Array.from(allChannels.values())
            .filter((c) => c && c.isTextBased() && !c.isVoiceBased())
            .map((c) => c.id);
        } else {
          // Parse comma-separated channel IDs
          channelsToProcess = channelIds.split(",").map((id) => id.trim());
        }

        // Calculate cutoff date if max_age_days is specified
        const cutoffTime = maxAgeDays
          ? Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000)
          : null;

        let totalDeleted = 0;
        const results = {};

        for (const channelId of channelsToProcess) {
          // Stop if we've hit the max messages limit
          if (maxMessages && totalDeleted >= maxMessages) break;

          const channel = await discord.channels.fetch(channelId).catch(() =>
            null
          );
          if (!channel || !channel.messages) {
            results[channelId] = {
              error: "Channel not found or not text-based",
            };
            continue;
          }

          try {
            // Fetch messages and filter by user
            const messages = await channel.messages.fetch({ limit: 100 });
            let userMessages = messages.filter((m) => m.author.id === userId);

            // Filter by age if specified
            if (cutoffTime) {
              userMessages = userMessages.filter((m) =>
                m.createdTimestamp >= cutoffTime
              );
            }

            // Skip pinned messages if configured
            if (skipPinned) {
              userMessages = userMessages.filter((m) => !m.pinned);
            }

            // Limit to remaining quota if max_messages is set
            const remainingQuota = maxMessages
              ? maxMessages - totalDeleted
              : Infinity;
            const toDelete = Array.from(userMessages.values()).slice(
              0,
              remainingQuota,
            );

            if (toDelete.length === 0) {
              results[channelId] = { deleted: 0 };
              continue;
            }

            let deleted = 0;

            // Try bulk delete for messages < 14 days old
            const recentMessages = toDelete.filter((m) =>
              Date.now() - m.createdTimestamp < 14 * 24 * 60 * 60 * 1000
            );

            if (recentMessages.length > 1) {
              await channel.bulkDelete(recentMessages).catch((e) => log.error("[Automation] bulkDelete error:", e));
              deleted += recentMessages.length;
            } else if (recentMessages.length === 1) {
              await recentMessages[0].delete().catch(() => {});
              deleted++;
            }

            // Delete older messages individually
            const oldMessages = toDelete.filter((m) =>
              Date.now() - m.createdTimestamp >= 14 * 24 * 60 * 60 * 1000
            );

            for (const msg of oldMessages) {
              await msg.delete().catch(() => {});
              deleted++;
              // Rate limit protection
              await new Promise((r) => setTimeout(r, 500));
            }

            results[channelId] = { deleted };
            totalDeleted += deleted;
          } catch (err) {
            results[channelId] = { error: err.message || "Failed to delete" };
          }
        }

        return {
          success: true,
          result: { totalDeleted, channelResults: results },
        };
      }

      case "DELETE_MESSAGES": {
        const channelIds = action_config.channel_ids || "ALL";
        const limit = action_config.limit || 100;
        const userId = resolveTargetUser(action_config, event);

        if (!userId) {
          return { success: false, error: "Missing user ID" };
        }

        const guild = await discord.guilds.fetch(event.guild_id).catch(() =>
          null
        );
        if (!guild) {
          return { success: false, error: "Guild not found" };
        }

        let channelsToProcess = [];

        // Handle "ALL" option or empty - get all text channels in the guild
        if (!channelIds || channelIds === "ALL") {
          const allChannels = await guild.channels.fetch();
          channelsToProcess = Array.from(allChannels.values())
            .filter((c) => c && c.isTextBased() && !c.isVoiceBased())
            .map((c) => c.id);
        } else {
          // Parse comma-separated channel IDs
          channelsToProcess = channelIds.split(",").map((id) => id.trim());
        }

        let totalDeleted = 0;
        const results = {};

        for (const channelId of channelsToProcess) {
          // Stop if we've hit the max messages limit
          if (totalDeleted >= limit) break;

          const channel = await discord.channels.fetch(channelId).catch(() =>
            null
          );
          if (!channel || !channel.messages) {
            results[channelId] = {
              error: "Channel not found or not text-based",
            };
            continue;
          }

          try {
            // Fetch messages and filter by user
            const messages = await channel.messages.fetch({ limit: 100 });
            const userMessages = messages.filter((m) => m.author.id === userId);

            // Limit to remaining quota
            const remainingQuota = limit - totalDeleted;
            const toDelete = Array.from(userMessages.values()).slice(
              0,
              remainingQuota,
            );

            if (toDelete.length === 0) {
              results[channelId] = { deleted: 0 };
              continue;
            }

            let deleted = 0;

            // Try bulk delete for messages < 14 days old
            const recentMessages = toDelete.filter((m) =>
              Date.now() - m.createdTimestamp < 14 * 24 * 60 * 60 * 1000
            );

            if (recentMessages.length > 1) {
              await channel.bulkDelete(recentMessages).catch((e) => log.error("[Automation] bulkDelete error:", e));
              deleted += recentMessages.length;
            } else if (recentMessages.length === 1) {
              await recentMessages[0].delete().catch(() => {});
              deleted++;
            }

            // Delete older messages individually
            const oldMessages = toDelete.filter((m) =>
              Date.now() - m.createdTimestamp >= 14 * 24 * 60 * 60 * 1000
            );

            for (const msg of oldMessages) {
              await msg.delete().catch(() => {});
              deleted++;
              // Rate limit protection
              await new Promise((r) => setTimeout(r, 500));
            }

            results[channelId] = { deleted };
            totalDeleted += deleted;
          } catch (err) {
            results[channelId] = { error: err.message || "Failed to delete" };
          }
        }

        return {
          success: true,
          result: { totalDeleted, channelResults: results },
        };
      }

      case "SEND_MESSAGE": {
        const content = processTemplate(action_config.content, context);

        // Ephemeral: send as interaction followup visible only to the user
        if (action_config.ephemeral && event.application_id && event.interaction_token) {
          if (!content) {
            return { success: false, error: "Missing message content" };
          }
          const payload = { flags: 64 };
          if (action_config.embed) {
            const embedColor = resolveEmbedColor(action_config, context);
            const thumbnailUrl = action_config.embed_thumbnail_url ? processTemplate(action_config.embed_thumbnail_url, context) : null;
            const embed = { description: content, color: embedColor, timestamp: new Date().toISOString() };
            if (thumbnailUrl) embed.thumbnail = { url: thumbnailUrl };
            payload.embeds = [embed];
          } else {
            payload.content = content;
          }
          await sendInteractionFollowup(event.application_id, event.interaction_token, payload, event._bot_token);
          return { success: true, result: { sent: true, ephemeral: true } };
        }

        const channelId = action_config.channel_id;
        if (!channelId || !content) {
          return { success: false, error: "Missing channel or content" };
        }

        // Schedule for later if configured
        if (action_config.send_later && action_config.send_later_delay && db) {
          const embedColor = action_config.embed ? resolveEmbedColor(action_config, context) : null;
          const thumbnailUrl = action_config.embed && action_config.embed_thumbnail_url ? processTemplate(action_config.embed_thumbnail_url, context) : null;
          const result = await createScheduledMessage(db, {
            guild_id: event.guild_id,
            channel_id: channelId,
            action_type: "SEND_MESSAGE",
            message_payload: { content, embed: !!action_config.embed, embed_color: embedColor, ...(thumbnailUrl ? { embed_thumbnail_url: thumbnailUrl } : {}) },
            delay: action_config.send_later_delay,
            created_by: event.actor_id,
            source_automation_id: automation.id,
          });
          if (result.success) {
            return { success: true, result: { scheduled: true, send_at: result.send_at } };
          }
          return { success: false, error: result.error || "Failed to schedule message" };
        }

        const channel = await discord.channels.fetch(channelId).catch(() =>
          null
        );
        if (!channel) {
          return { success: false, error: "Channel not found" };
        }

        if (action_config.embed) {
          const embedColor = resolveEmbedColor(action_config, context);
          const thumbnailUrl = action_config.embed_thumbnail_url ? processTemplate(action_config.embed_thumbnail_url, context) : null;
          const embed = { description: content, color: embedColor, timestamp: new Date().toISOString() };
          if (thumbnailUrl) embed.thumbnail = { url: thumbnailUrl };
          await channel.send({ embeds: [embed] });
        } else {
          await channel.send(content);
        }

        return { success: true, result: { sent: true } };
      }

      case "SEND_MESSAGE_WITH_BUTTONS": {
        const content = processTemplate(action_config.content, context);

        // Build button components from config
        const buttonRows = action_config.buttons || [];
        const components = buildButtonComponents(buttonRows, event.guild_id, automation.id);

        // Ephemeral: send as interaction followup visible only to the user
        if (action_config.ephemeral && event.application_id && event.interaction_token) {
          if (!content) {
            return { success: false, error: "Missing message content" };
          }
          const payload = { flags: 64, components };
          if (action_config.embed) {
            const embedColor = resolveEmbedColor(action_config, context);
            const thumbnailUrl = action_config.embed_thumbnail_url ? processTemplate(action_config.embed_thumbnail_url, context) : null;
            const embed = { description: content, color: embedColor, timestamp: new Date().toISOString() };
            if (thumbnailUrl) embed.thumbnail = { url: thumbnailUrl };
            payload.embeds = [embed];
          } else {
            payload.content = content;
          }
          await sendInteractionFollowup(event.application_id, event.interaction_token, payload, event._bot_token);
          return { success: true, result: { sent: true, ephemeral: true, buttonsAttached: components.length } };
        }

        const channelId = action_config.channel_id;
        if (!channelId || !content) {
          return { success: false, error: "Missing channel or content" };
        }

        // Schedule for later if configured
        if (action_config.send_later && action_config.send_later_delay && db) {
          const embedColor = action_config.embed ? resolveEmbedColor(action_config, context) : null;
          const thumbnailUrl = action_config.embed && action_config.embed_thumbnail_url ? processTemplate(action_config.embed_thumbnail_url, context) : null;
          const result = await createScheduledMessage(db, {
            guild_id: event.guild_id,
            channel_id: channelId,
            action_type: "SEND_MESSAGE_WITH_BUTTONS",
            message_payload: {
              content,
              embed: !!action_config.embed,
              embed_color: embedColor,
              ...(thumbnailUrl ? { embed_thumbnail_url: thumbnailUrl } : {}),
              components,
            },
            delay: action_config.send_later_delay,
            created_by: event.actor_id,
            source_automation_id: automation.id,
          });
          if (result.success) {
            return { success: true, result: { scheduled: true, send_at: result.send_at, buttonsAttached: components.length } };
          }
          return { success: false, error: result.error || "Failed to schedule message" };
        }

        const channel = await discord.channels.fetch(channelId).catch(() =>
          null
        );
        if (!channel) {
          return { success: false, error: "Channel not found" };
        }

        const messagePayload = { components };

        if (action_config.embed) {
          const embedColor = resolveEmbedColor(action_config, context);
          const thumbnailUrl = action_config.embed_thumbnail_url ? processTemplate(action_config.embed_thumbnail_url, context) : null;
          const embed = { description: content, color: embedColor, timestamp: new Date().toISOString() };
          if (thumbnailUrl) embed.thumbnail = { url: thumbnailUrl };
          messagePayload.embeds = [embed];
        } else {
          messagePayload.content = content;
        }

        await channel.send(messagePayload);
        return { success: true, result: { sent: true, buttonsAttached: components.length } };
      }

      case "SEND_STATS_WIDGET_IMAGE": {
        const channelSource = action_config.channel_source || "configured";
        const channelId = channelSource === "trigger"
          ? event.channel_id
          : action_config.channel_id;
        const widgetType = action_config.widget_type || "voice_time";
        const period = action_config.period || "30d";
        const content = action_config.content
          ? processTemplate(action_config.content, context)
          : "";

        if (!channelId) {
          return {
            success: false,
            error: channelSource === "trigger"
              ? "No trigger channel available for this event"
              : "Missing channel",
          };
        }

        const channel = await discord.channels.fetch(channelId).catch(() => null);
        if (!channel) {
          return { success: false, error: "Channel not found" };
        }

        const signingSecret = context.widget_signing_secret || process.env.DISCORD_PUBLIC_KEY;
        const origin = context.widget_origin || resolveWidgetOrigin();

        const { pngData, filename, widgetInfo, periodLabel } =
          await fetchSignedWidgetPng({
            guildId: event.guild_id,
            type: widgetType,
            period,
            secret: signingSecret,
            origin,
          });

        await sendChannelImage(channel, pngData, filename, content);

        return {
          success: true,
          result: {
            sent: true,
            widgetType,
            widgetName: widgetInfo.name,
            period,
            periodLabel,
          },
        };
      }

      case "SEND_DM": {
        const userId = resolveTargetUser(action_config, event);
        const content = processTemplate(action_config.content, context);

        if (!userId) {
          return { success: false, error: "Missing target user" };
        }

        if (!content) {
          return { success: false, error: "Missing message content" };
        }

        // Schedule for later if configured
        if (action_config.send_later && action_config.send_later_delay && db) {
          const embedColor = action_config.embed ? resolveEmbedColor(action_config, context) : null;
          const thumbnailUrl = action_config.embed && action_config.embed_thumbnail_url ? processTemplate(action_config.embed_thumbnail_url, context) : null;
          const result = await createScheduledMessage(db, {
            guild_id: event.guild_id,
            target_user_id: userId,
            action_type: "SEND_DM",
            message_payload: { content, embed: !!action_config.embed, embed_color: embedColor, ...(thumbnailUrl ? { embed_thumbnail_url: thumbnailUrl } : {}) },
            delay: action_config.send_later_delay,
            created_by: event.actor_id,
            source_automation_id: automation.id,
          });
          if (result.success) {
            return { success: true, result: { scheduled: true, send_at: result.send_at, userId } };
          }
          return { success: false, error: result.error || "Failed to schedule DM" };
        }

        // Fetch the user and send a DM
        const user = await discord.users.fetch(userId).catch(() => null);
        if (!user) {
          return { success: false, error: "User not found" };
        }

        try {
          if (action_config.embed) {
            const embedColor = resolveEmbedColor(action_config, context);
            const thumbnailUrl = action_config.embed_thumbnail_url ? processTemplate(action_config.embed_thumbnail_url, context) : null;
            const embed = { description: content, color: embedColor, timestamp: new Date().toISOString() };
            if (thumbnailUrl) embed.thumbnail = { url: thumbnailUrl };
            await user.send({ embeds: [embed] });
          } else {
            await user.send(content);
          }
          return { success: true, result: { dmSent: true, userId } };
        } catch (dmError) {
          // User may have DMs disabled or blocked the bot
          return { success: false, error: `Could not send DM: ${dmError.message || "User has DMs disabled or blocked the bot"}` };
        }
      }

      case "ADD_ROLE": {
        // Support both legacy role_id (single) and new role_ids (comma-separated)
        const roleIds = action_config.role_ids
          ? action_config.role_ids.split(',').map(id => id.trim()).filter(Boolean)
          : action_config.role_id ? [action_config.role_id] : [];
        const userId = resolveTargetUser(action_config, event);

        if (roleIds.length === 0 || !userId) {
          return { success: false, error: "Missing role(s) or user ID" };
        }

        const guild = await discord.guilds.fetch(event.guild_id).catch(() =>
          null
        );
        if (!guild) {
          return { success: false, error: "Guild not found" };
        }

        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) {
          return { success: false, error: "Member not found" };
        }

        // Add all roles
        for (const roleId of roleIds) {
          await member.roles.add(roleId);
        }
        return { success: true, result: { rolesAdded: roleIds } };
      }

      case "REMOVE_ROLE": {
        // Support both legacy role_id (single) and new role_ids (comma-separated)
        const roleIds = action_config.role_ids
          ? action_config.role_ids.split(',').map(id => id.trim()).filter(Boolean)
          : action_config.role_id ? [action_config.role_id] : [];
        const userId = resolveTargetUser(action_config, event);

        if (roleIds.length === 0 || !userId) {
          return { success: false, error: "Missing role(s) or user ID" };
        }

        const guild = await discord.guilds.fetch(event.guild_id).catch(() =>
          null
        );
        if (!guild) {
          return { success: false, error: "Guild not found" };
        }

        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) {
          return { success: false, error: "Member not found" };
        }

        // Remove all roles
        for (const roleId of roleIds) {
          await member.roles.remove(roleId);
        }
        return { success: true, result: { rolesRemoved: roleIds } };
      }

      case "KICK_MEMBER": {
        const userId = resolveTargetUser(action_config, event);
        const reason = processTemplate(
          action_config.reason || "Automated action",
          context,
        );

        if (!userId) {
          return { success: false, error: "Missing user ID" };
        }

        const guild = await discord.guilds.fetch(event.guild_id).catch(() =>
          null
        );
        if (!guild) {
          return { success: false, error: "Guild not found" };
        }

        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) {
          return { success: false, error: "Member not found" };
        }

        await member.kick(reason);
        return { success: true, result: { kicked: userId } };
      }

      case "BAN_MEMBER": {
        const userId = resolveTargetUser(action_config, event);
        const reason = processTemplate(
          action_config.reason || "Automated action",
          context,
        );
        const deleteDays = action_config.delete_days || 0;

        if (!userId) {
          return { success: false, error: "Missing user ID" };
        }

        const guild = await discord.guilds.fetch(event.guild_id).catch(() =>
          null
        );
        if (!guild) {
          return { success: false, error: "Guild not found" };
        }

        await guild.members.ban(userId, {
          reason,
          deleteMessageSeconds: deleteDays * 24 * 60 * 60,
        });
        return { success: true, result: { banned: userId } };
      }

      case "TIMEOUT_MEMBER": {
        const userId = resolveTargetUser(action_config, event);
        const durationMinutes = resolveNumberValue(
          action_config.duration_minutes,
          event,
          60,
        );
        const duration = durationMinutes * 60 * 1000;
        const reason = processTemplate(
          action_config.reason || "Automated timeout",
          context,
        );

        if (!userId) {
          return { success: false, error: "Missing user ID" };
        }

        const guild = await discord.guilds.fetch(event.guild_id).catch(() =>
          null
        );
        if (!guild) {
          return { success: false, error: "Guild not found" };
        }

        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) {
          return { success: false, error: "Member not found" };
        }

        await member.timeout(duration, reason);
        return { success: true, result: { timedOut: userId, duration } };
      }

      case "SERVER_MUTE": {
        const userId = resolveTargetUser(action_config, event);
        const reason = processTemplate(
          action_config.reason || "Automated action",
          context,
        );

        if (!userId) {
          return { success: false, error: "Missing user ID" };
        }

        const guild = await discord.guilds.fetch(event.guild_id).catch(() =>
          null
        );
        if (!guild) {
          return { success: false, error: "Guild not found" };
        }

        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) {
          return { success: false, error: "Member not found" };
        }

        if (!member.voice.channelId) {
          return { success: false, error: "Member is not in a voice channel" };
        }

        await member.voice.setMute(true, reason);
        return { success: true, result: { muted: userId } };
      }

      case "SERVER_UNMUTE": {
        const userId = resolveTargetUser(action_config, event);
        const reason = processTemplate(
          action_config.reason || "Automated action",
          context,
        );

        if (!userId) {
          return { success: false, error: "Missing user ID" };
        }

        const guild = await discord.guilds.fetch(event.guild_id).catch(() =>
          null
        );
        if (!guild) {
          return { success: false, error: "Guild not found" };
        }

        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) {
          return { success: false, error: "Member not found" };
        }

        if (!member.voice.channelId) {
          return { success: false, error: "Member is not in a voice channel" };
        }

        await member.voice.setMute(false, reason);
        return { success: true, result: { unmuted: userId } };
      }

      case "SERVER_DEAFEN": {
        const userId = resolveTargetUser(action_config, event);
        const reason = processTemplate(
          action_config.reason || "Automated action",
          context,
        );

        if (!userId) {
          return { success: false, error: "Missing user ID" };
        }

        const guild = await discord.guilds.fetch(event.guild_id).catch(() =>
          null
        );
        if (!guild) {
          return { success: false, error: "Guild not found" };
        }

        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) {
          return { success: false, error: "Member not found" };
        }

        if (!member.voice.channelId) {
          return { success: false, error: "Member is not in a voice channel" };
        }

        await member.voice.setDeaf(true, reason);
        return { success: true, result: { deafened: userId } };
      }

      case "SERVER_UNDEAFEN": {
        const userId = resolveTargetUser(action_config, event);
        const reason = processTemplate(
          action_config.reason || "Automated action",
          context,
        );

        if (!userId) {
          return { success: false, error: "Missing user ID" };
        }

        const guild = await discord.guilds.fetch(event.guild_id).catch(() =>
          null
        );
        if (!guild) {
          return { success: false, error: "Guild not found" };
        }

        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) {
          return { success: false, error: "Member not found" };
        }

        if (!member.voice.channelId) {
          return { success: false, error: "Member is not in a voice channel" };
        }

        await member.voice.setDeaf(false, reason);
        return { success: true, result: { undeafened: userId } };
      }

      case "LOG_TO_CHANNEL": {
        const channelId = action_config.channel_id;
        const customContent = action_config.content
          ? processTemplate(action_config.content, context)
          : null;

        if (!channelId) {
          return { success: false, error: "Missing channel ID" };
        }

        const channel = await discord.channels.fetch(channelId).catch(() =>
          null
        );
        if (!channel) {
          return { success: false, error: "Channel not found" };
        }

        const embed = {
          title: `🤖 Automation: ${automation.name}`,
          description: customContent || `Triggered by **${event.event_type}**`,
          color: 0x5865F2,
          fields: [],
          timestamp: new Date().toISOString(),
          footer: { text: `Automation ID: ${automation.id}` },
        };

        if (event.actor_id) {
          embed.fields.push({
            name: "Actor",
            value: `<@${event.actor_id}> (${event.actor_name || "Unknown"})`,
            inline: true,
          });
        }

        if (event.target_id) {
          embed.fields.push({
            name: "Target",
            value: `<@${event.target_id}> (${event.target_name || "Unknown"})`,
            inline: true,
          });
        }

        if (event.channel_id) {
          embed.fields.push({
            name: "Channel",
            value: `<#${event.channel_id}>`,
            inline: true,
          });
        }

        if (action_config.include_details && event.details) {
          const detailsStr = Object.entries(event.details)
            .filter(([_, v]) => v !== null && v !== undefined)
            .map(([k, v]) =>
              `**${k}:** ${typeof v === "object" ? JSON.stringify(v) : v}`
            )
            .join("\n");

          if (detailsStr) {
            embed.fields.push({
              name: "Details",
              value: detailsStr.substring(0, 1024),
            });
          }
        }

        await channel.send({ embeds: [embed] });
        return { success: true, result: { logged: true } };
      }

      case "CREATE_THREAD": {
        const channelId = action_config.channel_id;
        const threadName = processTemplate(action_config.thread_name, context);
        const autoArchive = action_config.auto_archive_duration || 1440;

        if (!channelId || !threadName) {
          return { success: false, error: "Missing channel or thread name" };
        }

        const channel = await discord.channels.fetch(channelId).catch(() =>
          null
        );
        if (!channel) {
          return { success: false, error: "Channel not found" };
        }

        const thread = await channel.threads.create({
          name: threadName.substring(0, 100),
          autoArchiveDuration: autoArchive,
        });

        return { success: true, result: { threadId: thread.id } };
      }

      case "ADD_REACTION": {
        const emoji = action_config.emoji;
        const messageId = event.details?.messageId;
        const channelId = event.channel_id;

        if (!emoji) {
          return { success: false, error: "Missing emoji" };
        }

        if (!messageId) {
          return { success: false, error: "No message ID available - this action requires a message event" };
        }

        if (!channelId) {
          return { success: false, error: "No channel ID available" };
        }

        const channel = await discord.channels.fetch(channelId).catch(() => null);
        if (!channel) {
          return { success: false, error: "Channel not found" };
        }

        const message = await channel.messages.fetch(messageId).catch(() => null);
        if (!message) {
          return { success: false, error: "Message not found" };
        }

        // Handle custom emoji format (e.g., <:name:id> or just the emoji)
        await message.react(emoji.trim());
        return { success: true, result: { reacted: emoji, messageId } };
      }

      case "CALL_WEBHOOK": {
        const webhookId = action_config.webhook_id;
        const customPayload = action_config.payload_template;
        const includeEventData = action_config.include_event_data !== false;

        if (!webhookId) {
          return { success: false, error: "Missing webhook ID" };
        }

        // Fetch the webhook configuration from the database
        // We need the database reference - it's passed via context
        const db = context.db;
        if (!db) {
          return { success: false, error: "Database not available for webhook lookup" };
        }

        const webhook = await getWebhook(db, parseInt(webhookId), event.guild_id);
        if (!webhook) {
          return { success: false, error: "Webhook not found or not configured" };
        }

        if (!webhook.enabled) {
          return { success: false, error: "Webhook is disabled" };
        }

        // Build the payload
        let payload = {};

        // Include event data if enabled
        if (includeEventData) {
          payload = {
            event_type: event.event_type,
            guild_id: event.guild_id,
            guild_name: context.guild_name,
            actor_id: event.actor_id,
            actor_name: event.actor_name,
            target_id: event.target_id,
            target_name: event.target_name,
            channel_id: event.channel_id,
            timestamp: new Date().toISOString(),
            automation: {
              id: automation.id,
              name: automation.name,
            },
            details: event.details || {},
            options: event.options || {},
          };
        }

        // Merge custom payload if provided
        if (customPayload) {
          try {
            // Process template variables in the payload
            const processedPayload = processTemplate(
              typeof customPayload === "string" ? customPayload : JSON.stringify(customPayload),
              context
            );
            const parsedCustom = JSON.parse(processedPayload);
            payload = { ...payload, ...parsedCustom };
          } catch (parseError) {
            log.warn("[Webhook] Failed to parse custom payload:", parseError);
            // Continue with just the event data if custom payload fails
          }
        }

        // Call the webhook
        const result = await callWebhook(webhook, payload);

        if (!result.success) {
          return { success: false, error: result.error || "Webhook call failed" };
        }

        return {
          success: true,
          result: {
            webhook: webhook.name,
            status: result.status,
            response: result.response,
          },
        };
      }

      default:
        return { success: false, error: `Unknown action type: ${action_type}` };
    }
  } catch (error) {
    log.error(`Action execution error (${action_type}):`, error);
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Process an event and execute matching automations
 * @param {Object} event - The event data
 * @param {D1Database} db - Database connection
 * @param {Object} discord - Discord client
 * @param {Object} guildInfo - Guild information
 * @param {Object} filterContext - Additional context for filtering (roles, etc.)
 * @returns {Promise<{executed: number, errors: number}>}
 */
export async function processAutomations(
  event,
  db,
  discord,
  guildInfo = {},
  filterContext = {},
) {
  const startTime = Date.now();
  let executed = 0;
  let errors = 0;

  try {
    // Get all enabled automations for this event type
    const automations = await getTriggeredAutomations(
      db,
      event.guild_id,
      event.event_type,
    );

    if (automations.length === 0) {
      return { executed: 0, errors: 0 };
    }

    log.debug(
      `[Automation] Found ${automations.length} automations for ${event.event_type}`,
    );

    for (const automation of automations) {
      // Check if event matches filters
      if (!matchesFilters(event, automation.trigger_filters, filterContext)) {
        log.debug(
          `[Automation] ${automation.name} - filters not matched, skipping`,
        );
        continue;
      }

      const actionStart = Date.now();
      const context = buildContext(event, guildInfo);

      // Check if this automation has stacked actions
      const actionsToExecute = [];
      if (
        automation.action_config?.actions &&
        Array.isArray(automation.action_config.actions)
      ) {
        // New format: multiple stacked actions
        for (const action of automation.action_config.actions) {
          actionsToExecute.push({
            action_type: action.type,
            action_config: action.config || {},
          });
        }
      } else {
        // Legacy format: single action
        actionsToExecute.push({
          action_type: automation.action_type,
          action_config: automation.action_config || {},
        });
      }

      // Execute all actions in sequence
      const actionResults = [];
      let allSuccess = true;
      let firstError = null;

      for (let i = 0; i < actionsToExecute.length; i++) {
        const actionDef = actionsToExecute[i];
        const actionAutomation = {
          ...automation,
          action_type: actionDef.action_type,
          action_config: actionDef.action_config,
        };

        const result = await executeAction(
          actionAutomation,
          event,
          context,
          discord,
          db,
        );
        actionResults.push({
          actionIndex: i,
          actionType: actionDef.action_type,
          actionConfig: actionDef.action_config,
          ...result,
        });

        if (!result.success) {
          allSuccess = false;
          if (!firstError) firstError = result.error;
          log.error(
            `[Automation] ${automation.name} - action ${
              i + 1
            }/${actionsToExecute.length} (${actionDef.action_type}) failed: ${result.error}`,
          );
          // Continue executing remaining actions even if one fails
        } else {
          log.debug(
            `[Automation] ${automation.name} - action ${
              i + 1
            }/${actionsToExecute.length} (${actionDef.action_type}) succeeded`,
          );
        }
      }

      // Log the execution
      await logAutomationExecution(db, {
        automation_id: automation.id,
        guild_id: event.guild_id,
        trigger_event: event.event_type,
        trigger_data: event,
        action_result: actionResults,
        success: allSuccess,
        error_message: firstError,
        execution_time_ms: Date.now() - actionStart,
      });

      if (allSuccess) {
        executed++;
        log.info(
          `[Automation] ${automation.name} - all ${actionsToExecute.length} action(s) executed successfully`,
        );
      } else {
        errors++;
        log.error(
          `[Automation] ${automation.name} - completed with errors`,
        );
      }
    }
  } catch (error) {
    log.error("[Automation] Processing error:", error);
    errors++;
  }

  const totalTime = Date.now() - startTime;
  if (executed > 0 || errors > 0) {
    log.info(
      `[Automation] Processed ${executed} automations with ${errors} errors in ${totalTime}ms`,
    );
  }

  return { executed, errors };
}

/**
 * Discord button styles mapping
 */
const BUTTON_STYLES = {
  primary: 1,
  secondary: 2,
  success: 3,
  danger: 4,
  link: 5,
};

/**
 * Build Discord message components (action rows with buttons) from button config
 * Custom IDs encode: sb_{guildId}_{automationId}_{buttonId}
 * This allows the gateway to route button clicks to the right action sequence
 * @param {Array} buttonRows - Array of row arrays, each containing button configs
 * @param {string} guildId - Guild ID for routing
 * @param {number|string} sourceId - Automation or command ID
 * @returns {Array} Discord API components array
 */
export function buildButtonComponents(buttonRows, guildId, sourceId) {
  if (!buttonRows || !Array.isArray(buttonRows)) return [];

  const components = [];
  // buttonRows is an array of rows, each row is an array of buttons
  const rows = Array.isArray(buttonRows[0]) ? buttonRows : [buttonRows];

  for (const row of rows.slice(0, 5)) { // Max 5 action rows
    const actionRow = {
      type: 1, // ACTION_ROW
      components: [],
    };

    for (const btn of row.slice(0, 5)) { // Max 5 buttons per row
      if (!btn || !btn.label) continue;

      const style = typeof btn.style === 'number'
        ? btn.style
        : (BUTTON_STYLES[btn.style] || 2);

      const button = {
        type: 2, // BUTTON
        style,
        label: btn.label,
      };

      if (btn.emoji) {
        // Handle both unicode emoji and custom emoji format
        if (btn.emoji.includes(':')) {
          const match = btn.emoji.match(/<?(a)?:(\w+):(\d+)>?/);
          if (match) {
            button.emoji = { name: match[2], id: match[3], animated: !!match[1] };
          }
        } else {
          button.emoji = { name: btn.emoji };
        }
      }

      if (style === 5 && btn.url) {
        // Link buttons use URL instead of custom_id
        button.url = btn.url;
      } else {
        // Interactive buttons use custom_id for routing
        button.custom_id = `sb_${guildId}_${sourceId}_${btn.id || btn.label.replace(/\s+/g, '_').toLowerCase()}`;
      }

      if (btn.disabled) {
        button.disabled = true;
      }

      actionRow.components.push(button);
    }

    if (actionRow.components.length > 0) {
      components.push(actionRow);
    }
  }

  return components;
}

/**
 * Create automation engine that can be attached to a Discord client
 * @param {D1Database} db - Database connection
 * @returns {Function} - Event handler function
 */
export function createAutomationEngine(db) {
  return async function handleEvent(
    event,
    discord,
    guildInfo = {},
    filterContext = {},
  ) {
    return processAutomations(event, db, discord, guildInfo, filterContext);
  };
}
