/**
 * Discord Gateway Bot Service
 * Captures all Discord events and logs them to the database
 * Processes automations when events are triggered
 *
 * This runs as a separate process alongside the SvelteKit app
 * Start with: bun src/lib/discord/gateway.js
 * Production: pm2 start ecosystem.config.cjs
 */

import "dotenv/config";
import { loadSecrets } from "../secrets.js";
await loadSecrets();
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AuditLogEvent,
  Client,
  Events,
  GatewayIntentBits,
  MessageType,
  Partials,
  PermissionFlagsBits,
} from "discord.js";
import { log } from "../log.js";
import { buildLiveVoiceSnapshot } from "../db/live-voice.js";
import { generateChatResponse, isAIEnabled } from "../ai/chat.js";
import { resolveTargetUser } from "../automation/engine.js";
import { fetchSignedWidgetPng, resolveWidgetOrigin } from "../stats-widget-delivery.js";
import { verifyLiveUpdateAccess } from "../live-updates.js";

// For local development, we'll use a REST endpoint to log events
const API_BASE = process.env.API_BASE || process.env.APP_URL || "http://localhost:4269";

const ORIGINAL_CONSOLE = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
};

const GATEWAY_LOG_CONFIG_SYNC_MS = 5_000;
const GATEWAY_LOG_FLUSH_MS = 1_500;
const GATEWAY_LOG_BATCH_SIZE = 50;
const GATEWAY_LOG_MAX_QUEUE = 500;
const VOICE_SESSION_RECONCILE_COOLDOWN_MS = 60_000;

let gatewayLogCaptureEnabled = false;
let gatewayLogQueue = [];
let gatewayLogFlushTimer = null;
let gatewayLogConfigPoll = null;
let gatewayLogFlushInFlight = false;
let gatewayConsoleCaptureInstalled = false;
let lastVoiceSessionReconcileAt = 0;
let voiceSessionReconcileInFlight = false;
const liveUpdateClientsByGuild = new Map();

function getLiveUpdateSecret() {
  return process.env.INTERNAL_API_KEY || process.env.DISCORD_BOT_TOKEN || "";
}

function writeSseEvent(res, eventName, payload) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function registerLiveUpdateClient(guildId, res) {
  if (!liveUpdateClientsByGuild.has(guildId)) {
    liveUpdateClientsByGuild.set(guildId, new Set());
  }

  liveUpdateClientsByGuild.get(guildId).add(res);
}

function unregisterLiveUpdateClient(guildId, res) {
  const clients = liveUpdateClientsByGuild.get(guildId);
  if (!clients) {
    return;
  }

  clients.delete(res);
  if (clients.size === 0) {
    liveUpdateClientsByGuild.delete(guildId);
  }
}

function broadcastLiveUpdate(guildId, eventName, payload) {
  const clients = liveUpdateClientsByGuild.get(guildId);
  if (!clients || clients.size === 0) {
    return;
  }

  for (const client of [...clients]) {
    try {
      writeSseEvent(client, eventName, payload);
    } catch (error) {
      unregisterLiveUpdateClient(guildId, client);
      try {
        client.end();
      } catch {
        // noop
      }
    }
  }
}

function safeJsonStringify(value) {
  const seen = new WeakSet();

  return JSON.stringify(value, (key, current) => {
    if (current instanceof Error) {
      return {
        name: current.name,
        message: current.message,
        stack: current.stack,
      };
    }

    if (typeof current === "bigint") {
      return String(current);
    }

    if (typeof current === "object" && current !== null) {
      if (seen.has(current)) {
        return "[Circular]";
      }
      seen.add(current);
    }

    return current;
  });
}

function stringifyGatewayLogValue(value) {
  if (value instanceof Error) {
    return value.stack || `${value.name}: ${value.message}`;
  }

  if (typeof value === "string") {
    return value;
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  if (value === undefined) {
    return "undefined";
  }

  if (value === null) {
    return "null";
  }

  try {
    return safeJsonStringify(value) || String(value);
  } catch {
    return String(value);
  }
}

function formatGatewayLogMessage(args) {
  const message = args.map((arg) => stringifyGatewayLogValue(arg)).join(" ").trim();
  if (message.length <= 8000) {
    return message;
  }
  return `${message.slice(0, 7997)}...`;
}

function clearGatewayLogFlushTimer() {
  if (gatewayLogFlushTimer) {
    clearTimeout(gatewayLogFlushTimer);
    gatewayLogFlushTimer = null;
  }
}

function scheduleGatewayLogFlush() {
  if (!gatewayLogCaptureEnabled || gatewayLogQueue.length === 0 || gatewayLogFlushTimer) {
    return;
  }

  gatewayLogFlushTimer = setTimeout(() => {
    gatewayLogFlushTimer = null;
    void flushGatewayLogs();
  }, GATEWAY_LOG_FLUSH_MS);
}

function enqueueGatewayLog(level, args) {
  if (!gatewayLogCaptureEnabled) {
    return;
  }

  const message = formatGatewayLogMessage(args);
  if (!message) {
    return;
  }

  gatewayLogQueue.push({
    level,
    message,
    source: "gateway",
    logged_at: new Date().toISOString(),
  });

  if (gatewayLogQueue.length > GATEWAY_LOG_MAX_QUEUE) {
    gatewayLogQueue = gatewayLogQueue.slice(-GATEWAY_LOG_MAX_QUEUE);
  }

  scheduleGatewayLogFlush();
}

async function flushGatewayLogs() {
  if (
    !gatewayLogCaptureEnabled ||
    gatewayLogFlushInFlight ||
    gatewayLogQueue.length === 0
  ) {
    return;
  }

  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    return;
  }

  const batch = gatewayLogQueue.splice(0, GATEWAY_LOG_BATCH_SIZE);
  gatewayLogFlushInFlight = true;

  try {
    const response = await fetch(`${API_BASE}/api/gateway/logs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bot ${token}`,
      },
      body: JSON.stringify({ entries: batch }),
    });

    if (!response.ok) {
      gatewayLogQueue = [...batch, ...gatewayLogQueue].slice(-GATEWAY_LOG_MAX_QUEUE);
    }
  } catch {
    gatewayLogQueue = [...batch, ...gatewayLogQueue].slice(-GATEWAY_LOG_MAX_QUEUE);
  } finally {
    gatewayLogFlushInFlight = false;

    if (gatewayLogCaptureEnabled && gatewayLogQueue.length > 0) {
      scheduleGatewayLogFlush();
    }
  }
}

function setGatewayLogCaptureEnabled(enabled) {
  if (gatewayLogCaptureEnabled === enabled) {
    return;
  }

  gatewayLogCaptureEnabled = enabled;

  if (!enabled) {
    gatewayLogQueue = [];
    clearGatewayLogFlushTimer();
  } else {
    enqueueGatewayLog("info", [
      `[GatewayLogs] Capture enabled on ${new Date().toISOString()} via ${API_BASE}`,
    ]);

    if (gatewayLogQueue.length > 0) {
      scheduleGatewayLogFlush();
    }
  }

  ORIGINAL_CONSOLE.info(`[GatewayLogs] Capture ${enabled ? "enabled" : "disabled"}`);
}

