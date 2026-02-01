/**
 * External Bot Registry
 * Defines known bots, their commands, and success/failure detection patterns
 * 
 * This allows automations to filter by specific bot responses and detect
 * whether a command was successful or failed.
 */

/**
 * @typedef {Object} BotCommand
 * @property {string} name - The command name (e.g., "bump")
 * @property {string} description - Description of what the command does
 * @property {Object} successPatterns - Patterns to detect successful execution
 * @property {string[]} [successPatterns.embedContains] - Text that appears in embed on success
 * @property {string[]} [successPatterns.contentContains] - Text that appears in content on success
 * @property {Object} failurePatterns - Patterns to detect failed execution
 * @property {string[]} [failurePatterns.embedContains] - Text that appears in embed on failure
 * @property {string[]} [failurePatterns.contentContains] - Text that appears in content on failure
 * @property {number} [cooldownMinutes] - Cooldown duration in minutes (if applicable)
 */

/**
 * @typedef {Object} ExternalBot
 * @property {string} id - The bot's Discord user ID
 * @property {string} name - Display name for the bot
 * @property {string} description - Brief description of the bot
 * @property {string} [icon] - Emoji icon for display
 * @property {string} [color] - Brand color (hex)
 * @property {string} [website] - Bot's website URL
 * @property {Object.<string, BotCommand>} commands - Map of command names to their configs
 */

/**
 * Registry of known external bots and their commands
 * @type {Object.<string, ExternalBot>}
 */
