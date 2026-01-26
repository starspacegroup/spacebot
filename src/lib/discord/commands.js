/**
 * Discord bot command definitions
 * Register these commands using the Discord API
 */

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
		console.log("Successfully registered commands:", data);
		return data;
	} catch (error) {
		console.error("Error registering commands:", error);
		throw error;
	}
}
