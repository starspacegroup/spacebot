/**
 * Discord Gateway Bot Service
 * Captures all Discord events and logs them to the database
 * Processes automations when events are triggered
 *
 * This runs as a separate process alongside the SvelteKit app
 * Start with: node src/lib/discord/gateway.js
 */

import "dotenv/config";
import {
  Client,
  Events,
  GatewayIntentBits,
  MessageType,
  Partials,
} from "discord.js";
import { log } from "../log.js";

// For local development, we'll use a REST endpoint to log events
const API_BASE = process.env.API_BASE || "http://localhost:4269";

// Store reference to the client for automation execution
let discordClient = null;

/**
 * Resolve a number value from action config
 * Supports static values or command option references (option:<optionName>)
 * @param {string|number} configValue - The config value (static or option ref)
 * @param {Object} event - The event data (contains option values)
 * @param {number|null} defaultValue - Default value if not resolvable
 * @returns {number|null} - The resolved number or default
 */
function resolveNumberValue(configValue, event, defaultValue = null) {
  if (configValue === undefined || configValue === null || configValue === "") {
    return defaultValue;
  }
  if (typeof configValue === "number") {
    return configValue;
  }
  if (typeof configValue === "string") {
    if (configValue.startsWith("option:")) {
      const optionName = configValue.substring(7);
      if (event.options?.[optionName] !== undefined) {
        const val = parseFloat(event.options[optionName]);
        return isNaN(val) ? defaultValue : val;
      }
      if (event[`option_${optionName}`] !== undefined) {
        const val = parseFloat(event[`option_${optionName}`]);
        return isNaN(val) ? defaultValue : val;
      }
      return defaultValue;
    }
    const parsed = parseFloat(configValue);
    return isNaN(parsed) ? defaultValue : parsed;
  }
  return defaultValue;
}

/**
 * Log event via API and process automations
 * @param {Object} event - The event data to log
 */
async function logEventViaAPI(event) {
  const url = `${API_BASE}/api/logs/create`;
  log.debug(`[DEBUG] Posting to ${url}`);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      },
      body: JSON.stringify(event),
    });

    log.debug(`[DEBUG] Response status: ${response.status}`);
    if (!response.ok) {
      const errorBody = await response.text();
      log.error(
        `Failed to log event via API: ${response.status} - ${errorBody}`,
      );
    } else {
      log.debug(`[DEBUG] Event logged successfully`);
    }
  } catch (error) {
    log.error("Error logging event:", error.message);
  }

  // Process automations for this event
  await processEventAutomations(event);
}

/**
 * Process automations for an event via API
 * The API handles database access and returns actions to execute
 * @param {Object} event - The event data
 */
async function processEventAutomations(event) {
  if (!discordClient) return;

  try {
    const url = `${API_BASE}/api/automations/${event.guild_id}/process`;
    log.debug(`[Automation] Calling ${url} for event ${event.event_type}`);
    
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      },
      body: JSON.stringify({ event }),
    });

    log.debug(`[Automation] API response status: ${response.status}`);

    if (!response.ok) {
      if (response.status !== 404) {
        const errorText = await response.text();
        log.error(`[Automation] API error: ${response.status} - ${errorText}`);
      }
      return;
    }

    const data = await response.json();
    const { automations } = data;
    
    log.debug(`[Automation] Received ${automations?.length || 0} automations`);

    if (!automations || automations.length === 0) {
      return;
    }

    log.debug(
      `[Automation] Processing ${automations.length} automations for ${event.event_type}`,
    );

    for (const automation of automations) {
      // Debug: log what we received
      log.debug(`[Automation] ${automation.name} action_type: ${automation.action_type}`);
      log.debug(`[Automation] ${automation.name} has actions: ${!!automation.action_config?.actions}`);
      if (automation.action_config?.actions) {
        log.debug(`[Automation] ${automation.name} actions count: ${automation.action_config.actions.length}`);
        for (const action of automation.action_config.actions) {
          log.debug(`[Automation] - Action: ${action.type}, content: ${action.config?.content}`);
        }
      }
      
      try {
        // Check if this automation has stacked actions
        if (
          automation.action_config?.actions &&
          Array.isArray(automation.action_config.actions)
        ) {
          // Execute each stacked action in sequence
          for (const action of automation.action_config.actions) {
            const actionAutomation = {
              ...automation,
              action_type: action.type,
              action_config: action.config || {},
              // Templates are already processed in the API response
              processed_content: action.config?.content,
              processed_reason: action.config?.reason,
              processed_thread_name: action.config?.thread_name,
            };
            await executeAutomationAction(actionAutomation, event);
          }
        } else {
          // Legacy single action format
          await executeAutomationAction(automation, event);
        }

        // Report success back to API
        await fetch(`${API_BASE}/api/automations/${event.guild_id}/log`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bot ${process.env.DISCORD_BOT_TOKEN}`,
          },
          body: JSON.stringify({
            automation_id: automation.id,
            trigger_event: event.event_type,
            trigger_data: event,
            success: true,
            action_result: { executed: true },
          }),
        });

        log.info(`[Automation] ${automation.name} executed successfully`);
      } catch (error) {
        log.error(`[Automation] ${automation.name} failed:`, error.message);

        // Report failure back to API
        await fetch(`${API_BASE}/api/automations/${event.guild_id}/log`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bot ${process.env.DISCORD_BOT_TOKEN}`,
          },
          body: JSON.stringify({
            automation_id: automation.id,
            trigger_event: event.event_type,
            trigger_data: event,
            success: false,
            error_message: error.message,
          }),
        });
      }
    }
  } catch (error) {
    log.error("[Automation] Processing error:", error.message);
  }
}

/**
 * Execute an automation action using the Discord client
 * @param {Object} automation - The automation configuration
 * @param {Object} event - The triggering event
 */