export const BOT_REGISTRY = {
  // Disboard - Server listing/bump bot
  "302050872383242240": {
    id: "302050872383242240",
    name: "DISBOARD",
    description: "Server listing and bump bot",
    icon: "📊",
    color: "#5865F2",
    website: "https://disboard.org",
    commands: {
      bump: {
        name: "bump",
        description: "Bump your server on DISBOARD",
        successPatterns: {
          // Various patterns for DISBOARD bump success messages
          embedContains: [
            "Bump done",
            "bump done",
            "BUMP DONE",
            ":thumbsup:",
            "👍",
            "successfully bumped",
            "Server bumped",
          ],
        },
        failurePatterns: {
          embedContains: [
            "Please wait",
            "please wait",
            "You can bump again",
            "wait another",
            "cooldown",
            "Wait another",
            "minutes remaining",
            "hours remaining",
          ],
        },
        cooldownMinutes: 120, // 2 hours
      },
    },
  },

  // Dyno - Moderation bot
  "155149108183695360": {
    id: "155149108183695360",
    name: "Dyno",
    description: "Moderation and utility bot",
    icon: "⚡",
    color: "#7289DA",
    website: "https://dyno.gg",
    commands: {
      ban: {
        name: "ban",
        description: "Ban a user from the server",
        successPatterns: {
          embedContains: ["has been banned", "banned", "🔨"],
        },
        failurePatterns: {
          embedContains: ["I couldn't ban", "Missing permissions", "failed"],
        },
      },
      kick: {
        name: "kick",
        description: "Kick a user from the server",
        successPatterns: {
          embedContains: ["has been kicked", "kicked"],
        },
        failurePatterns: {
          embedContains: ["I couldn't kick", "Missing permissions", "failed"],
        },
      },
      mute: {
        name: "mute",
        description: "Mute a user",
        successPatterns: {
          embedContains: ["has been muted", "muted"],
        },
        failurePatterns: {
          embedContains: ["I couldn't mute", "Missing permissions", "failed"],
        },
      },
      warn: {
        name: "warn",
        description: "Warn a user",
        successPatterns: {
          embedContains: ["has been warned", "warned", "Warning"],
        },
        failurePatterns: {
          embedContains: ["I couldn't warn", "failed"],
        },
      },
    },
  },

  // MEE6 - Leveling and moderation bot
  "159985870458322944": {
    id: "159985870458322944",
    name: "MEE6",
    description: "Leveling, moderation, and music bot",
    icon: "🎵",
    color: "#7289DA",
    website: "https://mee6.xyz",
    commands: {
      ban: {
        name: "ban",
        description: "Ban a user",
        successPatterns: {
          embedContains: ["banned"],
        },
        failurePatterns: {
          embedContains: ["Unable to ban", "Missing permissions"],
        },
      },
      kick: {
        name: "kick",
        description: "Kick a user",
        successPatterns: {
          embedContains: ["kicked"],
        },
        failurePatterns: {
          embedContains: ["Unable to kick", "Missing permissions"],
        },
      },
      mute: {
        name: "mute",
        description: "Mute a user",
        successPatterns: {
          embedContains: ["muted"],
        },
        failurePatterns: {
          embedContains: ["Unable to mute", "Missing permissions"],
        },
      },
      warn: {
        name: "warn",
        description: "Warn a user",
        successPatterns: {
          embedContains: ["warned"],
        },
        failurePatterns: {
          embedContains: ["Unable to warn"],
        },
      },
      rank: {
        name: "rank",
        description: "Check your level and rank",
        successPatterns: {
          embedContains: ["Level", "XP", "Rank"],
        },
        failurePatterns: {},
      },
    },
  },

  // Carl-bot - Utility and moderation bot
  "235148962103951360": {
    id: "235148962103951360",
    name: "Carl-bot",
    description: "Utility, moderation, and reaction roles bot",
    icon: "🤖",
    color: "#F47B67",
    website: "https://carl.gg",
    commands: {
      ban: {
        name: "ban",
        description: "Ban a user",
        successPatterns: {
          embedContains: ["banned", "🔨"],
        },
        failurePatterns: {
          embedContains: ["I was unable to", "Missing permissions"],
        },
      },
      kick: {
        name: "kick",
        description: "Kick a user",
        successPatterns: {
          embedContains: ["kicked", "👢"],
        },
        failurePatterns: {
          embedContains: ["I was unable to", "Missing permissions"],
        },
      },
      mute: {
        name: "mute",
        description: "Mute a user",
        successPatterns: {
          embedContains: ["muted", "🔇"],
        },
        failurePatterns: {
          embedContains: ["I was unable to", "Missing permissions"],
        },
      },
      warn: {
        name: "warn",
        description: "Warn a user",
        successPatterns: {
          embedContains: ["warned", "⚠"],
        },
        failurePatterns: {
          embedContains: ["I was unable to"],
        },
      },
      poll: {
        name: "poll",
        description: "Create a poll",
        successPatterns: {
          embedContains: ["📊", "Poll"],
        },
        failurePatterns: {},
      },
    },
  },

  // Tatsu - Social bot with economy and leveling
  "172002255350792192": {
    id: "172002255350792192",
    name: "Tatsu",
    description: "Social bot with leveling and economy",
    icon: "🌸",
    color: "#FF69B4",
    website: "https://tatsu.gg",
    commands: {
      daily: {
        name: "daily",
        description: "Claim daily credits",
        successPatterns: {
          embedContains: ["daily", "claimed", "credits"],
        },
        failurePatterns: {
          embedContains: ["already claimed", "wait"],
        },
        cooldownMinutes: 1440, // 24 hours
      },
      rank: {
        name: "rank",
        description: "Check your rank and level",
        successPatterns: {
          embedContains: ["Level", "XP", "Score"],
        },
        failurePatterns: {},
      },
      rep: {
        name: "rep",
        description: "Give reputation to another user",
        successPatterns: {
          embedContains: ["reputation", "rep"],
        },
        failurePatterns: {
          embedContains: ["already given", "wait"],
        },
        cooldownMinutes: 720, // 12 hours
      },
    },
  },

  // ProBot - Multi-purpose bot
  "282859044593598464": {
    id: "282859044593598464",
    name: "ProBot",
    description: "Multi-purpose Discord bot",
    icon: "🛡️",
    color: "#0099FF",
    website: "https://probot.io",
    commands: {
      ban: {
        name: "ban",
        description: "Ban a user",
        successPatterns: {
          embedContains: ["banned", "🔨"],
        },
        failurePatterns: {
          embedContains: ["couldn't", "permission"],
        },
      },
      kick: {
        name: "kick",
        description: "Kick a user",
        successPatterns: {
          embedContains: ["kicked"],
        },
        failurePatterns: {
          embedContains: ["couldn't", "permission"],
        },
      },
      credits: {
        name: "credits",
        description: "Check your credits",
        successPatterns: {
          embedContains: ["credits", "$"],
        },
        failurePatterns: {},
      },
    },
  },

  // Arcane - Leveling bot
  "437808476106784770": {
    id: "437808476106784770",
    name: "Arcane",
    description: "Leveling and leaderboard bot",
    icon: "✨",
    color: "#9B59B6",
    website: "https://arcane.bot",
    commands: {
      rank: {
        name: "rank",
        description: "Check your rank and level",
        successPatterns: {
          embedContains: ["Level", "XP"],
        },
        failurePatterns: {},
      },
      leaderboard: {
        name: "leaderboard",
        description: "View the server leaderboard",
        successPatterns: {
          embedContains: ["Leaderboard", "Top"],
        },
        failurePatterns: {},
      },
    },
  },

  // ServerStats - Statistics bot
  "458276816071950337": {
    id: "458276816071950337",
    name: "ServerStats",
    description: "Server statistics and counters",
    icon: "📈",
    color: "#00CED1",
    website: "https://serverstats.bot",
    commands: {
      stats: {
        name: "stats",
        description: "View server statistics",
        successPatterns: {
          embedContains: ["Members", "Statistics", "Stats"],
        },
        failurePatterns: {},
      },
    },
  },

  // Ticket Tool - Ticketing bot
  "557628352828014614": {
    id: "557628352828014614",
    name: "Ticket Tool",
    description: "Ticket management bot",
    icon: "🎫",
    color: "#00BFFF",
    website: "https://tickettool.xyz",
    commands: {
      new: {
        name: "new",
        description: "Create a new ticket",
        successPatterns: {
          embedContains: ["ticket created", "Ticket Created", "🎫"],
        },
        failurePatterns: {
          embedContains: ["already have a ticket", "limit", "cooldown"],
        },
      },
      close: {
        name: "close",
        description: "Close a ticket",
        successPatterns: {
          embedContains: ["ticket closed", "Ticket Closed", "closed"],
        },
        failurePatterns: {
          embedContains: ["not a ticket", "permission"],
        },
      },
    },
  },
};