async function syncGatewayLogCaptureSetting() {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/api/gateway/logs`, {
      headers: {
        Authorization: `Bot ${token}`,
      },
    });

    if (!response.ok) {
      return;
    }

    const result = await response.json();
    setGatewayLogCaptureEnabled(result.enabled === true);
  } catch {
    // Best effort only. The gateway should keep running even if log sync fails.
  }
}

function installGatewayConsoleCapture() {
  if (gatewayConsoleCaptureInstalled) {
    return;
  }

  gatewayConsoleCaptureInstalled = true;

  for (const level of ["log", "info", "warn", "error", "debug"]) {
    const original = ORIGINAL_CONSOLE[level];
    console[level] = (...args) => {
      original(...args);
      enqueueGatewayLog(level, args);
    };
  }
}

function startGatewayLogStreaming() {
  installGatewayConsoleCapture();

  if (gatewayLogConfigPoll) {
    clearInterval(gatewayLogConfigPoll);
  }

  void syncGatewayLogCaptureSetting();
  gatewayLogConfigPoll = setInterval(() => {
    void syncGatewayLogCaptureSetting();
  }, GATEWAY_LOG_CONFIG_SYNC_MS);
}

/**
 * User DM session storage
 * Tracks selected server, conversation state, and pending operations per user
 * Map<userId, { 
 *   selectedGuildId: string | null, 
 *   selectedGuildName: string | null, 
 *   lastMessageAt: number,
 *   pendingEvents: Object | null,  // Stores events awaiting confirmation
 *   conversationHistory: Array<{role: string, content: string}>  // Recent conversation history for AI context
 * }>
 */
const userSessions = new Map();

// Session timeout - clear after 24 hours of inactivity
const SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000;

// Pending events timeout - clear after 10 minutes
const PENDING_EVENTS_TIMEOUT_MS = 10 * 60 * 1000;

// Max conversation history to retain (messages, not turns)
const MAX_HISTORY_MESSAGES = 20;

/**
 * Get or create a user's DM session
 * @param {string} userId - Discord user ID
 * @returns {Object} Session object
 */
function getUserSession(userId) {
  let session = userSessions.get(userId);
  const now = Date.now();
  
  // Create new session if doesn't exist or expired
  if (!session || (now - session.lastMessageAt) > SESSION_TIMEOUT_MS) {
    session = {
      selectedGuildId: null,
      selectedGuildName: null,
      lastMessageAt: now,
      pendingEvents: null,
      conversationHistory: [],
    };
    userSessions.set(userId, session);
  } else {
    session.lastMessageAt = now;
    
    // Clear pending events if they've expired
    if (session.pendingEvents && 
        (now - session.pendingEvents.createdAt) > PENDING_EVENTS_TIMEOUT_MS) {
      session.pendingEvents = null;
    }
    
    // Initialize conversationHistory if missing (for older sessions)
    if (!session.conversationHistory) {
      session.conversationHistory = [];
    }
  }
  
  return session;
}

/**
 * Add message to conversation history
 * @param {string} userId - Discord user ID
 * @param {string} role - 'user' or 'assistant'
 * @param {string} content - Message content
 */
function addToConversationHistory(userId, role, content) {
  const session = getUserSession(userId);
  session.conversationHistory.push({ role, content });
  
  // Trim to max length
  if (session.conversationHistory.length > MAX_HISTORY_MESSAGES) {
    session.conversationHistory = session.conversationHistory.slice(-MAX_HISTORY_MESSAGES);
  }
}

/**
 * Store pending events for user confirmation
 * @param {string} userId - Discord user ID
 * @param {Object} pendingData - The pending events data
 */
export function setPendingEvents(userId, pendingData) {
  const session = getUserSession(userId);
  session.pendingEvents = {
    ...pendingData,
    createdAt: Date.now(),
  };
  log.info(`[DM] Stored ${pendingData.events?.length || 1} pending event(s) for user ${userId}`);
}

/**
 * Get pending events for a user
 * @param {string} userId - Discord user ID
 * @returns {Object|null} Pending events data or null
 */
export function getPendingEvents(userId) {
  const session = getUserSession(userId);
  const now = Date.now();
  
  // Check if pending events exist and haven't expired
  if (session.pendingEvents && 
      (now - session.pendingEvents.createdAt) <= PENDING_EVENTS_TIMEOUT_MS) {
    return session.pendingEvents;
  }
  
  // Clear expired pending events
  if (session.pendingEvents) {
    session.pendingEvents = null;
  }
  
  return null;
}

/**
 * Clear pending events for a user
 * @param {string} userId - Discord user ID
 */
export function clearPendingEvents(userId) {
  const session = getUserSession(userId);
  session.pendingEvents = null;
  log.info(`[DM] Cleared pending events for user ${userId}`);
}

/**
 * Check if a user is a superadmin (defined in ADMIN_USER_IDS env var)
 * @param {string} userId - Discord user ID
 * @returns {boolean}
 */
function checkIsSuperAdmin(userId) {
  if (!userId) return false;

  const adminUserIds = process.env.ADMIN_USER_IDS || "";
  const superAdminIdList = adminUserIds.split(",").map((id) => id.trim()).filter(Boolean);

  return superAdminIdList.includes(userId);
}

/**
 * Update user's selected server
 * @param {string} userId - Discord user ID
 * @param {string|null} guildId - Selected guild ID (null to clear)
 * @param {string|null} guildName - Selected guild name
 */
function setUserSelectedGuild(userId, guildId, guildName) {
  const session = getUserSession(userId);
  session.selectedGuildId = guildId;
  session.selectedGuildName = guildName;
  log.info(`[DM] User ${userId} selected server: ${guildName || 'none'} (${guildId || 'none'})`);
}

/**
 * Parse server selection from user message
 * Supports:
 * - "switch to <server>"
 * - "use server <server>"
 * - "select <server>"
 * - "server: <server>"
 * @param {string} message - User's message
 * @param {Object[]} managedGuilds - Guilds user can select from
 * @returns {{matched: boolean, guildId?: string, guildName?: string}}
 */
function parseServerSelection(message, managedGuilds) {
  const lowerMessage = message.toLowerCase().trim();
  
  // Check for list servers command
  if (lowerMessage === 'list servers' || lowerMessage === 'show servers' || lowerMessage === 'my servers') {
    return { matched: true, listServers: true };
  }
  
  // Patterns for selecting a server
  const patterns = [
    /^(?:switch\s+to|use\s+server|select(?:\s+server)?|server:)\s+(.+)$/i,
    /^(?:set\s+server\s+(?:to\s+)?)(.+)$/i,
  ];
  
  let serverNameQuery = null;
  
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      serverNameQuery = match[1].trim().toLowerCase();
      break;
    }
  }
  
  if (!serverNameQuery) {
    return { matched: false };
  }
  
  // Try to match against user's managed guilds
  // First try exact match, then partial match
  let matchedGuild = managedGuilds.find(g => g.name.toLowerCase() === serverNameQuery);
  
  if (!matchedGuild) {
    // Try partial match
    matchedGuild = managedGuilds.find(g => g.name.toLowerCase().includes(serverNameQuery));
  }
  
  if (!matchedGuild) {
    // Try matching by ID
    matchedGuild = managedGuilds.find(g => g.id === serverNameQuery);
  }
  
  if (matchedGuild) {
    return { matched: true, guildId: matchedGuild.id, guildName: matchedGuild.name };
  }
  
  // Server selection was attempted but no match found
  return { matched: true, notFound: true, query: serverNameQuery };
}

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
 * Check if a user is a manager of any guild the bot is in
 * A manager has MANAGE_GUILD or ADMINISTRATOR permissions
 * @param {Client} client - Discord client
 * @param {string} userId - User ID to check
 * @returns {Promise<{isManager: boolean, managedGuilds: Array}>}
 */
async function checkUserIsManager(client, userId) {
  const managedGuilds = [];
  
  for (const guild of client.guilds.cache.values()) {
    try {
      // Try to fetch the member from this guild
      const member = await guild.members.fetch(userId).catch(() => null);
      
      if (member) {
        // Check all relevant permissions
        const hasManageGuild = member.permissions.has(PermissionFlagsBits.ManageGuild);
        const hasAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
        const isOwner = guild.ownerId === userId;
        
        // Additional permissions the AI should know about
        const hasManageChannels = member.permissions.has(PermissionFlagsBits.ManageChannels);
        const hasManageRoles = member.permissions.has(PermissionFlagsBits.ManageRoles);
        const hasManageMessages = member.permissions.has(PermissionFlagsBits.ManageMessages);
        const hasKickMembers = member.permissions.has(PermissionFlagsBits.KickMembers);
        const hasBanMembers = member.permissions.has(PermissionFlagsBits.BanMembers);
        const hasManageWebhooks = member.permissions.has(PermissionFlagsBits.ManageWebhooks);
        const hasManageEvents = member.permissions.has(PermissionFlagsBits.ManageEvents);
        
        if (hasManageGuild || hasAdmin || isOwner) {
          // Count members in voice channels and get voice channel details
          let voiceMemberCount = 0;
          const voiceChannels = [];
          for (const channel of guild.channels.cache.values()) {
            if (channel.isVoiceBased() && channel.members) {
              const membersInChannel = channel.members.size;
              if (membersInChannel > 0) {
                voiceMemberCount += membersInChannel;
                voiceChannels.push({
                  name: channel.name,
                  memberCount: membersInChannel,
                  members: channel.members.map(m => m.user.username).slice(0, 10), // First 10 usernames
                });
              }
            }
          }
          
          // Count online members (requires GuildPresences intent)
          const onlineCount = guild.members.cache.filter(m => 
            m.presence?.status && m.presence.status !== 'offline'
          ).size;
          
          // Get user's roles in this guild (for context)
          const userRoles = member.roles.cache
            .filter(r => r.id !== guild.id) // Exclude @everyone
            .sort((a, b) => b.position - a.position)
            .map(r => r.name)
            .slice(0, 5); // Top 5 roles
          
          managedGuilds.push({
            id: guild.id,
            name: guild.name,
            isOwner,
            isAdmin: hasAdmin,
            // Detailed Discord permissions for this user
            permissions: {
              administrator: hasAdmin,
              manageGuild: hasManageGuild,
              manageChannels: hasManageChannels,
              manageRoles: hasManageRoles,
              manageMessages: hasManageMessages,
              manageWebhooks: hasManageWebhooks,
              manageEvents: hasManageEvents,
              kickMembers: hasKickMembers,
              banMembers: hasBanMembers,
            },
            userRoles,
            // Include live stats from Discord.js cache
            memberCount: guild.memberCount,
            onlineCount,
            channelCount: guild.channels.cache.size,
            roleCount: guild.roles.cache.size,
            emojiCount: guild.emojis.cache.size,
            boostCount: guild.premiumSubscriptionCount || 0,
            boostLevel: guild.premiumTier,
            // Voice channel stats
            voiceMemberCount,
            voiceChannels,
          });
        }
      }
    } catch (error) {
      // Member not in this guild, skip
      log.debug(`[DM] Could not check membership for ${userId} in ${guild.name}`);
    }
  }
  
  return {
    isManager: managedGuilds.length > 0,
    managedGuilds,
  };
}

/**
 * Format a list of servers for display
 * @param {Object[]} guilds - Array of guild objects
 * @param {string|null} selectedGuildId - Currently selected guild ID
 * @returns {string}
 */
function formatServerList(guilds, selectedGuildId) {
  if (guilds.length === 0) {
    return "You don't manage any servers where I'm installed.";
  }
  
  let response = "**Your Servers:**\n\n";
  for (const guild of guilds) {
    const isSelected = guild.id === selectedGuildId;
    const marker = isSelected ? "✅ " : "• ";
    const selectedText = isSelected ? " *(currently selected)*" : "";
    response += `${marker}**${guild.name}**${selectedText}\n`;
    response += `   Members: ${guild.memberCount || "?"} | Channels: ${guild.channelCount || "?"}\n`;
  }
  
  response += "\n**To select a server:**\n";
  response += "• `switch to <server name>`\n";
  response += "• `select <server name>`\n";
  response += "• `use server <server name>`\n";
  
  if (selectedGuildId) {
    response += `\nCurrently working with: **${guilds.find(g => g.id === selectedGuildId)?.name || 'Unknown'}**`;
  } else if (guilds.length === 1) {
    response += `\n💡 *Since you only manage one server, I'll automatically use **${guilds[0].name}**.*`;
  }
  
  return response;
}

/**
 * Handle a direct message to the bot
 * @param {Message} message - The DM message
 * @param {Client} client - Discord client
 */
