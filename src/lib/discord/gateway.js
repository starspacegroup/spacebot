/**
 * Discord Gateway Bot Service
 * Captures all Discord events and logs them to the database
 *
 * This runs as a separate process alongside the SvelteKit app
 * Start with: node src/lib/discord/gateway.js
 */

import "dotenv/config";
import { Client, Events, GatewayIntentBits, Partials } from "discord.js";

// For local development, we'll use a REST endpoint to log events
const API_BASE = process.env.API_BASE || "http://localhost:4269";

/**
 * Log event via API (for when running as separate process)
 */
async function logEventViaAPI(event) {
  const url = `${API_BASE}/api/logs/create`;
  console.log(`[DEBUG] Posting to ${url}`);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      },
      body: JSON.stringify(event),
    });

    console.log(`[DEBUG] Response status: ${response.status}`);
    if (!response.ok) {
      const errorBody = await response.text();
      console.error(
        `Failed to log event via API: ${response.status} - ${errorBody}`,
      );
    } else {
      console.log(`[DEBUG] Event logged successfully`);
    }
  } catch (error) {
    console.error("Error logging event:", error.message);
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
    console.log(
      `[DEBUG] MessageCreate received from ${message.author?.tag} in ${
        message.guild?.name || "DM"
      }`,
    );
    if (!message.guild) return;

    console.log(`[DEBUG] Logging message event for guild ${message.guild.id}`);
    await logFn({
      guild_id: message.guild.id,
      event_type: "MESSAGE_CREATE",
      event_category: "message",
      actor_id: message.author.id,
      actor_name: message.author.tag,
      channel_id: message.channel.id,
      channel_name: message.channel.name,
      details: {
        messageId: message.id,
        contentLength: message.content?.length || 0,
        hasAttachments: message.attachments.size > 0,
        attachmentCount: message.attachments.size,
        hasEmbeds: message.embeds.length > 0,
        isReply: !!message.reference,
        mentionCount: message.mentions.users.size,
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
        event_type: newState.selfVideo ? "VOICE_VIDEO_START" : "VOICE_VIDEO_STOP",
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
        event_type: newState.streaming ? "VOICE_STREAM_START" : "VOICE_STREAM_STOP",
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
        event_type: newState.selfDeaf ? "VOICE_SELF_DEAFEN" : "VOICE_SELF_UNDEAFEN",
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
        event_type: newState.serverMute ? "VOICE_SERVER_MUTE" : "VOICE_SERVER_UNMUTE",
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
        event_type: newState.serverDeaf ? "VOICE_SERVER_DEAFEN" : "VOICE_SERVER_UNDEAFEN",
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
        event_type: newState.suppress ? "VOICE_STAGE_SUPPRESS" : "VOICE_STAGE_UNSUPPRESS",
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
    } else if (interaction.isStringSelectMenu() || interaction.isUserSelectMenu() || interaction.isRoleSelectMenu() || interaction.isChannelSelectMenu() || interaction.isMentionableSelectMenu()) {
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
    } else if (interaction.isUserContextMenuCommand() || interaction.isMessageContextMenuCommand()) {
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
          targetType: interaction.isUserContextMenuCommand() ? "user" : "message",
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
      changes.description = { old: oldSticker.description, new: newSticker.description };
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
    if (oldEvent?.scheduledStartAt?.getTime() !== newEvent.scheduledStartAt?.getTime()) {
      changes.scheduledStartTime = { 
        old: oldEvent?.scheduledStartAt?.toISOString(), 
        new: newEvent.scheduledStartAt?.toISOString() 
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
    console.log(`✅ Discord Gateway Bot is online as ${c.user.tag}`);
    console.log(`📊 Watching ${c.guilds.cache.size} guilds`);
  });

  client.on(Events.Error, (error) => {
    console.error("Discord client error:", error);
  });

  client.on(Events.Warn, (warning) => {
    console.warn("Discord client warning:", warning);
  });
}

/**
 * Start the gateway bot
 */
async function startBot() {
  const token = process.env.DISCORD_BOT_TOKEN;

  if (!token) {
    console.error("❌ DISCORD_BOT_TOKEN environment variable is required");
    process.exit(1);
  }

  console.log("🚀 Starting Discord Gateway Bot...");

  const client = createClient();
  setupEventHandlers(client, logEventViaAPI);

  try {
    await client.login(token);
  } catch (error) {
    console.error("❌ Failed to login:", error);
    process.exit(1);
  }
}

// Start the bot if this file is run directly
startBot();

export { createClient, setupEventHandlers };