async function executeAutomationAction(automation, event) {
  const { action_type, action_config, context } = automation;
  const client = discordClient;

  if (!client) {
    throw new Error("Discord client not available");
  }

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
      const userId = event.actor_id;

      if (!userId) {
        throw new Error("Missing user ID");
      }

      const guild = await client.guilds.fetch(event.guild_id);
      if (!guild) throw new Error("Guild not found");

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

      log.info(
        `[Automation] Deleting messages from ${userId} in ${channelsToProcess.length} channel(s)` +
          (maxAgeDays ? ` (last ${maxAgeDays} days)` : "") +
          (maxMessages ? ` (max ${maxMessages})` : ""),
      );

      let totalDeleted = 0;

      for (const channelId of channelsToProcess) {
        // Stop if we've hit the max messages limit
        if (maxMessages && totalDeleted >= maxMessages) break;

        const channel = await client.channels.fetch(channelId).catch(() =>
          null
        );
        if (!channel || !channel.messages) continue;

        try {
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

          if (toDelete.length === 0) continue;

          // Try bulk delete for recent messages
          const recentMessages = toDelete.filter((m) =>
            Date.now() - m.createdTimestamp < 14 * 24 * 60 * 60 * 1000
          );

          if (recentMessages.length > 1) {
            await channel.bulkDelete(recentMessages);
          } else if (recentMessages.length === 1) {
            await recentMessages[0].delete();
          }

          // Delete older messages individually
          const oldMessages = toDelete.filter((m) =>
            Date.now() - m.createdTimestamp >= 14 * 24 * 60 * 60 * 1000
          );

          for (const msg of oldMessages) {
            await msg.delete().catch(() => {});
            await new Promise((r) => setTimeout(r, 500));
          }

          totalDeleted += toDelete.length;
          log.info(
            `[Automation] Deleted ${toDelete.length} messages in #${channel.name}`,
          );
        } catch (err) {
          log.error(
            `[Automation] Error deleting in ${channelId}:`,
            err.message,
          );
        }
      }

      log.info(`[Automation] Total deleted: ${totalDeleted} messages`);
      break;
    }

    case "DELETE_MESSAGES": {
      const channelId = action_config.channel_id;
      const limit = action_config.limit || 100;
      const userId = event.actor_id;

      if (!channelId || !userId) {
        throw new Error("Missing channel or user ID");
      }

      const channel = await client.channels.fetch(channelId);
      if (!channel) throw new Error("Channel not found");

      // Fetch messages and filter by user
      const messages = await channel.messages.fetch({ limit: 100 });
      const userMessages = messages.filter((m) => m.author.id === userId);
      const toDelete = Array.from(userMessages.values()).slice(0, limit);

      // Try bulk delete for recent messages
      const recentMessages = toDelete.filter((m) =>
        Date.now() - m.createdTimestamp < 14 * 24 * 60 * 60 * 1000
      );

      if (recentMessages.length > 1) {
        await channel.bulkDelete(recentMessages);
      } else if (recentMessages.length === 1) {
        await recentMessages[0].delete();
      }

      // Delete older messages individually
      const oldMessages = toDelete.filter((m) =>
        Date.now() - m.createdTimestamp >= 14 * 24 * 60 * 60 * 1000
      );

      for (const msg of oldMessages) {
        await msg.delete().catch(() => {});
        await new Promise((r) => setTimeout(r, 500));
      }
      break;
    }

    case "SEND_MESSAGE": {
      const channelId = action_config.channel_id;
      const content = automation.processed_content || action_config.content;

      log.debug(`[SEND_MESSAGE] channelId: ${channelId}, content: ${content}`);
      log.debug(`[SEND_MESSAGE] action_config:`, JSON.stringify(action_config));

      if (!channelId || !content) throw new Error(`Missing channel or content - channelId: ${channelId}, content: ${content}`);

      const channel = await client.channels.fetch(channelId);
      if (!channel) throw new Error("Channel not found");

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
      break;
    }

    case "ADD_ROLE": {
      const roleId = action_config.role_id;
      const userId = event.actor_id || event.target_id;

      if (!roleId || !userId) throw new Error("Missing role or user ID");

      const guild = await client.guilds.fetch(event.guild_id);
      if (!guild) throw new Error("Guild not found");

      const member = await guild.members.fetch(userId);
      if (!member) throw new Error("Member not found");

      await member.roles.add(roleId);
      break;
    }

    case "REMOVE_ROLE": {
      const roleId = action_config.role_id;
      const userId = event.actor_id || event.target_id;

      if (!roleId || !userId) throw new Error("Missing role or user ID");

      const guild = await client.guilds.fetch(event.guild_id);
      if (!guild) throw new Error("Guild not found");

      const member = await guild.members.fetch(userId);
      if (!member) throw new Error("Member not found");

      await member.roles.remove(roleId);
      break;
    }

    case "KICK_MEMBER": {
      const userId = event.actor_id || event.target_id;
      const reason = automation.processed_reason || action_config.reason ||
        "Automated action";

      if (!userId) throw new Error("Missing user ID");

      const guild = await client.guilds.fetch(event.guild_id);
      if (!guild) throw new Error("Guild not found");

      const member = await guild.members.fetch(userId);
      if (!member) throw new Error("Member not found");

      await member.kick(reason);
      break;
    }

    case "BAN_MEMBER": {
      const userId = event.actor_id || event.target_id;
      const reason = automation.processed_reason || action_config.reason ||
        "Automated action";
      const deleteDays = action_config.delete_days || 0;

      if (!userId) throw new Error("Missing user ID");

      const guild = await client.guilds.fetch(event.guild_id);
      if (!guild) throw new Error("Guild not found");

      await guild.members.ban(userId, {
        reason,
        deleteMessageSeconds: deleteDays * 24 * 60 * 60,
      });
      break;
    }

    case "TIMEOUT_MEMBER": {
      const userId = event.actor_id || event.target_id;
      const durationMinutes = resolveNumberValue(
        action_config.duration_minutes,
        event,
        60,
      );
      const duration = durationMinutes * 60 * 1000;
      const reason = automation.processed_reason || action_config.reason ||
        "Automated timeout";

      if (!userId) throw new Error("Missing user ID");

      const guild = await client.guilds.fetch(event.guild_id);
      if (!guild) throw new Error("Guild not found");

      const member = await guild.members.fetch(userId);
      if (!member) throw new Error("Member not found");

      await member.timeout(duration, reason);
      break;
    }

    case "LOG_TO_CHANNEL": {
      const channelId = action_config.channel_id;
      const customContent = automation.processed_content;

      if (!channelId) throw new Error("Missing channel ID");

      const channel = await client.channels.fetch(channelId);
      if (!channel) throw new Error("Channel not found");

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
      break;
    }

    case "CREATE_THREAD": {
      const channelId = action_config.channel_id;
      const threadName = automation.processed_thread_name ||
        action_config.thread_name;
      const autoArchive = action_config.auto_archive_duration || 1440;

      if (!channelId || !threadName) {
        throw new Error("Missing channel or thread name");
      }

      const channel = await client.channels.fetch(channelId);
      if (!channel) throw new Error("Channel not found");

      await channel.threads.create({
        name: threadName.substring(0, 100),
        autoArchiveDuration: autoArchive,
      });
      break;
    }

    default:
      throw new Error(`Unknown action type: ${action_type}`);
  }
}