async function handleDirectMessage(message, client) {
  const userId = message.author.id;
  const userName = message.author.tag || message.author.username;
  const content = message.content;
  
  log.info(`[DM] Received DM from ${userName} (${userId}): ${content.substring(0, 100)}`);
  
  // Ignore bot messages and empty messages
  if (message.author.bot || !content.trim()) {
    return;
  }
  
  // Check if AI is enabled
  if (!isAIEnabled(process.env)) {
    log.debug("[DM] AI is not enabled, ignoring DM");
    return;
  }
  
  // Start typing indicator while we check permissions and generate response
  await message.channel.sendTyping().catch(() => {});
  
  // Check if the user is a manager of any guild the bot is in
  const { isManager, managedGuilds } = await checkUserIsManager(client, userId);
  
  if (!isManager) {
    log.debug(`[DM] User ${userName} is not a manager of any bot guilds`);
    await message.reply({
      content: "👋 Hi! I only respond to DMs from server managers. If you manage a server where I'm installed, please make sure you have the **Manage Server** permission.",
    }).catch(err => log.error("[DM] Failed to send non-manager reply:", err.message));
    return;
  }
  
  log.info(`[DM] User ${userName} manages ${managedGuilds.length} guild(s): ${managedGuilds.map(g => g.name).join(", ")}`);
  
  // Get user's session
  const session = getUserSession(userId);
  
  // If user only has one server, auto-select it
  if (managedGuilds.length === 1 && !session.selectedGuildId) {
    setUserSelectedGuild(userId, managedGuilds[0].id, managedGuilds[0].name);
  }
  
  // Check if user is trying to select a server
  const serverSelection = parseServerSelection(content, managedGuilds);
  
  if (serverSelection.matched) {
    if (serverSelection.listServers) {
      // User wants to list their servers
      const response = formatServerList(managedGuilds, session.selectedGuildId);
      await message.reply({ content: response }).catch(err => 
        log.error("[DM] Failed to send server list:", err.message)
      );
      return;
    }
    
    if (serverSelection.notFound) {
      // Server selection attempted but no match
      const response = `❌ I couldn't find a server matching "${serverSelection.query}".\n\n` +
        formatServerList(managedGuilds, session.selectedGuildId);
      await message.reply({ content: response }).catch(err => 
        log.error("[DM] Failed to send server not found:", err.message)
      );
      return;
    }
    
    if (serverSelection.guildId) {
      // Successfully matched a server
      setUserSelectedGuild(userId, serverSelection.guildId, serverSelection.guildName);
      const response = `✅ Switched to **${serverSelection.guildName}**. I'll now answer questions about this server.\n\nWhat would you like to know?`;
      await message.reply({ content: response }).catch(err => 
        log.error("[DM] Failed to send server selection confirmation:", err.message)
      );
      return;
    }
  }
  
  // Get updated session after potential auto-selection
  const currentSession = getUserSession(userId);
  
  // Find the selected guild object from managed guilds
  const selectedGuild = currentSession.selectedGuildId 
    ? managedGuilds.find(g => g.id === currentSession.selectedGuildId)
    : null;
  
  // Check if user is a superadmin
  const isSuperAdmin = checkIsSuperAdmin(userId);
  if (isSuperAdmin) {
    log.info(`[DM] User ${userName} is a superadmin`);
  }
  
  // Add user message to conversation history
  addToConversationHistory(userId, "user", content);
  
  // Generate AI response with MCP tool access
  const aiResult = await generateChatResponse({
    message: content,
    userName,
    userId,
    isSuperAdmin, // Pass superadmin status
    history: currentSession.conversationHistory.slice(0, -1), // Exclude the message we just added (it's passed separately)
    managedGuilds, // Pass all guilds so AI knows what's available
    selectedGuild, // Pass the currently selected guild
    selectedGuildId: currentSession.selectedGuildId,
    selectedGuildName: currentSession.selectedGuildName,
  }, process.env);
  
  if (!aiResult.success) {
    log.error("[DM] AI response failed:", aiResult.error);
    await message.reply({
      content: "Sorry, I encountered an error while processing your message. Please try again later.",
    }).catch(err => log.error("[DM] Failed to send error reply:", err.message));
    return;
  }
  
  // Store the AI response in conversation history
  addToConversationHistory(userId, "assistant", aiResult.response);
  
  // Log if tools were used
  if (aiResult.toolsUsed && aiResult.toolsUsed.length > 0) {
    log.info(`[DM] AI used MCP tools: ${aiResult.toolsUsed.join(", ")}`);
  }
  
  // Send the AI response
  // Discord has a 2000 character limit, so we may need to split
  const response = aiResult.response;
  
  if (response.length <= 2000) {
    await message.reply({ content: response }).catch(err => 
      log.error("[DM] Failed to send AI reply:", err.message)
    );
  } else {
    // Split into multiple messages
    const chunks = response.match(/[\s\S]{1,1990}/g) || [];
    for (const chunk of chunks) {
      await message.channel.send({ content: chunk }).catch(err =>
        log.error("[DM] Failed to send AI reply chunk:", err.message)
      );
    }
  }
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

function getActiveVoiceSessionsForGuild(guild) {
  const activeSessions = [];
  const seenUserIds = new Set();

  for (const voiceState of guild.voiceStates.cache.values()) {
    if (!voiceState.channelId) {
      continue;
    }

    const userId = voiceState.id || voiceState.member?.id;
    if (!userId || seenUserIds.has(userId)) {
      continue;
    }

    seenUserIds.add(userId);
    const member = voiceState.member;
    const user = member?.user;
    activeSessions.push({
      user_id: userId,
      channel_id: voiceState.channelId,
      channel_name: voiceState.channel?.name || null,
      user_name: user?.username || user?.tag || null,
      display_name: member?.displayName || user?.globalName || user?.username || null,
      avatar_url: member?.displayAvatarURL?.({ size: 64 }) || user?.displayAvatarURL?.({ size: 64 }) || null,
      self_mute: Boolean(voiceState.selfMute),
      self_deaf: Boolean(voiceState.selfDeaf),
      server_mute: Boolean(voiceState.serverMute),
      server_deaf: Boolean(voiceState.serverDeaf),
      streaming: Boolean(voiceState.streaming),
      self_video: Boolean(voiceState.selfVideo),
      suppress: Boolean(voiceState.suppress),
    });
  }

  return activeSessions;
}

function buildGuildLiveVoiceSnapshot(guild) {
  return buildLiveVoiceSnapshot(
    getActiveVoiceSessionsForGuild(guild),
    new Date().toISOString(),
  );
}

function broadcastGuildLiveVoiceSnapshot(guild, reason) {
  if (!guild) {
    return;
  }

  broadcastLiveUpdate(guild.id, "voice_snapshot", {
    type: "voice_snapshot",
    guildId: guild.id,
    reason,
    data: buildGuildLiveVoiceSnapshot(guild),
  });
}

async function postVoiceSessionSnapshot(guild, reason) {
  const response = await fetch(`${API_BASE}/api/voice/reconcile`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bot ${process.env.DISCORD_BOT_TOKEN}`,
    },
    body: JSON.stringify({
      guild_id: guild.id,
      reason,
      active_sessions: getActiveVoiceSessionsForGuild(guild),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Voice reconciliation failed for guild ${guild.id}: ${response.status} ${errorText}`);
  }

  return response.json();
}

async function syncGuildLiveVoiceSnapshot(guild, reason) {
  if (!guild) {
    return;
  }

  broadcastGuildLiveVoiceSnapshot(guild, reason);

  try {
    await postVoiceSessionSnapshot(guild, reason);
  } catch (error) {
    log.warn(`[VoiceSessions] Live snapshot sync failed for guild ${guild.id} after ${reason}:`, error.message);
  }
}