/**
 * Get a bot from the registry by ID
 * @param {string} botId - The bot's Discord user ID
 * @returns {ExternalBot|null}
 */
export function getBot(botId) {
  return BOT_REGISTRY[botId] || null;
}

/**
 * Get all registered bots as an array
 * @returns {ExternalBot[]}
 */
export function getAllBots() {
  return Object.values(BOT_REGISTRY);
}

/**
 * Get commands for a specific bot
 * @param {string} botId - The bot's Discord user ID
 * @returns {Object.<string, BotCommand>|null}
 */
export function getBotCommands(botId) {
  const bot = getBot(botId);
  return bot?.commands || null;
}

/**
 * Check if a message indicates command success for a specific bot command
 * @param {string} botId - The bot's Discord user ID
 * @param {string} commandName - The command name
 * @param {Object} messageDetails - Message details (content, embedTexts, etc.)
 * @returns {'success'|'failure'|'unknown'}
 */
export function detectCommandResult(botId, commandName, messageDetails) {
  const bot = getBot(botId);
  if (!bot) return "unknown";

  const command = bot.commands[commandName?.toLowerCase()];
  if (!command) return "unknown";

  const content = (messageDetails.content || "").toLowerCase();
  const embedTexts = (messageDetails.embedTexts || []).map((t) =>
    t.toLowerCase()
  );
  const allText = [content, ...embedTexts].join(" ");

  // Check for success patterns first
  if (command.successPatterns) {
    const successEmbedPatterns = command.successPatterns.embedContains || [];
    const successContentPatterns =
      command.successPatterns.contentContains || [];

    for (const pattern of successEmbedPatterns) {
      if (allText.includes(pattern.toLowerCase())) {
        return "success";
      }
    }
    for (const pattern of successContentPatterns) {
      if (content.includes(pattern.toLowerCase())) {
        return "success";
      }
    }
  }

  // Check for failure patterns
  if (command.failurePatterns) {
    const failureEmbedPatterns = command.failurePatterns.embedContains || [];
    const failureContentPatterns =
      command.failurePatterns.contentContains || [];

    for (const pattern of failureEmbedPatterns) {
      if (allText.includes(pattern.toLowerCase())) {
        return "failure";
      }
    }
    for (const pattern of failureContentPatterns) {
      if (content.includes(pattern.toLowerCase())) {
        return "failure";
      }
    }
  }

  return "unknown";
}

/**
 * Get the cooldown for a bot command in minutes
 * @param {string} botId - The bot's Discord user ID
 * @param {string} commandName - The command name
 * @returns {number|null} - Cooldown in minutes or null if not applicable
 */
export function getCommandCooldown(botId, commandName) {
  const bot = getBot(botId);
  if (!bot) return null;

  const command = bot.commands[commandName?.toLowerCase()];
  return command?.cooldownMinutes || null;
}

/**
 * Check if a bot ID is in the registry
 * @param {string} botId - The bot's Discord user ID
 * @returns {boolean}
 */
export function isBotRegistered(botId) {
  return botId in BOT_REGISTRY;
}

/**
 * Format bot info for display
 * @param {string} botId - The bot's Discord user ID
 * @returns {{name: string, icon: string, color: string}|null}
 */
export function formatBotInfo(botId) {
  const bot = getBot(botId);
  if (!bot) return null;

  return {
    name: bot.name,
    icon: bot.icon || "🤖",
    color: bot.color || "#7289DA",
  };
}