/**
 * Create the Discord client with all necessary intents
 */
function createClient() {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.GuildEmojisAndStickers,
      GatewayIntentBits.GuildIntegrations,
      GatewayIntentBits.GuildWebhooks,
      GatewayIntentBits.GuildInvites,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildPresences,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.GuildMessageTyping,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.DirectMessageReactions,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildScheduledEvents,
      GatewayIntentBits.AutoModerationConfiguration,
      GatewayIntentBits.AutoModerationExecution,
    ],
    partials: [
      Partials.Channel,
      Partials.Message,
      Partials.Reaction,
      Partials.User,
      Partials.GuildMember,
    ],
  });
}

/**
 * Set up all event handlers
 */
function setupEventHandlers(client, logFn) {
  // ===== MEMBER EVENTS =====

  client.on(Events.GuildMemberAdd, async (member) => {
    await logFn({
      guild_id: member.guild.id,
      event_type: "MEMBER_JOIN",
      event_category: "member",
      actor_id: member.user.id,
      actor_name: member.user.tag,
      details: {
        accountCreated: member.user.createdAt?.toISOString(),
        bot: member.user.bot,
        joinedAt: member.joinedAt?.toISOString(),
      },
    });
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    await logFn({
      guild_id: member.guild.id,
      event_type: "MEMBER_LEAVE",
      event_category: "member",
      actor_id: member.user.id,
      actor_name: member.user.tag,
      details: {
        roles: member.roles?.cache.map((r) => r.name) || [],
        joinedAt: member.joinedAt?.toISOString(),
      },
    });
  });

  client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    const changes = {};

    if (oldMember.nickname !== newMember.nickname) {
      changes.nickname = { old: oldMember.nickname, new: newMember.nickname };
    }

    const oldRoles = oldMember.roles?.cache.map((r) => r.id) || [];
    const newRoles = newMember.roles?.cache.map((r) => r.id) || [];
    const addedRoles = newRoles.filter((r) => !oldRoles.includes(r));
    const removedRoles = oldRoles.filter((r) => !newRoles.includes(r));

    if (addedRoles.length > 0) {
      for (const roleId of addedRoles) {
        const role = newMember.guild.roles.cache.get(roleId);
        await logFn({
          guild_id: newMember.guild.id,
          event_type: "MEMBER_ROLE_ADD",
          event_category: "role",
          target_id: newMember.user.id,
          target_name: newMember.user.tag,
          details: {
            roleId: roleId,
            roleName: role?.name || "Unknown",
          },
        });
      }
    }

    if (removedRoles.length > 0) {
      for (const roleId of removedRoles) {
        const role = oldMember.guild.roles.cache.get(roleId);
        await logFn({
          guild_id: newMember.guild.id,
          event_type: "MEMBER_ROLE_REMOVE",
          event_category: "role",
          target_id: newMember.user.id,
          target_name: newMember.user.tag,
          details: {
            roleId: roleId,
            roleName: role?.name || "Unknown",
          },
        });
      }
    }

    if (Object.keys(changes).length > 0) {
      await logFn({
        guild_id: newMember.guild.id,
        event_type: "MEMBER_UPDATE",
        event_category: "member",
        target_id: newMember.user.id,
        target_name: newMember.user.tag,
        details: changes,
      });
    }
  });

  // ===== MODERATION EVENTS =====

  client.on(Events.GuildBanAdd, async (ban) => {
    await logFn({
      guild_id: ban.guild.id,
      event_type: "MEMBER_BAN",
      event_category: "moderation",
      target_id: ban.user.id,
      target_name: ban.user.tag,
      details: {
        reason: ban.reason || "No reason provided",
      },
    });
  });

  client.on(Events.GuildBanRemove, async (ban) => {
    await logFn({
      guild_id: ban.guild.id,
      event_type: "MEMBER_UNBAN",
      event_category: "moderation",
      target_id: ban.user.id,
      target_name: ban.user.tag,
    });
  });

  // ===== MESSAGE EVENTS =====

  client.on(Events.MessageCreate, async (message) => {
    log.debug(
      `[DEBUG] MessageCreate received from ${message.author?.tag} in ${
        message.guild?.name || "DM"
      }`,
    );
    if (!message.guild) return;

    log.debug(`[DEBUG] Logging message event for guild ${message.guild.id}`);
    log.debug(
      `[DEBUG] Message type: ${message.type}, author: ${message.author?.tag}, has interaction: ${!!message
        .interaction}, has interactionMetadata: ${!!message
        .interactionMetadata}`,
    );

    // Detect slash command usage from ANY bot (including other bots)
    // MessageType.ChatInputCommand (20) = slash commands
    // MessageType.ContextMenuCommand (23) = context menu commands
    if (
      message.type === MessageType.ChatInputCommand ||
      message.type === MessageType.ContextMenuCommand
    ) {
      // In discord.js v14.14+, message.interaction is deprecated in favor of message.interactionMetadata
      // We check both for backwards compatibility
      const interaction = message.interaction || message.interactionMetadata;
      log.debug(`[DEBUG] Slash command detected! interaction:`, interaction);

      if (interaction) {
        // Handle both old (interaction.user) and new (interactionMetadata.user) structures
        const userId = interaction.user?.id || interaction.userId;
        const userName = interaction.user?.tag || interaction.user?.username ||
          "Unknown User";
        const cmdName = interaction.commandName || interaction.name ||
          "unknown";

        log.debug(
          `[DEBUG] Logging SLASH_COMMAND_USE: ${cmdName} by ${userName}`,
        );

        await logFn({
          guild_id: message.guild.id,
          event_type: "SLASH_COMMAND_USE",
          event_category: "interaction",
          actor_id: userId,
          actor_name: userName,
          target_id: message.author.id, // The bot that responded
          target_name: message.author.tag || message.author.username,
          channel_id: message.channel.id,
          channel_name: message.channel.name,
          details: {
            commandName: cmdName,
            commandType: message.type === MessageType.ChatInputCommand
              ? "slash"
              : "context_menu",
            botId: message.author.id,
            botName: message.author.tag || message.author.username,
            messageId: message.id,
            isExternalBot: message.author.id !== message.client.user?.id,
          },
        });
      }
    }

    // Extract mentioned users (useful for detecting who triggered bot responses like Disboard bumps)
    const mentionedUsers = message.mentions.users.map((u) => ({
      id: u.id,
      tag: u.tag,
      bot: u.bot,
    }));

    // Extract text from embeds for filtering
    const embedTexts = message.embeds.map((embed) => {
      const parts = [];
      if (embed.title) parts.push(embed.title);
      if (embed.description) parts.push(embed.description);
      if (embed.footer?.text) parts.push(embed.footer.text);
      embed.fields?.forEach((f) => {
        parts.push(f.name);
        parts.push(f.value);
      });
      return parts.join(" ");
    });

    // First mentioned non-bot user (often the command invoker for bot responses)
    const firstMentionedHuman = mentionedUsers.find((u) => !u.bot);

    await logFn({
      guild_id: message.guild.id,
      event_type: "MESSAGE_CREATE",
      event_category: "message",
      actor_id: message.author.id,
      actor_name: message.author.tag,
      // Target is the first mentioned human (useful for bot response automations)
      target_id: firstMentionedHuman?.id || null,
      target_name: firstMentionedHuman?.tag || null,
      channel_id: message.channel.id,
      channel_name: message.channel.name,
      details: {
        messageId: message.id,
        content: message.content?.substring(0, 500) || "",
        contentLength: message.content?.length || 0,
        hasAttachments: message.attachments.size > 0,
        attachmentCount: message.attachments.size,
        hasEmbeds: message.embeds.length > 0,
        embedCount: message.embeds.length,
        embedTexts: embedTexts,
        isReply: !!message.reference,
        mentionCount: message.mentions.users.size,
        mentionedUsers: mentionedUsers,
        isBot: message.author.bot || false,
      },
    });
  });

  client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
    if (!newMessage.guild) return;

    await logFn({
      guild_id: nwMessage.guild.id,
      event_type: "MESSAGE_UPDATE",
      event_category: "message",
      actor_id: newMessage.autho?.id,
      actor_name: newMessage.author?.tg,
      channel_id: newMessage.channel.id,
      channel_name: newMessage.channel.nme,
      details: {
        messageI: newMessage.id,
        oldContentLength: oldMessge.content?.length,
        newContentLength: newMessage.content?.length,
        isBot: newMessage.author?.bot || false,
      },
    });
  });

  client.on(Events.MessageDelete, async (message) => {
    if (!message.guild) return;

    await logFn({
      guild_id: message.guild.id,
      event_type: "MESSAGE_DELETE",
      event_category: "message",
      actor_id: message.author?.id,
      actor_name: message.author?.tag || "Unknown",
      channel_id: message.channel.id,
      channel_name: message.channel.name,
      details: {
        messageId: message.id,
        hadContent: !!message.content,
        hadAttachments: message.attachments?.size > 0,
      },
    });
  });

  client.on(Events.MessageBulkDelete, async (messages, channel) => {
    const guild = channel.guild;
    if (!guild) return;

    await logFn({
      guild_id: guild.id,
      event_type: "MESSAGE_BULK_DELETE",
      event_category: "message",
      channel_id: channel.id,
      channel_name: channel.name,
      details: {
        count: messages.size,
      },
    });
  });

  // ===== VOICE EVENTS =====

  client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    const guildId = newState.guild.id;
    const member = newState.member;

    // User joined a voice channel
    if (!oldState.channel && newState.channel) {
      await logFn({
        guild_id: guildId,
        event_type: "VOICE_JOIN",
        event_category: "voice",
        actor_id: member.user.id,
        actor_name: member.user.tag,
        channel_id: newState.channel.id,
        channel_name: newState.channel.name,
        details: {
          selfMute: newState.selfMute,
          selfDeaf: newState.selfDeaf,
          streaming: newState.streaming,
          selfVideo: newState.selfVideo,
        },
      });
      return; // Don't check for state changes on initial join
    }

    // User left a voice channel
    if (oldState.channel && !newState.channel) {
      await logFn({
        guild_id: guildId,
        event_type: "VOICE_LEAVE",
        event_category: "voice",
        actor_id: member.user.id,
        actor_name: member.user.tag,
        channel_id: oldState.channel.id,
        channel_name: oldState.channel.name,
        details: {
          // Include final state when leaving
          wasMuted: oldState.selfMute,
          wasDeafened: oldState.selfDeaf,
          wasStreaming: oldState.streaming,
          hadVideo: oldState.selfVideo,
        },
      });
      return;
    }

    // User moved between voice channels
    if (
      oldState.channel && newState.channel &&
      oldState.channel.id !== newState.channel.id
    ) {
      await logFn({
        guild_id: guildId,
        event_type: "VOICE_MOVE",
        event_category: "voice",
        actor_id: member.user.id,
        actor_name: member.user.tag,
        channel_id: newState.channel.id,
        channel_name: newState.channel.name,
        details: {
          fromChannelId: oldState.channel.id,
          fromChannelName: oldState.channel.name,
        },
      });
    }

    // ===== VOICE STATE CHANGES (while in a channel) =====
    const channel = newState.channel || oldState.channel;
    if (!channel) return;

    // Camera toggled (selfVideo)
    if (oldState.selfVideo !== newState.selfVideo) {
      await logFn({
        guild_id: guildId,
        event_type: newState.selfVideo
          ? "VOICE_VIDEO_START"
          : "VOICE_VIDEO_STOP",
        event_category: "voice",
        actor_id: member.user.id,
        actor_name: member.user.tag,
        channel_id: channel.id,
        channel_name: channel.name,
        details: {
          videoEnabled: newState.selfVideo,
        },
      });
    }

    // Screen share / streaming toggled
    if (oldState.streaming !== newState.streaming) {
      await logFn({
        guild_id: guildId,
        event_type: newState.streaming
          ? "VOICE_STREAM_START"
          : "VOICE_STREAM_STOP",
        event_category: "voice",
        actor_id: member.user.id,
        actor_name: member.user.tag,
        channel_id: channel.id,
        channel_name: channel.name,
        details: {
          streaming: newState.streaming,
        },
      });
    }

    // Self mute toggled
    if (oldState.selfMute !== newState.selfMute) {
      await logFn({
        guild_id: guildId,
        event_type: newState.selfMute ? "VOICE_SELF_MUTE" : "VOICE_SELF_UNMUTE",
        event_category: "voice",
        actor_id: member.user.id,
        actor_name: member.user.tag,
        channel_id: channel.id,
        channel_name: channel.name,
        details: {
          selfMute: newState.selfMute,
        },
      });
    }

    // Self deafen toggled
    if (oldState.selfDeaf !== newState.selfDeaf) {
      await logFn({
        guild_id: guildId,
        event_type: newState.selfDeaf
          ? "VOICE_SELF_DEAFEN"
          : "VOICE_SELF_UNDEAFEN",
        event_category: "voice",
        actor_id: member.user.id,
        actor_name: member.user.tag,
        channel_id: channel.id,
        channel_name: channel.name,
        details: {
          selfDeaf: newState.selfDeaf,
        },
      });
    }

    // Server mute toggled (by admin/moderator)
    if (oldState.serverMute !== newState.serverMute) {
      await logFn({
        guild_id: guildId,
        event_type: newState.serverMute
          ? "VOICE_SERVER_MUTE"
          : "VOICE_SERVER_UNMUTE",
        event_category: "voice",
        target_id: member.user.id,
        target_name: member.user.tag,
        channel_id: channel.id,
        channel_name: channel.name,
        details: {
          serverMute: newState.serverMute,
        },
      });
    }

    // Server deafen toggled (by admin/moderator)
    if (oldState.serverDeaf !== newState.serverDeaf) {
      await logFn({
        guild_id: guildId,
        event_type: newState.serverDeaf
          ? "VOICE_SERVER_DEAFEN"
          : "VOICE_SERVER_UNDEAFEN",
        event_category: "voice",
        target_id: member.user.id,
        target_name: member.user.tag,
        channel_id: channel.id,
        channel_name: channel.name,
        details: {
          serverDeaf: newState.serverDeaf,
        },
      });
    }

    // Stage channel: suppress toggled (speaker permission)
    if (oldState.suppress !== newState.suppress) {
      await logFn({
        guild_id: guildId,
        event_type: newState.suppress
          ? "VOICE_STAGE_SUPPRESS"
          : "VOICE_STAGE_UNSUPPRESS",
        event_category: "voice",
        target_id: member.user.id,
        target_name: member.user.tag,
        channel_id: channel.id,
        channel_name: channel.name,
        details: {
          suppress: newState.suppress,
          // When unsuppressed, user becomes a speaker in Stage
          isSpeaker: !newState.suppress,
        },
      });
    }

    // Stage channel: request to speak
    if (oldState.requestToSpeakTimestamp !== newState.requestToSpeakTimestamp) {
      if (newState.requestToSpeakTimestamp) {
        await logFn({
          guild_id: guildId,
          event_type: "VOICE_STAGE_REQUEST_TO_SPEAK",
          event_category: "voice",
          actor_id: member.user.id,
          actor_name: member.user.tag,
          channel_id: channel.id,
          channel_name: channel.name,
          details: {
            requestedAt: newState.requestToSpeakTimestamp.toISOString(),
          },
        });
      } else {
        await logFn({
          guild_id: guildId,
          event_type: "VOICE_STAGE_REQUEST_CANCELLED",
          event_category: "voice",
          actor_id: member.user.id,
          actor_name: member.user.tag,
          channel_id: channel.id,
          channel_name: channel.name,
        });
      }
    }
  });

  // ===== CHANNEL EVENTS =====

  client.on(Events.ChannelCreate, async (channel) => {
    if (!channel.guild) return;

    await logFn({
      guild_id: channel.guild.id,
      event_type: "CHANNEL_CREATE",
      event_category: "channel",
      channel_id: channel.id,
      channel_name: channel.name,
      details: {
        type: channel.type,
        parentId: channel.parentId,
      },
    });
  });

  client.on(Events.ChannelDelete, async (channel) => {
    if (!channel.guild) return;

    await logFn({
      guild_id: channel.guild.id,
      event_type: "CHANNEL_DELETE",
      event_category: "channel",
      channel_id: channel.id,
      channel_name: channel.name,
      details: {
        type: channel.type,
      },
    });
  });

  client.on(Events.ChannelUpdate, async (oldChannel, newChannel) => {
    if (!newChannel.guild) return;

    const changes = {};
    if (oldChannel.name !== newChannel.name) {
      changes.name = { old: oldChannel.name, new: newChannel.name };
    }

    if (Object.keys(changes).length > 0) {
      await logFn({
        guild_id: newChannel.guild.id,
        event_type: "CHANNEL_UPDATE",
        event_category: "channel",
        channel_id: newChannel.id,
        channel_name: newChannel.name,
        details: changes,
      });
    }
  });

  // ===== ROLE EVENTS =====

  client.on(Events.GuildRoleCreate, async (role) => {
    await logFn({
      guild_id: role.guild.id,
      event_type: "ROLE_CREATE",
      event_category: "role",
      details: {
        roleId: role.id,
        roleName: role.name,
        color: role.hexColor,
      },
    });
  });

  client.on(Events.GuildRoleDelete, async (role) => {
    await logFn({
      guild_id: role.guild.id,
      event_type: "ROLE_DELETE",
      event_category: "role",
      details: {
        roleId: role.id,
        roleName: role.name,
      },
    });
  });

  client.on(Events.GuildRoleUpdate, async (oldRole, newRole) => {
    const changes = {};
    if (oldRole.name !== newRole.name) {
      changes.name = { old: oldRole.name, new: newRole.name };
    }

    if (Object.keys(changes).length > 0) {
      await logFn({
        guild_id: newRole.guild.id,
        event_type: "ROLE_UPDATE",
        event_category: "role",
        details: {
          roleId: newRole.id,
          roleName: newRole.name,
          changes: changes,
        },
      });
    }
  });

  // ===== GUILD EVENTS =====

  client.on(Events.GuildUpdate, async (oldGuild, newGuild) => {
    const changes = {};
    if (oldGuild.name !== newGuild.name) {
      changes.name = { old: oldGuild.name, new: newGuild.name };
    }

    if (Object.keys(changes).length > 0) {
      await logFn({
        guild_id: newGuild.id,
        event_type: "GUILD_UPDATE",
        event_category: "guild",
        details: changes,
      });
    }
  });

  // ===== EMOJI EVENTS =====

  client.on(Events.GuildEmojiCreate, async (emoji) => {
    await logFn({
      guild_id: emoji.guild.id,
      event_type: "EMOJI_CREATE",
      event_category: "emoji",
      details: {
        emojiId: emoji.id,
        emojiName: emoji.name,
        animated: emoji.animated,
      },
    });
  });

  client.on(Events.GuildEmojiDelete, async (emoji) => {
    await logFn({
      guild_id: emoji.guild.id,
      event_type: "EMOJI_DELETE",
      event_category: "emoji",
      details: {
        emojiId: emoji.id,
        emojiName: emoji.name,
      },
    });
  });

  // ===== INVITE EVENTS =====

  client.on(Events.InviteCreate, async (invite) => {
    if (!invite.guild) return;

    await logFn({
      guild_id: invite.guild.id,
      event_type: "INVITE_CREATE",
      event_category: "invite",
      actor_id: invite.inviter?.id,
      actor_name: invite.inviter?.tag,
      channel_id: invite.channel?.id,
      channel_name: invite.channel?.name,
      details: {
        code: invite.code,
        maxUses: invite.maxUses,
        maxAge: invite.maxAge,
      },
    });
  });

  client.on(Events.InviteDelete, async (invite) => {
    if (!invite.guild) return;

    await logFn({
      guild_id: invite.guild.id,
      event_type: "INVITE_DELETE",
      event_category: "invite",
      channel_id: invite.channel?.id,
      channel_name: invite.channel?.name,
      details: {
        code: invite.code,
      },
    });
  });

  // ===== THREAD EVENTS =====

  client.on(Events.ThreadCreate, async (thread) => {
    if (!thread.guild) return;

    await logFn({
      guild_id: thread.guild.id,
      event_type: "THREAD_CREATE",
      event_category: "thread",
      actor_id: thread.ownerId,
      channel_id: thread.id,
      channel_name: thread.name,
      details: {
        parentId: thread.parentId,
      },
    });
  });

  client.on(Events.ThreadDelete, async (thread) => {
    if (!thread.guild) return;

    await logFn({
      guild_id: thread.guild.id,
      event_type: "THREAD_DELETE",
      event_category: "thread",
      channel_id: thread.id,
      channel_name: thread.name,
    });
  });

  // ===== REACTION EVENTS =====

  client.on(Events.MessageReactionAdd, async (reaction, user) => {
    if (!reaction.message.guild) return;
    if (user.bot) return;

    await logFn({
      guild_id: reaction.message.guild.id,
      event_type: "REACTION_ADD",
      event_category: "reaction",
      actor_id: user.id,
      actor_name: user.tag,
      channel_id: reaction.message.channel.id,
      channel_name: reaction.message.channel.name,
      details: {
        messageId: reaction.message.id,
        emoji: reaction.emoji.name,
        emojiId: reaction.emoji.id,
      },
    });
  });

  client.on(Events.MessageReactionRemove, async (reaction, user) => {
    if (!reaction.message.guild) return;
    if (user.bot) return;

    await logFn({
      guild_id: reaction.message.guild.id,
      event_type: "REACTION_REMOVE",
      event_category: "reaction",
      actor_id: user.id,
      actor_name: user.tag,
      channel_id: reaction.message.channel.id,
      channel_name: reaction.message.channel.name,
      details: {
        messageId: reaction.message.id,
        emoji: reaction.emoji.name,
      },
    });
  });

  // ===== INTERACTION EVENTS =====

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.guild) return;

    if (interaction.isChatInputCommand()) {
      await logFn({
        guild_id: interaction.guild.id,
        event_type: "COMMAND_USE",
        event_category: "interaction",
        actor_id: interaction.user.id,
        actor_name: interaction.user.tag,
        channel_id: interaction.channel?.id,
        channel_name: interaction.channel?.name,
        details: {
          commandName: interaction.commandName,
        },
      });
    } else if (interaction.isButton()) {
      await logFn({
        guild_id: interaction.guild.id,
        event_type: "BUTTON_CLICK",
        event_category: "interaction",
        actor_id: interaction.user.id,
        actor_name: interaction.user.tag,
        channel_id: interaction.channel?.id,
        channel_name: interaction.channel?.name,
        details: {
          customId: interaction.customId,
        },
      });
    } else if (interaction.isModalSubmit()) {
      await logFn({
        guild_id: interaction.guild.id,
        event_type: "MODAL_SUBMIT",
        event_category: "interaction",
        actor_id: interaction.user.id,
        actor_name: interaction.user.tag,
        channel_id: interaction.channel?.id,
        channel_name: interaction.channel?.name,
        details: {
          customId: interaction.customId,
        },
      });
    } else if (
      interaction.isStringSelectMenu() || interaction.isUserSelectMenu() ||
      interaction.isRoleSelectMenu() || interaction.isChannelSelectMenu() ||
      interaction.isMentionableSelectMenu()
    ) {
      await logFn({
        guild_id: interaction.guild.id,
        event_type: "SELECT_MENU_USE",
        event_category: "interaction",
        actor_id: interaction.user.id,
        actor_name: interaction.user.tag,
        channel_id: interaction.channel?.id,
        channel_name: interaction.channel?.name,
        details: {
          customId: interaction.customId,
          values: interaction.values,
        },
      });
    } else if (
      interaction.isUserContextMenuCommand() ||
      interaction.isMessageContextMenuCommand()
    ) {
      await logFn({
        guild_id: interaction.guild.id,
        event_type: "CONTEXT_MENU_USE",
        event_category: "interaction",
        actor_id: interaction.user.id,
        actor_name: interaction.user.tag,
        channel_id: interaction.channel?.id,
        channel_name: interaction.channel?.name,
        details: {
          commandName: interaction.commandName,
          targetType: interaction.isUserContextMenuCommand()
            ? "user"
            : "message",
          targetId: interaction.targetId,
        },
      });
    } else if (interaction.isAutocomplete()) {
      await logFn({
        guild_id: interaction.guild.id,
        event_type: "AUTOCOMPLETE_USE",
        event_category: "interaction",
        actor_id: interaction.user.id,
        actor_name: interaction.user.tag,
        channel_id: interaction.channel?.id,
        channel_name: interaction.channel?.name,
        details: {
          commandName: interaction.commandName,
          focusedOption: interaction.options.getFocused(true),
        },
      });
    }
  });

  // ===== STICKER EVENTS =====

  client.on(Events.GuildStickerCreate, async (sticker) => {
    await logFn({
      guild_id: sticker.guild.id,
      event_type: "STICKER_CREATE",
      event_category: "sticker",
      actor_id: sticker.user?.id,
      actor_name: sticker.user?.tag,
      details: {
        stickerId: sticker.id,
        stickerName: sticker.name,
        description: sticker.description,
        format: sticker.format,
        tags: sticker.tags,
      },
    });
  });

  client.on(Events.GuildStickerDelete, async (sticker) => {
    await logFn({
      guild_id: sticker.guild.id,
      event_type: "STICKER_DELETE",
      event_category: "sticker",
      details: {
        stickerId: sticker.id,
        stickerName: sticker.name,
      },
    });
  });

  client.on(Events.GuildStickerUpdate, async (oldSticker, newSticker) => {
    const changes = {};
    if (oldSticker.name !== newSticker.name) {
      changes.name = { old: oldSticker.name, new: newSticker.name };
    }
    if (oldSticker.description !== newSticker.description) {
      changes.description = {
        old: oldSticker.description,
        new: newSticker.description,
      };
    }

    if (Object.keys(changes).length > 0) {
      await logFn({
        guild_id: newSticker.guild.id,
        event_type: "STICKER_UPDATE",
        event_category: "sticker",
        details: {
          stickerId: newSticker.id,
          stickerName: newSticker.name,
          changes: changes,
        },
      });
    }
  });

  // ===== SCHEDULED EVENT EVENTS =====

  client.on(Events.GuildScheduledEventCreate, async (event) => {
    await logFn({
      guild_id: event.guild.id,
      event_type: "SCHEDULED_EVENT_CREATE",
      event_category: "scheduled_event",
      actor_id: event.creatorId,
      actor_name: event.creator?.tag,
      channel_id: event.channelId,
      details: {
        eventId: event.id,
        eventName: event.name,
        description: event.description,
        scheduledStartTime: event.scheduledStartAt?.toISOString(),
        scheduledEndTime: event.scheduledEndAt?.toISOString(),
        status: event.status,
        entityType: event.entityType,
        location: event.entityMetadata?.location,
      },
    });
  });

  client.on(Events.GuildScheduledEventDelete, async (event) => {
    await logFn({
      guild_id: event.guild.id,
      event_type: "SCHEDULED_EVENT_DELETE",
      event_category: "scheduled_event",
      details: {
        eventId: event.id,
        eventName: event.name,
      },
    });
  });

  client.on(Events.GuildScheduledEventUpdate, async (oldEvent, newEvent) => {
    const changes = {};
    if (oldEvent?.name !== newEvent.name) {
      changes.name = { old: oldEvent?.name, new: newEvent.name };
    }
    if (oldEvent?.status !== newEvent.status) {
      changes.status = { old: oldEvent?.status, new: newEvent.status };
    }
    if (
      oldEvent?.scheduledStartAt?.getTime() !==
        newEvent.scheduledStartAt?.getTime()
    ) {
      changes.scheduledStartTime = {
        old: oldEvent?.scheduledStartAt?.toISOString(),
        new: newEvent.scheduledStartAt?.toISOString(),
      };
    }

    await logFn({
      guild_id: newEvent.guild.id,
      event_type: "SCHEDULED_EVENT_UPDATE",
      event_category: "scheduled_event",
      details: {
        eventId: newEvent.id,
        eventName: newEvent.name,
        changes: changes,
      },
    });
  });

  client.on(Events.GuildScheduledEventUserAdd, async (event, user) => {
    await logFn({
      guild_id: event.guild.id,
      event_type: "SCHEDULED_EVENT_USER_ADD",
      event_category: "scheduled_event",
      actor_id: user.id,
      actor_name: user.tag,
      details: {
        eventId: event.id,
        eventName: event.name,
      },
    });
  });

  client.on(Events.GuildScheduledEventUserRemove, async (event, user) => {
    await logFn({
      guild_id: event.guild.id,
      event_type: "SCHEDULED_EVENT_USER_REMOVE",
      event_category: "scheduled_event",
      actor_id: user.id,
      actor_name: user.tag,
      details: {
        eventId: event.id,
        eventName: event.name,
      },
    });
  });

  // ===== AUTOMOD EVENTS =====

  client.on(Events.AutoModerationRuleCreate, async (rule) => {
    await logFn({
      guild_id: rule.guild.id,
      event_type: "AUTOMOD_RULE_CREATE",
      event_category: "automod",
      actor_id: rule.creatorId,
      details: {
        ruleId: rule.id,
        ruleName: rule.name,
        eventType: rule.eventType,
        triggerType: rule.triggerType,
        enabled: rule.enabled,
      },
    });
  });

  client.on(Events.AutoModerationRuleDelete, async (rule) => {
    await logFn({
      guild_id: rule.guild.id,
      event_type: "AUTOMOD_RULE_DELETE",
      event_category: "automod",
      details: {
        ruleId: rule.id,
        ruleName: rule.name,
      },
    });
  });

  client.on(Events.AutoModerationRuleUpdate, async (oldRule, newRule) => {
    const changes = {};
    if (oldRule?.name !== newRule.name) {
      changes.name = { old: oldRule?.name, new: newRule.name };
    }
    if (oldRule?.enabled !== newRule.enabled) {
      changes.enabled = { old: oldRule?.enabled, new: newRule.enabled };
    }

    await logFn({
      guild_id: newRule.guild.id,
      event_type: "AUTOMOD_RULE_UPDATE",
      event_category: "automod",
      details: {
        ruleId: newRule.id,
        ruleName: newRule.name,
        changes: changes,
      },
    });
  });

  client.on(Events.AutoModerationActionExecution, async (execution) => {
    await logFn({
      guild_id: execution.guild.id,
      event_type: "AUTOMOD_ACTION_EXECUTE",
      event_category: "automod",
      target_id: execution.userId,
      channel_id: execution.channelId,
      details: {
        ruleId: execution.ruleId,
        ruleTriggerType: execution.ruleTriggerType,
        action: execution.action,
        matchedKeyword: execution.matchedKeyword,
        matchedContent: execution.matchedContent,
        alertSystemMessageId: execution.alertSystemMessageId,
      },
    });
  });

  // ===== CHANNEL PINS EVENTS =====

  client.on(Events.ChannelPinsUpdate, async (channel, date) => {
    if (!channel.guild) return;

    await logFn({
      guild_id: channel.guild.id,
      event_type: "CHANNEL_PINS_UPDATE",
      event_category: "channel",
      channel_id: channel.id,
      channel_name: channel.name,
      details: {
        lastPinAt: date?.toISOString(),
      },
    });
  });

  // ===== ADDITIONAL REACTION EVENTS =====

  client.on(Events.MessageReactionRemoveAll, async (message, reactions) => {
    if (!message.guild) return;

    await logFn({
      guild_id: message.guild.id,
      event_type: "REACTION_REMOVE_ALL",
      event_category: "reaction",
      channel_id: message.channel.id,
      channel_name: message.channel.name,
      details: {
        messageId: message.id,
      },
    });
  });

  client.on(Events.MessageReactionRemoveEmoji, async (reaction) => {
    if (!reaction.message.guild) return;

    await logFn({
      guild_id: reaction.message.guild.id,
      event_type: "REACTION_REMOVE_EMOJI",
      event_category: "reaction",
      channel_id: reaction.message.channel.id,
      channel_name: reaction.message.channel.name,
      details: {
        messageId: reaction.message.id,
        emoji: reaction.emoji.name,
        emojiId: reaction.emoji.id,
      },
    });
  });

  // ===== CLIENT EVENTS =====

  client.on(Events.ClientReady, (c) => {
    log.info(`✅ Discord Gateway Bot is online as ${c.user.tag}`);
    log.info(`📊 Watching ${c.guilds.cache.size} guilds`);
  });

  client.on(Events.Error, (error) => {
    log.error("Discord client error:", error);
  });

  client.on(Events.Warn, (warning) => {
    log.warn("Discord client warning:", warning);
  });
}

/**
 * Start the gateway bot
 */
async function startBot() {
  const token = process.env.DISCORD_BOT_TOKEN;

  if (!token) {
    log.error("❌ DISCORD_BOT_TOKEN environment variable is required");
    process.exit(1);
  }

  log.info("🚀 Starting Discord Gateway Bot...");
  log.info("🤖 Automation engine enabled");

  const client = createClient();
  discordClient = client; // Store reference for automation execution
  setupEventHandlers(client, logEventViaAPI);

  try {
    await client.login(token);
  } catch (error) {
    log.error("❌ Failed to login:", error);
    process.exit(1);
  }
}

// Start the bot if this file is run directly
startBot();

export { createClient, setupEventHandlers };