async function reconcileVoiceSessionsViaAPI(client, reason) {
  const now = Date.now();
  if (voiceSessionReconcileInFlight) {
    return;
  }

  if (now - lastVoiceSessionReconcileAt < VOICE_SESSION_RECONCILE_COOLDOWN_MS) {
    log.debug(`[VoiceSessions] Skipping reconciliation for ${reason}; cooldown active`);
    return;
  }

  voiceSessionReconcileInFlight = true;
  lastVoiceSessionReconcileAt = now;

  try {
    let guildsProcessed = 0;
    let closedSessions = 0;
    let createdSessions = 0;
    let duplicateSessionsClosed = 0;

    for (const guild of client.guilds.cache.values()) {
      const result = await postVoiceSessionSnapshot(guild, reason);
      broadcastGuildLiveVoiceSnapshot(guild, reason);
      guildsProcessed++;
      closedSessions += result.closedSessions || 0;
      createdSessions += result.createdSessions || 0;
      duplicateSessionsClosed += result.duplicateSessionsClosed || 0;
    }

    if (closedSessions > 0 || createdSessions > 0 || duplicateSessionsClosed > 0) {
      log.info(
        `[VoiceSessions] Reconciled ${guildsProcessed} guilds after ${reason}: closed=${closedSessions}, created=${createdSessions}, duplicates_closed=${duplicateSessionsClosed}`
      );
    } else {
      log.debug(`[VoiceSessions] Reconciled ${guildsProcessed} guilds after ${reason} with no changes`);
    }
  } catch (error) {
    log.warn(`[VoiceSessions] Reconciliation after ${reason} failed:`, error.message);
  } finally {
    voiceSessionReconcileInFlight = false;
  }
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
      
      // Build list of actions to execute
      const actionsToExecute = [];
      if (
        automation.action_config?.actions &&
        Array.isArray(automation.action_config.actions)
      ) {
        for (const action of automation.action_config.actions) {
          actionsToExecute.push({
            actionType: action.type,
            actionConfig: action.config || {},
            actionAutomation: {
              ...automation,
              action_type: action.type,
              action_config: action.config || {},
              processed_content: action.config?.content,
              processed_reason: action.config?.reason,
              processed_thread_name: action.config?.thread_name,
            },
          });
        }
      } else {
        actionsToExecute.push({
          actionType: automation.action_type,
          actionConfig: automation.action_config || {},
          actionAutomation: automation,
        });
      }

      // Execute all actions and track per-action results
      const actionResults = [];
      let allSuccess = true;
      let firstError = null;

      for (let i = 0; i < actionsToExecute.length; i++) {
        const { actionType, actionConfig, actionAutomation } = actionsToExecute[i];
        const actionResult = {
          actionIndex: i,
          actionType,
          actionConfig,
        };

        try {
          const result = await executeAutomationAction(actionAutomation, event);
          actionResult.success = true;
          if (result !== undefined) actionResult.result = result;
        } catch (error) {
          actionResult.success = false;
          actionResult.error = error.message;
          allSuccess = false;
          if (!firstError) firstError = error.message;
          log.error(
            `[Automation] ${automation.name} - action ${i + 1}/${actionsToExecute.length} (${actionType}) failed: ${error.message}`,
          );
          // Continue executing remaining actions even if one fails
        }

        actionResults.push(actionResult);
      }

      // Report results back to API with per-action details
      try {
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
            success: allSuccess,
            error_message: firstError,
            action_result: actionResults,
          }),
        });
      } catch (logError) {
        log.error(`[Automation] Failed to log execution:`, logError.message);
      }

      if (allSuccess) {
        log.info(`[Automation] ${automation.name} - all ${actionsToExecute.length} action(s) executed successfully`);
      } else {
        log.error(`[Automation] ${automation.name} - completed with errors`);
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

  // Helper to schedule a message via API instead of sending immediately
  async function scheduleMessageViaAPI(params) {
    const url = `${API_BASE}/api/scheduled-messages`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      },
      body: JSON.stringify(params),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to schedule message: ${errorText}`);
    }
    return await response.json();
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
      const userId = resolveTargetUser(action_config, event);

      if (!userId) {
        throw new Error("Missing user ID");
      }

      const guild = await client.guilds.fetch(event.guild_id);
      if (!guild) throw new Error("Guild not found");

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
      return { totalDeleted, channelsProcessed: channelsToProcess.length };
    }

    case "DELETE_MESSAGES": {
      const channelIds = action_config.channel_ids;
      const limit = action_config.limit || 100;
      const userId = resolveTargetUser(action_config, event);

      if (!userId) {
        throw new Error("Missing user ID");
      }

      const guild = await client.guilds.fetch(event.guild_id);
      if (!guild) throw new Error("Guild not found");

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

      for (const channelId of channelsToProcess) {
        if (totalDeleted >= limit) break;

        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel || !channel.messages) continue;

        try {
          // Fetch messages and filter by user
          const messages = await channel.messages.fetch({ limit: 100 });
          const userMessages = messages.filter((m) => m.author.id === userId);
          const remainingQuota = limit - totalDeleted;
          const toDelete = Array.from(userMessages.values()).slice(0, remainingQuota);

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
      return { totalDeleted, channelsProcessed: channelsToProcess.length };
    }

    case "DELETE_MENTIONED_MESSAGES": {
      const channelIds = action_config.channel_ids;
      const limit = action_config.limit || 100;
      const userId = resolveTargetUser(action_config, event);

      if (!userId) {
        throw new Error("Missing user ID");
      }

      if (!channelIds) {
        throw new Error("No channels specified");
      }

      const guild = await client.guilds.fetch(event.guild_id);
      if (!guild) throw new Error("Guild not found");

      // Parse comma-separated channel IDs
      const channelsToProcess = channelIds
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);

      let totalDeleted = 0;

      for (const channelId of channelsToProcess) {
        if (totalDeleted >= limit) break;

        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel || !channel.messages) continue;

        try {
          // Fetch messages and filter by mentions
          const messages = await channel.messages.fetch({ limit: 100 });
          const mentionedMessages = messages.filter((m) => m.mentions.has(userId));
          const remainingQuota = limit - totalDeleted;
          const toDelete = Array.from(mentionedMessages.values()).slice(
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
            `[Automation] Deleted ${toDelete.length} messages mentioning <@${userId}> in #${channel.name}`,
          );
        } catch (err) {
          log.error(
            `[Automation] Error deleting in ${channelId}:`,
            err.message,
          );
        }
      }

      log.info(
        `[Automation] Total deleted: ${totalDeleted} messages mentioning user`,
      );
      return { totalDeleted, channelsProcessed: channelsToProcess.length };
    }

    case "SEND_MESSAGE": {
      const content = automation.processed_content || action_config.content;

      // Ephemeral: send as interaction followup visible only to the user
      if (action_config.ephemeral && event.application_id && event.interaction_token) {
        if (!content) throw new Error("Missing message content");
        const payload = { flags: 64 };
        if (action_config.embed) {
          const embed = { description: content, color: 0x5865F2, timestamp: new Date().toISOString() };
          if (action_config.embed_thumbnail_url) embed.thumbnail = { url: action_config.embed_thumbnail_url };
          payload.embeds = [embed];
        } else {
          payload.content = content;
        }
        const res = await fetch(
          `https://discord.com/api/v10/webhooks/${event.application_id}/${event.interaction_token}`,
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
        return { sent: true, ephemeral: true };
      }

      const channelId = action_config.channel_id;

      log.debug(`[SEND_MESSAGE] channelId: ${channelId}, content: ${content}`);
      log.debug(`[SEND_MESSAGE] action_config:`, JSON.stringify(action_config));

      if (!channelId || !content) throw new Error(`Missing channel or content - channelId: ${channelId}, content: ${content}`);

      // Schedule for later if configured
      if (action_config.send_later && action_config.send_later_delay) {
        const result = await scheduleMessageViaAPI({
          guild_id: event.guild_id,
          channel_id: channelId,
          action_type: "SEND_MESSAGE",
          message_payload: { content, embed: !!action_config.embed, embed_color: action_config.embed ? 0x5865F2 : null, ...(action_config.embed_thumbnail_url ? { embed_thumbnail_url: action_config.embed_thumbnail_url } : {}) },
          delay: action_config.send_later_delay,
          created_by: event.actor_id,
          source_automation_id: automation.id,
        });
        return { scheduled: true, send_at: result.send_at };
      }

      const channel = await client.channels.fetch(channelId);
      if (!channel) throw new Error("Channel not found");

      if (action_config.embed) {
        const msg = await channel.send({
          embeds: [{
            description: content,
            color: 0x5865F2,
            timestamp: new Date().toISOString(),
            ...(action_config.embed_thumbnail_url ? { thumbnail: { url: action_config.embed_thumbnail_url } } : {}),
          }],
        });
        return { messageId: msg.id, channelId, embed: true };
      } else {
        const msg = await channel.send(content);
        return { messageId: msg.id, channelId };
      }
    }

    case "SEND_MESSAGE_WITH_BUTTONS": {
      const content = automation.processed_content || action_config.content;

      // Build button components
      const { buildButtonComponents } = await import("../automation/engine.js");
      const buttonComponents = buildButtonComponents(
        action_config.buttons || [],
        event.guild_id,
        automation.id
      );

      // Ephemeral: send as interaction followup visible only to the user
      if (action_config.ephemeral && event.application_id && event.interaction_token) {
        if (!content) throw new Error("Missing message content");
        const payload = { flags: 64, components: buttonComponents };
        if (action_config.embed) {
          const embed = { description: content, color: 0x5865F2, timestamp: new Date().toISOString() };
          if (action_config.embed_thumbnail_url) embed.thumbnail = { url: action_config.embed_thumbnail_url };
          payload.embeds = [embed];
        } else {
          payload.content = content;
        }
        const res = await fetch(
          `https://discord.com/api/v10/webhooks/${event.application_id}/${event.interaction_token}`,
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
        return { sent: true, ephemeral: true, buttonsAttached: buttonComponents.length };
      }

      const channelId = action_config.channel_id;

      if (!channelId || !content) throw new Error("Missing channel or content");

      // Schedule for later if configured
      if (action_config.send_later && action_config.send_later_delay) {
        const messagePayload = { content, embed: !!action_config.embed, embed_color: action_config.embed ? 0x5865F2 : null, ...(action_config.embed_thumbnail_url ? { embed_thumbnail_url: action_config.embed_thumbnail_url } : {}), components: buttonComponents };
        const result = await scheduleMessageViaAPI({
          guild_id: event.guild_id,
          channel_id: channelId,
          action_type: "SEND_MESSAGE_WITH_BUTTONS",
          message_payload: messagePayload,
          delay: action_config.send_later_delay,
          created_by: event.actor_id,
          source_automation_id: automation.id,
        });
        return { scheduled: true, send_at: result.send_at, buttonsAttached: buttonComponents.length };
      }

      const channel = await client.channels.fetch(channelId);
      if (!channel) throw new Error("Channel not found");

      const messagePayload = { components: buttonComponents };

      if (action_config.embed) {
        messagePayload.embeds = [{
          description: content,
          color: 0x5865F2,
          timestamp: new Date().toISOString(),
          ...(action_config.embed_thumbnail_url ? { thumbnail: { url: action_config.embed_thumbnail_url } } : {}),
        }];
      } else {
        messagePayload.content = content;
      }

      const msg = await channel.send(messagePayload);
      return { messageId: msg.id, channelId, buttonsAttached: buttonComponents.length };
    }

    case "SEND_STATS_WIDGET_IMAGE": {
      const channelSource = action_config.channel_source || "configured";
      const channelId = channelSource === "trigger"
        ? event.channel_id
        : action_config.channel_id;
      const widgetType = action_config.widget_type || "voice_time";
      const period = action_config.period || "30d";
      const content = automation.processed_content || action_config.content || "";

      if (!channelId) {
        throw new Error(channelSource === "trigger"
          ? "No trigger channel available for this event"
          : "Missing channel");
      }

      const channel = await client.channels.fetch(channelId);
      if (!channel) throw new Error("Channel not found");

      const signingSecret = process.env.DISCORD_PUBLIC_KEY;
      const origin = resolveWidgetOrigin();
      const { pngData, filename, widgetInfo, periodLabel } = await fetchSignedWidgetPng({
        guildId: event.guild_id,
        type: widgetType,
        period,
        secret: signingSecret,
        origin,
      });

      const payload = {
        files: [{ attachment: pngData, name: filename }],
      };
      if (content) payload.content = content;

      const msg = await channel.send(payload);
      return {
        messageId: msg?.id,
        channelId,
        widgetType,
        widgetName: widgetInfo.name,
        period,
        periodLabel,
      };
    }

    case "SEND_DM": {
      const userId = resolveTargetUser(action_config, event);
      const content = automation.processed_content || action_config.content;

      if (!userId) throw new Error("Missing target user");
      if (!content) throw new Error("Missing message content");

      // Schedule for later if configured
      if (action_config.send_later && action_config.send_later_delay) {
        const result = await scheduleMessageViaAPI({
          guild_id: event.guild_id,
          target_user_id: userId,
          action_type: "SEND_DM",
          message_payload: { content, embed: !!action_config.embed, embed_color: action_config.embed ? 0x5865F2 : null, ...(action_config.embed_thumbnail_url ? { embed_thumbnail_url: action_config.embed_thumbnail_url } : {}) },
          delay: action_config.send_later_delay,
          created_by: event.actor_id,
          source_automation_id: automation.id,
        });
        return { scheduled: true, send_at: result.send_at, userId };
      }

      const user = await client.users.fetch(userId);
      if (!user) throw new Error("User not found");

      if (action_config.embed) {
        await user.send({
          embeds: [{
            description: content,
            color: 0x5865F2,
            timestamp: new Date().toISOString(),
            ...(action_config.embed_thumbnail_url ? { thumbnail: { url: action_config.embed_thumbnail_url } } : {}),
          }],
        });
        return { dmSent: true, userId, embed: true };
      } else {
        await user.send(content);
        return { dmSent: true, userId };
      }
    }

    case "ADD_ROLE": {
      // Support both legacy role_id (single) and new role_ids (comma-separated)
      const roleIds = action_config.role_ids
        ? action_config.role_ids.split(',').map(id => id.trim()).filter(Boolean)
        : action_config.role_id ? [action_config.role_id] : [];
      const userId = resolveTargetUser(action_config, event);

      if (roleIds.length === 0 || !userId) throw new Error(`Missing role or user ID (role_ids: ${roleIds.join(',') || 'none'}, actor_id: ${event.actor_id || 'none'}, target_id: ${event.target_id || 'none'})`);

      const guild = await client.guilds.fetch(event.guild_id);
      if (!guild) throw new Error("Guild not found");

      const member = await guild.members.fetch(userId);
      if (!member) throw new Error("Member not found");

      for (const roleId of roleIds) {
        await member.roles.add(roleId);
      }
      return { userId, rolesAdded: roleIds };
    }

    case "REMOVE_ROLE": {
      // Support both legacy role_id (single) and new role_ids (comma-separated)
      const roleIds = action_config.role_ids
        ? action_config.role_ids.split(',').map(id => id.trim()).filter(Boolean)
        : action_config.role_id ? [action_config.role_id] : [];
      const userId = resolveTargetUser(action_config, event);

      if (roleIds.length === 0 || !userId) throw new Error(`Missing role or user ID (role_ids: ${roleIds.join(',') || 'none'}, actor_id: ${event.actor_id || 'none'}, target_id: ${event.target_id || 'none'})`);

      const guild = await client.guilds.fetch(event.guild_id);
      if (!guild) throw new Error("Guild not found");

      const member = await guild.members.fetch(userId);
      if (!member) throw new Error("Member not found");

      for (const roleId of roleIds) {
        await member.roles.remove(roleId);
      }
      return { userId, rolesRemoved: roleIds };
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
      return { userId, reason };
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
      return { userId, reason, deleteDays };
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
      return { userId, durationMinutes, reason };
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

      const logMsg = await channel.send({ embeds: [embed] });
      return { messageId: logMsg.id, channelId };
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

      const thread = await channel.threads.create({
        name: threadName.substring(0, 100),
        autoArchiveDuration: autoArchive,
      });
      return { threadId: thread.id, threadName: threadName.substring(0, 100) };
    }

    case "ADD_REACTION": {
      const emoji = action_config.emoji;
      // For SLASH_COMMAND_USE events, messageId is the bot's response message
      const messageId = event.details?.messageId;
      const channelId = event.channel_id;

      if (!emoji) {
        throw new Error("Missing emoji");
      }

      if (!messageId) {
        throw new Error("No message ID available - this action requires a message event");
      }

      if (!channelId) {
        throw new Error("No channel ID available");
      }

      const channel = await client.channels.fetch(channelId);
      if (!channel) throw new Error("Channel not found");

      const message = await channel.messages.fetch(messageId);
      if (!message) throw new Error("Message not found");

      // Handle custom emoji format (e.g., <:name:id> or just the emoji)
      await message.react(emoji.trim());
      log.info(`[Automation] Added reaction ${emoji} to message ${messageId}`);
      return { emoji, messageId, channelId };
    }

    case "SERVER_MUTE": {
      const userId = resolveTargetUser(action_config, event);
      const reason = automation.processed_reason || action_config.reason || "Automated action";

      if (!userId) throw new Error("Missing user ID");

      const guild = await client.guilds.fetch(event.guild_id);
      if (!guild) throw new Error("Guild not found");

      const member = await guild.members.fetch(userId);
      if (!member) throw new Error("Member not found");

      if (!member.voice.channelId) {
        throw new Error("Member is not in a voice channel");
      }

      await member.voice.setMute(true, reason);
      return { userId, reason };
    }

    case "SERVER_UNMUTE": {
      const userId = resolveTargetUser(action_config, event);
      const reason = automation.processed_reason || action_config.reason || "Automated action";

      if (!userId) throw new Error("Missing user ID");

      const guild = await client.guilds.fetch(event.guild_id);
      if (!guild) throw new Error("Guild not found");

      const member = await guild.members.fetch(userId);
      if (!member) throw new Error("Member not found");

      if (!member.voice.channelId) {
        throw new Error("Member is not in a voice channel");
      }

      await member.voice.setMute(false, reason);
      return { userId, reason };
    }

    case "SERVER_DEAFEN": {
      const userId = resolveTargetUser(action_config, event);
      const reason = automation.processed_reason || action_config.reason || "Automated action";

      if (!userId) throw new Error("Missing user ID");

      const guild = await client.guilds.fetch(event.guild_id);
      if (!guild) throw new Error("Guild not found");

      const member = await guild.members.fetch(userId);
      if (!member) throw new Error("Member not found");

      if (!member.voice.channelId) {
        throw new Error("Member is not in a voice channel");
      }

      await member.voice.setDeaf(true, reason);
      return { userId, reason };
    }

    case "SERVER_UNDEAFEN": {
      const userId = resolveTargetUser(action_config, event);
      const reason = automation.processed_reason || action_config.reason || "Automated action";

      if (!userId) throw new Error("Missing user ID");

      const guild = await client.guilds.fetch(event.guild_id);
      if (!guild) throw new Error("Guild not found");

      const member = await guild.members.fetch(userId);
      if (!member) throw new Error("Member not found");

      if (!member.voice.channelId) {
        throw new Error("Member is not in a voice channel");
      }

      await member.voice.setDeaf(false, reason);
      return { userId, reason };
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
 * Extract user information including avatar for logging
 * @param {Discord.User|Discord.PartialUser} user - Discord user object
 * @returns {Object} Object with id, name, is_bot, avatar, and discriminator
 */
function getUserLogInfo(user) {
  if (!user) return {};
  return {
    id: user.id,
    name: user.tag || user.username || 'Unknown User',
    is_bot: user.bot || false,
    avatar: user.avatar || null,
    discriminator: user.discriminator || '0',
  };
}

/**
 * Set up all event handlers
 */
function setupEventHandlers(client, logFn) {
  // ===== MEMBER EVENTS =====

  client.on(Events.GuildMemberAdd, async (member) => {
    const userInfo = getUserLogInfo(member.user);
    await logFn({
      guild_id: member.guild.id,
      event_type: "MEMBER_JOIN",
      event_category: "member",
      actor_id: userInfo.id,
      actor_name: member.user.tag,
      actor_is_bot: member.user.bot || false,
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
      actor_is_bot: member.user.bot || false,
      details: {
        roles: member.roles?.cache.map((r) => r.name) || [],
        joinedAt: member.joinedAt?.toISOString(),
      },
    });
  });

  client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    const changes = {};

    // Check if member accepted server rules (membership screening)
    if (oldMember.pending === true && newMember.pending === false) {
      changes.rules_accepted = true;
    }

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
    
    // Handle DMs separately - AI chat for bot managers
    if (!message.guild) {
      try {
        await handleDirectMessage(message, client);
      } catch (error) {
        log.error("[DM] Error handling DM:", error.message);
      }
      return;
    }

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

        // Extract embed texts for success/failure detection
        const cmdEmbedTexts = message.embeds.map((embed) => {
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

        // First mentioned non-bot user (often the command invoker mentioned in bot response)
        const cmdMentionedUsers = message.mentions.users.map((u) => ({
          id: u.id,
          tag: u.tag,
          bot: u.bot,
        }));
        const firstCmdMentionedHuman = cmdMentionedUsers.find((u) => !u.bot);

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
            // Include content and embeds for success/failure detection
            content: message.content?.substring(0, 500) || "",
            embedTexts: cmdEmbedTexts,
            hasEmbeds: message.embeds.length > 0,
            embedCount: message.embeds.length,
            // Include mentioned user (useful for thanking bumpers, etc.)
            mentionedUserId: firstCmdMentionedHuman?.id || null,
            mentionedUserTag: firstCmdMentionedHuman?.tag || null,
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
      actor_is_bot: message.author.bot || false,
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
        isOwnBot: message.author.id === message.client.user?.id,
        actor_roles: message.member?.roles?.cache.map((r) => r.id) || [],
      },
    });
  });

  client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
    if (!newMessage.guild) return;

    // Check if this is a slash command response that now has embeds
    // Many bots (like DISBOARD) use deferred responses - they send an initial message
    // then edit it to add the actual result embed
    if (
      (newMessage.type === MessageType.ChatInputCommand ||
        newMessage.type === MessageType.ContextMenuCommand) &&
      newMessage.embeds.length > 0 &&
      (!oldMessage.embeds || oldMessage.embeds.length === 0)
    ) {
      // This is a slash command response that just got its embed added
      const interaction = newMessage.interaction || newMessage.interactionMetadata;
      
      if (interaction) {
        const userId = interaction.user?.id || interaction.userId;
        const userName = interaction.user?.tag || interaction.user?.username || "Unknown User";
        const cmdName = interaction.commandName || interaction.name || "unknown";

        // Extract embed texts for success/failure detection
        const embedTexts = newMessage.embeds.map((embed) => {
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

        // First mentioned non-bot user
        const mentionedUsers = newMessage.mentions.users.map((u) => ({
          id: u.id,
          tag: u.tag,
          bot: u.bot,
        }));
        const firstMentionedHuman = mentionedUsers.find((u) => !u.bot);

        log.debug(`[DEBUG] Slash command response updated with embed: ${cmdName} by ${userName}`);
        log.debug(`[DEBUG] Embed texts: ${JSON.stringify(embedTexts)}`);

        // Log as SLASH_COMMAND_RESPONSE - this is the actual result of the command
        await logFn({
          guild_id: newMessage.guild.id,
          event_type: "SLASH_COMMAND_RESPONSE",
          event_category: "interaction",
          actor_id: userId,
          actor_name: userName,
          target_id: newMessage.author.id, // The bot that responded
          target_name: newMessage.author.tag || newMessage.author.username,
          channel_id: newMessage.channel.id,
          channel_name: newMessage.channel.name,
          details: {
            commandName: cmdName,
            commandType: newMessage.type === MessageType.ChatInputCommand ? "slash" : "context_menu",
            botId: newMessage.author.id,
            botName: newMessage.author.tag || newMessage.author.username,
            messageId: newMessage.id,
            isExternalBot: newMessage.author.id !== newMessage.client.user?.id,
            content: newMessage.content?.substring(0, 500) || "",
            embedTexts: embedTexts,
            hasEmbeds: true,
            embedCount: newMessage.embeds.length,
            mentionedUserId: firstMentionedHuman?.id || null,
            mentionedUserTag: firstMentionedHuman?.tag || null,
          },
        });
      }
    }

    // Extract embed texts for regular message update logging
    const updateEmbedTexts = newMessage.embeds.map((embed) => {
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

    await logFn({
      guild_id: newMessage.guild.id,
      event_type: "MESSAGE_UPDATE",
      event_category: "message",
      actor_id: newMessage.author?.id,
      actor_name: newMessage.author?.tag,
      channel_id: newMessage.channel.id,
      channel_name: newMessage.channel.name,
      details: {
        messageId: newMessage.id,
        oldContentLength: oldMessage.content?.length,
        newContentLength: newMessage.content?.length,
        hasEmbeds: newMessage.embeds.length > 0,
        embedCount: newMessage.embeds.length,
        embedTexts: updateEmbedTexts,
        isBot: newMessage.author?.bot || false,
      },
    });
  });

  client.on(Events.MessageDelete, async (message) => {
    if (!message.guild) return;

    // Try to determine who deleted the message via audit logs
    let deletedBy = null;
    try {
      const auditLogs = await message.guild.fetchAuditLogs({
        type: AuditLogEvent.MessageDelete,
        limit: 5,
      });
      const entry = auditLogs.entries.find(
        (e) =>
          e.target?.id === message.author?.id &&
          e.extra?.channel?.id === message.channel.id &&
          Date.now() - e.createdTimestamp < 5000,
      );
      if (entry) {
        deletedBy = { id: entry.executor.id, name: entry.executor.tag };
      }
    } catch {
      // Bot may lack VIEW_AUDIT_LOG permission — fall through
    }

    // If no audit log entry, the author likely deleted their own message
    const actorId = deletedBy?.id || message.author?.id;
    const actorName = deletedBy?.name || message.author?.tag || "Unknown";

    await logFn({
      guild_id: message.guild.id,
      event_type: "MESSAGE_DELETE",
      event_category: "message",
      actor_id: actorId,
      actor_name: actorName,
      target_id: message.author?.id,
      target_name: message.author?.tag,
      channel_id: message.channel.id,
      channel_name: message.channel.name,
      details: {
        messageId: message.id,
        content: message.content || null,
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
    const scheduleLiveVoiceSync = () => {
      syncGuildLiveVoiceSnapshot(newState.guild || oldState.guild, "voice_state_update");
    };

    // User joined a voice channel
    if (!oldState.channel && newState.channel) {
      await logFn({
        guild_id: guildId,
        event_type: "VOICE_JOIN",
        event_category: "voice",
        actor_id: member.user.id,
        actor_name: member.user.tag,
        actor_is_bot: member.user.bot || false,
        channel_id: newState.channel.id,
        channel_name: newState.channel.name,
        details: {
          selfMute: newState.selfMute,
          selfDeaf: newState.selfDeaf,
          streaming: newState.streaming,
          selfVideo: newState.selfVideo,
          actor_roles: member.roles?.cache.map((r) => r.id) || [],
        },
      });
      scheduleLiveVoiceSync();
      return; // Don't check for state changes on initial join
    }

    // User left a voice channel
    if (oldState.channel && !newState.channel) {
      // Log video/streaming stop events if they were active when leaving
      if (oldState.selfVideo) {
        await logFn({
          guild_id: guildId,
          event_type: "VOICE_VIDEO_STOP",
          event_category: "voice",
          actor_id: member.user.id,
          actor_name: member.user.tag,
          actor_is_bot: member.user.bot || false,
          channel_id: oldState.channel.id,
          channel_name: oldState.channel.name,
          details: { videoEnabled: false, reason: "left_channel" },
        });
      }
      if (oldState.streaming) {
        await logFn({
          guild_id: guildId,
          event_type: "VOICE_STREAM_STOP",
          event_category: "voice",
          actor_id: member.user.id,
          actor_name: member.user.tag,
          actor_is_bot: member.user.bot || false,
          channel_id: oldState.channel.id,
          channel_name: oldState.channel.name,
          details: { streaming: false, reason: "left_channel" },
        });
      }

      await logFn({
        guild_id: guildId,
        event_type: "VOICE_LEAVE",
        event_category: "voice",
        actor_id: member.user.id,
        actor_name: member.user.tag,
        actor_is_bot: member.user.bot || false,
        channel_id: oldState.channel.id,
        channel_name: oldState.channel.name,
        details: {
          // Include final state when leaving
          wasMuted: oldState.selfMute,
          wasDeafened: oldState.selfDeaf,
          wasStreaming: oldState.streaming,
          hadVideo: oldState.selfVideo,
          actor_roles: member.roles?.cache.map((r) => r.id) || [],
        },
      });
      scheduleLiveVoiceSync();
      return;
    }

    // User moved between voice channels
    if (
      oldState.channel && newState.channel &&
      oldState.channel.id !== newState.channel.id
    ) {
      // Log video/streaming stop events if they were active when moving
      if (oldState.selfVideo) {
        await logFn({
          guild_id: guildId,
          event_type: "VOICE_VIDEO_STOP",
          event_category: "voice",
          actor_id: member.user.id,
          actor_name: member.user.tag,
          actor_is_bot: member.user.bot || false,
          channel_id: oldState.channel.id,
          channel_name: oldState.channel.name,
          details: { videoEnabled: false, reason: "moved_channel" },
        });
      }
      if (oldState.streaming) {
        await logFn({
          guild_id: guildId,
          event_type: "VOICE_STREAM_STOP",
          event_category: "voice",
          actor_id: member.user.id,
          actor_name: member.user.tag,
          actor_is_bot: member.user.bot || false,
          channel_id: oldState.channel.id,
          channel_name: oldState.channel.name,
          details: { streaming: false, reason: "moved_channel" },
        });
      }

      await logFn({
        guild_id: guildId,
        event_type: "VOICE_MOVE",
        event_category: "voice",
        actor_id: member.user.id,
        actor_name: member.user.tag,
        actor_is_bot: member.user.bot || false,
        channel_id: newState.channel.id,
        channel_name: newState.channel.name,
        details: {
          fromChannelId: oldState.channel.id,
          fromChannelName: oldState.channel.name,
          actor_roles: member.roles?.cache.map((r) => r.id) || [],
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
        actor_is_bot: member.user.bot || false,
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
        actor_is_bot: member.user.bot || false,
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
        actor_is_bot: member.user.bot || false,
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
        actor_is_bot: member.user.bot || false,
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

    scheduleLiveVoiceSync();
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
      const customId = interaction.customId;
      
      // Log the button click event
      await logFn({
        guild_id: interaction.guild.id,
        event_type: "BUTTON_CLICK",
        event_category: "interaction",
        actor_id: interaction.user.id,
        actor_name: interaction.user.tag,
        channel_id: interaction.channel?.id,
        channel_name: interaction.channel?.name,
        details: {
          customId,
          messageId: interaction.message?.id,
        },
      });

      // Handle SpaceBot button actions (custom_id format: sb_{guildId}_{sourceId}_{buttonId})
      if (customId.startsWith("sb_")) {
        try {
          // Defer the reply while we process actions
          await interaction.deferReply({ ephemeral: true }).catch(() => {});
          
          const response = await fetch(`${API_BASE}/api/buttons/${interaction.guild.id}/click`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bot ${process.env.DISCORD_BOT_TOKEN}`,
            },
            body: JSON.stringify({
              custom_id: customId,
              user_id: interaction.user.id,
              user_name: interaction.user.tag,
              channel_id: interaction.channel?.id,
              message_id: interaction.message?.id,
              guild_id: interaction.guild.id,
            }),
          });

          if (response.ok) {
            const data = await response.json();
            
            // Execute the button's action sequence
            if (data.actions && data.actions.length > 0) {
              const event = {
                guild_id: interaction.guild.id,
                actor_id: interaction.user.id,
                actor_name: interaction.user.tag,
                channel_id: interaction.channel?.id,
                channel_name: interaction.channel?.name,
                event_type: "BUTTON_CLICK",
                details: { customId, buttonLabel: data.buttonLabel },
                application_id: interaction.applicationId || interaction.client?.application?.id,
                interaction_token: interaction.token,
                _bot_token: process.env.DISCORD_BOT_TOKEN,
              };

              let allSuccess = true;
              for (const action of data.actions) {
                try {
                  await executeAutomationAction({
                    id: data.sourceId,
                    name: data.sourceName || "Button Action",
                    action_type: action.type,
                    action_config: action.config || {},
                  }, event);
                } catch (err) {
                  allSuccess = false;
                  log.error(`[Button] Action ${action.type} failed:`, err.message);
                }
              }

              await interaction.editReply({
                content: allSuccess ? "✅ Action completed!" : "⚠️ Some actions had errors.",
              }).catch(() => {});
            } else {
              await interaction.editReply({ content: "✅ Button clicked!" }).catch(() => {});
            }
          } else {
            await interaction.editReply({ content: "❌ Failed to process button action." }).catch(() => {});
          }
        } catch (err) {
          log.error("[Button] Error handling button click:", err.message);
          await interaction.editReply({ content: "❌ An error occurred." }).catch(() => {});
        }
      }
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
      // For user context menu, targetUser is the right-clicked user
      // For message context menu, targetMessage.author is the message author
      const isUserCommand = interaction.isUserContextMenuCommand();
      const targetUser = isUserCommand
        ? interaction.targetUser
        : interaction.targetMessage?.author;

      await logFn({
        guild_id: interaction.guild.id,
        event_type: "CONTEXT_MENU_USE",
        event_category: "interaction",
        actor_id: interaction.user.id,
        actor_name: interaction.user.tag,
        target_id: targetUser?.id || null,
        target_name: targetUser?.tag || targetUser?.username || null,
        channel_id: interaction.channel?.id,
        channel_name: interaction.channel?.name,
        details: {
          commandName: interaction.commandName,
          targetType: isUserCommand ? "user" : "message",
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

  client.on(Events.ClientReady, async (c) => {
    log.info(`✅ Discord Gateway Bot is online as ${c.user.tag}`);
    log.info(`📊 Watching ${c.guilds.cache.size} guilds`);

    // Set bot avatar to the app logo if not already set
    try {
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const logoPath = path.resolve(__dirname, "../../../static/favicon-512.png");
      if (fs.existsSync(logoPath)) {
        const logoData = fs.readFileSync(logoPath);
        await c.user.setAvatar(logoData);
        log.info("🖼️ Bot avatar updated to app logo");
      } else {
        log.warn("⚠️ Logo file not found at", logoPath);
      }
    } catch (err) {
      // Ignore if avatar is already set (rate limit) or other non-critical errors
      if (err.code === 50035 || err.status === 429) {
        log.debug("Bot avatar already up to date or rate limited, skipping");
      } else {
        log.warn("⚠️ Failed to set bot avatar:", err.message);
      }
    }

    reconcileVoiceSessionsViaAPI(c, "client_ready").catch((error) => {
      log.warn("[VoiceSessions] ClientReady reconciliation failed:", error.message);
    });

    // Start gateway benchmark reporting (every 60 seconds)
    startBenchmarkReporting(c);
  });

  client.on(Events.ShardReady, (shardId, unavailableGuilds) => {
    log.info(
      `[Gateway] Shard ${shardId} ready${unavailableGuilds?.size ? ` with ${unavailableGuilds.size} unavailable guilds` : ""}`
    );
  });

  client.on(Events.ShardResume, (shardId, replayedEvents) => {
    log.info(`[Gateway] Shard ${shardId} resumed (${replayedEvents} replayed events)`);

    reconcileVoiceSessionsViaAPI(client, `shard_resume:${shardId}`).catch((error) => {
      log.warn(`[VoiceSessions] Shard ${shardId} reconciliation failed:`, error.message);
    });
  });

  client.on(Events.ShardDisconnect, (closeEvent, shardId) => {
    log.warn(`[Gateway] Shard ${shardId} disconnected (code ${closeEvent.code})`);
  });

  client.on(Events.ShardReconnecting, (shardId) => {
    log.warn(`[Gateway] Shard ${shardId} reconnecting`);
  });

  client.on(Events.ShardError, (error, shardId) => {
    log.error(`[Gateway] Shard ${shardId} error:`, error);
  });

  client.on(Events.Error, (error) => {
    log.error("Discord client error:", error);
  });

  client.on(Events.Warn, (warning) => {
    log.warn("Discord client warning:", warning);
  });
}

// Benchmark reporting timer state
let benchmarkTimer = null;
let benchmarkConfigPoll = null;
let benchmarkReportRunner = null;
let benchmarkStallStartedAt = null;
let benchmarkRecoveryInFlight = false;
let currentBenchmarkIntervalMs = 60_000;

const BENCHMARK_CONFIG_SYNC_MS = 30_000;
const BENCHMARK_STALL_GRACE_MS = 180_000;
const BENCHMARK_RECOVERY_COOLDOWN_MS = 120_000;
const GATEWAY_SHARD_STATUS_LABELS = [
  "Ready",
  "Connecting",
  "Reconnecting",
  "Idle",
  "Nearly",
  "Disconnected",
  "WaitingForGuilds",
  "Identifying",
  "Resuming",
];
let benchmarkLastRecoveryAt = 0;

function clearBenchmarkTimer() {
  if (benchmarkTimer) {
    clearTimeout(benchmarkTimer);
    benchmarkTimer = null;
  }
}

function clearBenchmarkConfigPoll() {
  if (benchmarkConfigPoll) {
    clearInterval(benchmarkConfigPoll);
    benchmarkConfigPoll = null;
  }
}

function resetBenchmarkWatchdogState() {
  benchmarkStallStartedAt = null;
}

function stopBenchmarkReporting() {
  clearBenchmarkTimer();
  clearBenchmarkConfigPoll();
  benchmarkReportRunner = null;
  resetBenchmarkWatchdogState();
}

function getShardStatusLabel(status) {
  return GATEWAY_SHARD_STATUS_LABELS[status] || String(status);
}

function getGatewayShardSummary(client) {
  const now = Date.now();
  return [...client.ws.shards.values()].map((shard) => ({
    id: shard.id,
    ping: shard.ping,
    status: getShardStatusLabel(shard.status),
    lastPingAgeSeconds:
      shard.lastPingTimestamp > 0
        ? Math.floor((now - shard.lastPingTimestamp) / 1000)
        : null,
  }));
}

function getBenchmarkRecoveryThresholdMs() {
  return Math.max(currentBenchmarkIntervalMs * 3, BENCHMARK_STALL_GRACE_MS);
}

function checkBenchmarkWatchdog(client, { ping, status, uptimeMs }) {
  if (status === "connected" && ping >= 0) {
    resetBenchmarkWatchdogState();
    return null;
  }

  const now = Date.now();
  if (!benchmarkStallStartedAt) {
    benchmarkStallStartedAt = now;
    log.warn(
      `[BenchmarkWatchdog] Gateway benchmark entered unhealthy state: status=${status}, ping=${ping}, uptime=${Math.floor(uptimeMs / 1000)}s, shards=${client.ws.shards.size}`
    );
    return null;
  }

  const stallDurationMs = now - benchmarkStallStartedAt;
  const recoveryThresholdMs = getBenchmarkRecoveryThresholdMs();
  const recoveryCooldownElapsed =
    now - benchmarkLastRecoveryAt >= BENCHMARK_RECOVERY_COOLDOWN_MS;

  if (
    !benchmarkRecoveryInFlight &&
    recoveryCooldownElapsed &&
    stallDurationMs >= recoveryThresholdMs
  ) {
    return {
      stallDurationMs,
      recoveryThresholdMs,
      shardSummary: getGatewayShardSummary(client),
    };
  }

  return null;
}

async function connectDiscordClient(token) {
  const client = createClient();
  discordClient = client;
  setupEventHandlers(client, logEventViaAPI);
  await client.login(token);
  return client;
}

async function recoverGatewayClient(reason) {
  if (benchmarkRecoveryInFlight) {
    return;
  }

  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    log.error(`[BenchmarkWatchdog] ${reason}. Cannot recover without DISCORD_BOT_TOKEN; exiting.`);
    process.exit(1);
  }

  benchmarkRecoveryInFlight = true;
  benchmarkLastRecoveryAt = Date.now();
  stopBenchmarkReporting();

  const previousClient = discordClient;
  log.error(`[BenchmarkWatchdog] ${reason}. Recycling Discord client.`);

  try {
    if (previousClient) {
      try {
        await previousClient.destroy();
      } catch (error) {
        log.warn("[BenchmarkWatchdog] Failed to destroy stalled Discord client:", error.message);
      }

      if (discordClient === previousClient) {
        discordClient = null;
      }
    }

    await connectDiscordClient(token);
    log.info("[BenchmarkWatchdog] Discord client recovered after benchmark stall");
  } catch (error) {
    log.error("[BenchmarkWatchdog] Recovery failed; exiting for process manager restart:", error);
    process.exit(1);
  } finally {
    benchmarkRecoveryInFlight = false;
  }
}

function scheduleNextBenchmark(delayMs = currentBenchmarkIntervalMs) {
  clearBenchmarkTimer();
  if (!benchmarkReportRunner) {
    return;
  }

  benchmarkTimer = setTimeout(() => {
    benchmarkTimer = null;
    const runner = benchmarkReportRunner;
    if (runner) {
      void runner();
    }
  }, delayMs);
}

function updateBenchmarkInterval(intervalSeconds, source, reschedule = false) {
  const parsedIntervalSeconds = Number.parseInt(String(intervalSeconds), 10);
  if (!Number.isFinite(parsedIntervalSeconds) || parsedIntervalSeconds <= 0) {
    return false;
  }

  const newIntervalMs = parsedIntervalSeconds * 1000;
  if (newIntervalMs === currentBenchmarkIntervalMs) {
    return false;
  }

  log.info(
    `[Benchmark] Interval changed via ${source}: ${currentBenchmarkIntervalMs / 1000}s → ${parsedIntervalSeconds}s`
  );
  currentBenchmarkIntervalMs = newIntervalMs;

  if (reschedule) {
    scheduleNextBenchmark();
  }

  return true;
}

/**
 * Start periodic gateway benchmark reporting
 * Captures WebSocket heartbeat latency and connection metrics every N seconds
 * @param {Client} client - The discord.js client
 */
function startBenchmarkReporting(client) {
  // Guard against re-entry on reconnection. ClientReady fires on every
  // reconnect — restarting the timer each time would cancel any pending
  // scheduled report and fire an immediate one while client.ws.ping is
  // still -1 (heartbeat ACK hasn't arrived yet), producing a stream of
  // "Measuring" snapshots with no latency data.  The closure already
  // holds a reference to the same Client object, so property reads
  // (ping, guilds, uptime) naturally reflect the latest connection state.
  if (benchmarkTimer || benchmarkConfigPoll || benchmarkReportRunner) {
    log.debug("[Benchmark] Already running, skipping restart on reconnect");
    return;
  }

  async function reportBenchmark() {
    try {
      // Try aggregate ping first, then check individual shards in case
      // the aggregate is stale after a reconnect.
      let ping = client.ws.ping; // -1 if not yet measured
      if (ping === -1 && client.ws.shards.size > 0) {
        for (const [, shard] of client.ws.shards) {
          if (shard.ping >= 0) {
            ping = shard.ping;
            break;
          }
        }
      }

      const guildCount = client.guilds.cache.size;
      const uptimeMs = client.uptime || 0;
      const gatewayUrl = client.ws.gateway || null;

      // Determine connection status
      let status = "connected";
      if (ping === -1) status = "measuring";
      if (!client.ws.shards.size) status = "disconnected";

      const recoveryState = checkBenchmarkWatchdog(client, { ping, status, uptimeMs });
      if (recoveryState) {
        const stallSeconds = Math.floor(recoveryState.stallDurationMs / 1000);
        log.error(
          `[BenchmarkWatchdog] Gateway benchmark stalled for ${stallSeconds}s (threshold ${Math.floor(recoveryState.recoveryThresholdMs / 1000)}s). Shards: ${safeJsonStringify(recoveryState.shardSummary)}`
        );
        await recoverGatewayClient(`Gateway benchmark stalled in status=${status} with ping=${ping}`);
        return;
      }

      const payload = {
        heartbeat_latency_ms: ping >= 0 ? ping : null,
        gateway_url: gatewayUrl,
        shard_id: 0,
        guild_count: guildCount,
        uptime_seconds: Math.floor(uptimeMs / 1000),
        status,
      };

      const url = `${API_BASE}/api/gateway/benchmark`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bot ${process.env.DISCORD_BOT_TOKEN}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        log.debug(`[Benchmark] Failed to report: ${response.status}`);
      } else {
        const result = await response.json();
        log.debug(
          `[Benchmark] Reported latency: ${ping}ms, status: ${status}, guilds: ${guildCount}, uptime: ${Math.floor(uptimeMs / 1000)}s`
        );

        if (result.benchmark_interval_seconds) {
          updateBenchmarkInterval(result.benchmark_interval_seconds, "benchmark POST response");
        }
      }
    } catch (error) {
      log.debug(`[Benchmark] Report error: ${error.message}`);
    } finally {
      if (benchmarkRecoveryInFlight || client !== discordClient) {
        return;
      }

      scheduleNextBenchmark();
    }
  }

  benchmarkReportRunner = reportBenchmark;

  async function syncBenchmarkInterval() {
    try {
      const response = await fetch(`${API_BASE}/api/gateway/benchmark`, {
        headers: {
          "Authorization": `Bot ${process.env.DISCORD_BOT_TOKEN}`,
        },
      });

      if (!response.ok) {
        log.debug(`[Benchmark] Config sync failed: ${response.status}`);
        return;
      }

      const result = await response.json();
      if (result.benchmark_interval_seconds) {
        updateBenchmarkInterval(result.benchmark_interval_seconds, "config sync", true);
      }
    } catch (error) {
      log.debug(`[Benchmark] Config sync error: ${error.message}`);
    }
  }

  benchmarkConfigPoll = setInterval(() => {
    void syncBenchmarkInterval();
  }, BENCHMARK_CONFIG_SYNC_MS);

  // Delay the first report by 45s so the first heartbeat cycle (~41s)
  // can complete and client.ws.ping has a real value instead of -1.
  scheduleNextBenchmark(45_000);
  log.info(
    `📡 Gateway benchmark reporting started (${currentBenchmarkIntervalMs / 1000}s interval via ${API_BASE})`
  );
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

  startGatewayLogStreaming();

  log.info("🚀 Starting Discord Gateway Bot...");
  log.info("🤖 Automation engine enabled");

  try {
    await connectDiscordClient(token);
  } catch (error) {
    log.error("❌ Failed to login:", error);
    process.exit(1);
  }
}

// Graceful shutdown for PM2 / process managers
function gracefulShutdown(signal) {
  log.info(`\n🛑 Received ${signal}, shutting down gracefully...`);
  clearGatewayLogFlushTimer();
  stopBenchmarkReporting();
  if (gatewayLogConfigPoll) clearInterval(gatewayLogConfigPoll);
  if (httpServer) httpServer.close();
  if (discordClient) {
    discordClient.destroy();
    log.info("✅ Discord client destroyed");
  }
  process.exit(0);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

/**
 * Lightweight HTTP server that proxies POST /deploy to the internal
 * deploy-webhook listener on port 9090, and forwards all other requests
 * to the Cloudflare Pages origin (SvelteKit app) so the tunnel can serve
 * both deploy webhooks and API routes via a single hostname.
 */
const DEPLOY_PROXY_PORT = parseInt(process.env.GATEWAY_HTTP_PORT || "4269", 10);
const DEPLOY_TARGET = `http://127.0.0.1:${process.env.DEPLOY_WEBHOOK_PORT || "9090"}`;
const PAGES_ORIGIN = process.env.PAGES_ORIGIN || process.env.CF_PAGES_URL || "";
let httpServer;

function startHttpProxy() {
  httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${DEPLOY_PROXY_PORT}`);

    const liveUpdatesMatch = url.pathname.match(/^\/api\/admin\/(\d{17,20})\/live-updates\/stream$/);
    if (req.method === "GET" && liveUpdatesMatch) {
      const guildId = liveUpdatesMatch[1];
      const userId = url.searchParams.get("user") || "";
      const expiresAt = url.searchParams.get("exp") || "";
      const signature = url.searchParams.get("sig") || "";
      const secret = getLiveUpdateSecret();

      const authorized = await verifyLiveUpdateAccess(guildId, userId, expiresAt, signature, secret);
      if (!authorized) {
        res.writeHead(401, { "Content-Type": "text/plain" });
        res.end("Unauthorized");
        return;
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write(": connected\n\n");

      registerLiveUpdateClient(guildId, res);

      const guild = discordClient?.guilds?.cache?.get(guildId);
      writeSseEvent(res, "voice_snapshot", {
        type: "voice_snapshot",
        guildId,
        reason: "initial_connect",
        data: guild ? buildGuildLiveVoiceSnapshot(guild) : buildLiveVoiceSnapshot([], new Date().toISOString()),
      });

      const heartbeat = setInterval(() => {
        try {
          res.write(": heartbeat\n\n");
        } catch {
          clearInterval(heartbeat);
          unregisterLiveUpdateClient(guildId, res);
        }
      }, 30000);

      req.on("close", () => {
        clearInterval(heartbeat);
        unregisterLiveUpdateClient(guildId, res);
      });
      return;
    }

    if (url.pathname === "/deploy" && req.method === "POST") {
      const proxyReq = http.request(
        DEPLOY_TARGET,
        { method: "POST", headers: req.headers },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res);
        }
      );
      proxyReq.on("error", () => {
        res.writeHead(503, { "Content-Type": "text/plain" });
        res.end("Deploy service unavailable");
      });
      req.pipe(proxyReq);
      return;
    }

    // Health check
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }

    // Forward all other requests to the Cloudflare Pages origin
    if (PAGES_ORIGIN) {
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks);

        const targetUrl = `${PAGES_ORIGIN}${req.url}`;
        const forwardHeaders = { ...req.headers };
        delete forwardHeaders.host; // let fetch set the correct Host

        const pagesRes = await fetch(targetUrl, {
          method: req.method,
          headers: forwardHeaders,
          body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
        });

        const responseHeaders = {};
        pagesRes.headers.forEach((value, key) => { responseHeaders[key] = value; });
        // Remove transfer-encoding since we'll send the full body
        delete responseHeaders["transfer-encoding"];

        const responseBody = Buffer.from(await pagesRes.arrayBuffer());
        responseHeaders["content-length"] = String(responseBody.length);

        res.writeHead(pagesRes.status, responseHeaders);
        res.end(responseBody);
      } catch (err) {
        log.debug(`[HTTP Proxy] Pages forward error: ${err.message}`);
        res.writeHead(502, { "Content-Type": "text/plain" });
        res.end("Pages origin unavailable");
      }
      return;
    }

    res.writeHead(404);
    res.end();
  });

  httpServer.listen(DEPLOY_PROXY_PORT, () => {
    log.info(`🔗 HTTP proxy listening on port ${DEPLOY_PROXY_PORT} (POST /deploy → ${DEPLOY_TARGET})`);
    if (PAGES_ORIGIN) {
      log.info(`🔗 Forwarding other routes to ${PAGES_ORIGIN}`);
    }
  });
}

// Start the bot if this file is run directly
startBot();
startHttpProxy();

export { createClient, setupEventHandlers };
