/**
 * Discord bot command definitions
 * Register these commands using the Discord API
 */

import { log } from "../log.js";
import {
	getGuildCommands,
	markCommandRegistered,
	toDiscordCommand,
} from "../db/commands.js";
import { getEnabledGuildIntegrations } from "../db/integrations.js";
import { getIntegrationCommands } from "../integrations/registry.js";

export const commands = [
	{
		name: "ping",
		description: "Check if the bot is responsive",
		type: 1, // CHAT_INPUT
	},
	{
		name: "info",
		description: "View bot information and statistics",
		type: 1, // CHAT_INPUT
	},
	{
		name: "help",
		description: "Get help with bot commands",
		type: 1, // CHAT_INPUT
	},
];

/**
 * Register commands with Discord
 * Run this script to deploy commands to Discord
 *
 * Usage:
 * DISCORD_CLIENT_ID=xxx DISCORD_BOT_TOKEN=xxx node register-commands.js
 *
 * For instant guild-specific registration (recommended for testing):
 * DISCORD_CLIENT_ID=xxx DISCORD_BOT_TOKEN=xxx DISCORD_GUILD_ID=xxx node register-commands.js
 */
export async function registerCommands(clientId, botToken, guildId = null) {
	// Guild commands update instantly, global commands can take up to an hour
	const url = guildId
		? `https://discord.com/api/v10/applications/${clientId}/guilds/${guildId}/commands`
		: `https://discord.com/api/v10/applications/${clientId}/commands`;

	try {
		const response = await fetch(url, {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
				"Authorization": `Bot ${botToken}`,
			},
			body: JSON.stringify(commands),
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`Failed to register commands: ${error}`);
		}

		const data = await response.json();
		log.info("Successfully registered commands:", data);
		return data;
	} catch (error) {
		log.error("Error registering commands:", error);
		throw error;
	}
}

/**
 * Sync all guild commands to Discord.
 * Performs a bulk PUT of built-in + enabled custom commands, then updates DB registration state.
 * Call this after any command CRUD operation so users never need to manually sync.
 *
 * @param {D1Database} db
 * @param {string} guildId
 * @param {Object} env - Platform env with DISCORD_BOT_TOKEN and DISCORD_CLIENT_ID
 * @returns {Promise<{success: boolean, registered?: number, error?: string}>}
 */
export async function syncGuildCommands(db, guildId, env) {
	const botToken = env?.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;
	const clientId = env?.DISCORD_CLIENT_ID || process.env.DISCORD_CLIENT_ID;

	if (!botToken || !clientId) {
		log.warn("syncGuildCommands: Bot configuration not available, skipping sync");
		return { success: false, error: "Bot configuration not available" };
	}

	if (!db) {
		log.warn("syncGuildCommands: Database not available, skipping sync");
		return { success: false, error: "Database not available" };
	}

	try {
		// Get all enabled custom commands
		const customCommands = await getGuildCommands(db, guildId, { enabledOnly: true });

		// Convert to Discord format, tracking DB IDs
		const discordCommands = [];
		for (const cmd of customCommands) {
			const result = toDiscordCommand(cmd);
			if (Array.isArray(result)) {
				for (const discordCmd of result) {
					discordCommands.push({ ...discordCmd, _dbId: cmd.id });
				}
			} else {
				discordCommands.push({ ...result, _dbId: cmd.id });
			}
		}

		// Gather commands from enabled integrations
		let integrationCommands = [];
		try {
			const enabledIntegrations = await getEnabledGuildIntegrations(db, guildId);
			for (const integration of enabledIntegrations) {
				const cmds = getIntegrationCommands(integration);
				integrationCommands.push(...cmds);
			}
			if (integrationCommands.length > 0) {
				log.info(`syncGuildCommands: Adding ${integrationCommands.length} integration command(s) for guild ${guildId}`);
			}
		} catch (err) {
			log.warn("syncGuildCommands: Failed to load integration commands:", err);
		}

		// Combine built-in, custom, and integration commands
		const allCommands = [
			...commands,
			...discordCommands.map(({ _dbId, ...cmd }) => cmd),
			...integrationCommands,
		];

		// Bulk-overwrite guild commands (PUT replaces the entire set)
		const url = `https://discord.com/api/v10/applications/${clientId}/guilds/${guildId}/commands`;

		const response = await fetch(url, {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bot ${botToken}`,
			},
			body: JSON.stringify(allCommands),
		});

		if (!response.ok) {
			const error = await response.text();
			log.error("syncGuildCommands: Discord registration error:", error);
			return { success: false, error: `Discord API error: ${error}` };
		}

		const registeredCommands = await response.json();

		// Update database with Discord command IDs
		for (const dbCommand of discordCommands) {
			const registered = registeredCommands.find((rc) => rc.name === dbCommand.name);
			if (registered) {
				await markCommandRegistered(db, dbCommand._dbId, registered.id);
			}
		}

		log.info(`syncGuildCommands: Synced ${registeredCommands.length} commands for guild ${guildId}`);
		return { success: true, registered: registeredCommands.length };
	} catch (error) {
		log.error("syncGuildCommands error:", error);
		return { success: false, error: error.message || String(error) };
	}
}
