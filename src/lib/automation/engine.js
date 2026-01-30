/**
 * Automation Engine
 * Processes events and executes matching automations
 */

import {
  getTriggeredAutomations,
  logAutomationExecution,
} from "../db/automations.js";

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

    for (const part of parts) {
      if (value === undefined || value === null) return match;
      value = value[part];
    }

    return value !== undefined && value !== null ? String(value) : match;
  });
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
        if (filterValue !== "ALL") {
          const requiredRoles = filterValue.split(",").map((id) => id.trim());
          // Actor must have at least one of the specified roles
          if (
            !requiredRoles.some((role) => context.actorRoles?.includes(role))
          ) return false;
        }
        break;

      case "actor_missing_role":
        // "ALL" for actor_missing_role doesn't make sense, skip if set to ALL
        if (filterValue !== "ALL") {
          const blockedRoles = filterValue.split(",").map((id) => id.trim());
          // Actor must not have any of the specified roles
          if (blockedRoles.some((role) => context.actorRoles?.includes(role))) {
            return false;
          }
        }
        break;

      case "target_has_role":
        // "ALL" means match any role (no filter), comma-separated list for multiple roles
        if (filterValue !== "ALL") {
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
  return {
    user: {
      id: event.actor_id,
      name: event.actor_name?.split("#")[0] || event.actor_name,
      tag: event.actor_name,
      mention: event.actor_id ? `<@${event.actor_id}>` : "",
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
    },
    trigger: {
      event: event.event_type,
      category: event.event_category,
      time: new Date().toISOString(),
    },
    details: event.details || {},
  };
}

/**
 * Execute a single action
 * @param {Object} automation - The automation config
 * @param {Object} event - The event that triggered this
 * @param {Object} context - Variable context
 * @param {Object} discord - Discord client or API interface
 * @returns {Promise<{success: boolean, result?: any, error?: string}>}
 */
export async function executeAction(automation, event, context, discord) {
  const { action_type, action_config } = automation;

  try {
    switch (action_type) {
      case "DELETE_USER_MESSAGES": {
        // Enhanced version that supports multiple channels
        const channelIds = action_config.channel_ids || "ALL";
        const maxAgeDays = action_config.max_age_days
          ? parseInt(action_config.max_age_days)
          : null;
        const maxMessages = action_config.max_messages
          ? parseInt(action_config.max_messages)
          : null;
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
          channelsToProcess = allChannels
            .filter((c) => c.isTextBased() && !c.isVoiceBased())
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
              await channel.bulkDelete(recentMessages).catch(console.error);
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
          channelsToProcess = allChannels
            .filter((c) => c.isTextBased() && !c.isVoiceBased())
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
              await channel.bulkDelete(recentMessages).catch(console.error);
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
        const channelId = action_config.channel_id;
        const content = processTemplate(action_config.content, context);

        if (!channelId || !content) {
          return { success: false, error: "Missing channel or content" };
        }

        const channel = await discord.channels.fetch(channelId).catch(() =>
          null
        );
        if (!channel) {
          return { success: false, error: "Channel not found" };
        }

        if (action_config.embed) {
          await channel.send({
            embeds: [{
              description: content,
              color: 0x5865F2,
              timestamp: new Date().toISOString(),
            }],
          });
        } else {
          await channel.send(content);
        }

        return { success: true, result: { sent: true } };
      }

      case "ADD_ROLE": {
        const roleId = action_config.role_id;
        const userId = resolveTargetUser(action_config, event);

        if (!roleId || !userId) {
          return { success: false, error: "Missing role or user ID" };
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

        await member.roles.add(roleId);
        return { success: true, result: { roleAdded: roleId } };
      }

      case "REMOVE_ROLE": {
        const roleId = action_config.role_id;
        const userId = resolveTargetUser(action_config, event);

        if (!roleId || !userId) {
          return { success: false, error: "Missing role or user ID" };
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

        await member.roles.remove(roleId);
        return { success: true, result: { roleRemoved: roleId } };
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
        const duration = (action_config.duration_minutes || 60) * 60 * 1000;
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

      default:
        return { success: false, error: `Unknown action type: ${action_type}` };
    }
  } catch (error) {
    console.error(`Action execution error (${action_type}):`, error);
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

    console.log(
      `[Automation] Found ${automations.length} automations for ${event.event_type}`,
    );

    for (const automation of automations) {
      // Check if event matches filters
      if (!matchesFilters(event, automation.trigger_filters, filterContext)) {
        console.log(
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
        );
        actionResults.push({
          actionIndex: i,
          actionType: actionDef.action_type,
          ...result,
        });

        if (!result.success) {
          allSuccess = false;
          if (!firstError) firstError = result.error;
          console.error(
            `[Automation] ${automation.name} - action ${
              i + 1
            }/${actionsToExecute.length} (${actionDef.action_type}) failed: ${result.error}`,
          );
          // Continue executing remaining actions even if one fails
        } else {
          console.log(
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
        console.log(
          `[Automation] ${automation.name} - all ${actionsToExecute.length} action(s) executed successfully`,
        );
      } else {
        errors++;
        console.error(
          `[Automation] ${automation.name} - completed with errors`,
        );
      }
    }
  } catch (error) {
    console.error("[Automation] Processing error:", error);
    errors++;
  }

  const totalTime = Date.now() - startTime;
  if (executed > 0 || errors > 0) {
    console.log(
      `[Automation] Processed ${executed} automations with ${errors} errors in ${totalTime}ms`,
    );
  }

  return { executed, errors };
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
