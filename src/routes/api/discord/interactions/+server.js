import { json } from "@sveltejs/kit";
import {
	InteractionResponseType,
	InteractionType,
	verifyKey,
} from "discord-interactions";
import { commands } from "$lib/discord/commands.js";
import {
	buildCommandContext,
	getCommandByName,
	logCommandExecution,
	recordCommandUse,
} from "$lib/db/commands.js";
import { executeAction, processTemplate } from "$lib/automation/engine.js";

// Track bot start time for uptime calculation
const BOT_START_TIME = Date.now();
const BOT_VERSION = "1.0.0";

/**
 * Convert hex string to Uint8Array
 */
function hexToUint8Array(hex) {
	const matches = hex.match(/.{1,2}/g);
	if (!matches) return new Uint8Array();
	return new Uint8Array(matches.map((byte) => parseInt(byte, 16)));
}

/**
 * Verify Discord request signature using Web Crypto API (for Cloudflare Workers)
 */
async function verifyWithWebCrypto(body, signature, timestamp, publicKey) {
	try {
		const encoder = new TextEncoder();
		const key = await crypto.subtle.importKey(
			"raw",
			hexToUint8Array(publicKey),
			{ name: "Ed25519", namedCurve: "Ed25519" },
			false,
			["verify"],
		);

		return await crypto.subtle.verify(
			"Ed25519",
			key,
			hexToUint8Array(signature),
			encoder.encode(timestamp + body),
		);
	} catch (error) {
		// Ed25519 not supported, fall back to discord-interactions library
		return null;
	}
}

/**
 * Verify Discord request signature
 */
async function verifyDiscordRequest(request, publicKey) {
	const signature = request.headers.get("x-signature-ed25519");
	const timestamp = request.headers.get("x-signature-timestamp");
	const body = await request.text();

	if (!signature || !timestamp) {
		return { isValid: false, body: null };
	}

	// Try Web Crypto first (for Cloudflare Workers)
	const webCryptoResult = await verifyWithWebCrypto(
		body,
		signature,
		timestamp,
		publicKey,
	);

	if (webCryptoResult !== null) {
		return { isValid: webCryptoResult, body };
	}

	// Fall back to discord-interactions library (for Node.js environments)
	try {
		const isValid = verifyKey(body, signature, timestamp, publicKey);
		return { isValid, body };
	} catch (error) {
		console.error("Signature verification error:", error);
		return { isValid: false, body: null };
	}
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ request, platform }) {
	console.log("=== Discord Interaction Request Received ===");

	// Get the public key from environment
	const PUBLIC_KEY = platform?.env?.DISCORD_PUBLIC_KEY ||
		process.env.DISCORD_PUBLIC_KEY;

	if (!PUBLIC_KEY) {
		console.error("DISCORD_PUBLIC_KEY not configured");
		return json({ error: "Server configuration error" }, { status: 500 });
	}

	console.log("Public key loaded, length:", PUBLIC_KEY.length);

	// Verify the request is from Discord
	const { isValid, body: rawBody } = await verifyDiscordRequest(
		request,
		PUBLIC_KEY,
	);

	console.log("Verification result:", isValid);

	if (!isValid) {
		console.error("Invalid request signature");
		return json({ error: "Invalid request signature" }, { status: 401 });
	}

	let body;
	try {
		body = JSON.parse(rawBody);
		console.log("Parsed body type:", body.type);
	} catch (error) {
		console.error("Failed to parse request body:", error);
		return json({ error: "Invalid JSON" }, { status: 400 });
	}

	// Get database for custom commands
	const db = platform?.env?.DB;

	// Handle Discord interaction types
	// Type 1: PING - Discord sends this to verify the endpoint
	if (body.type === InteractionType.PING) {
		return json({ type: InteractionResponseType.PONG });
	}

	// Type 2: APPLICATION_COMMAND - Slash commands
	if (body.type === InteractionType.APPLICATION_COMMAND) {
		const { data } = body;
		const guildId = body.guild_id;

		// First, check for custom commands from database
		if (db && guildId) {
			const customCommand = await getCommandByName(db, data.name, guildId);

			if (customCommand) {
				return await handleCustomCommand(customCommand, body, db, platform);
			}
		}

		// Fall back to built-in commands
		switch (data.name) {
			case "ping":
				return json({
					type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
					data: {
						content: "Pong! 🏓",
					},
				});

			case "info": {
				const uptime = Date.now() - BOT_START_TIME;
				const days = Math.floor(uptime / (1000 * 60 * 60 * 24));
				const hours = Math.floor(
					(uptime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
				);
				const minutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
				const seconds = Math.floor((uptime % (1000 * 60)) / 1000);

				let uptimeStr = "";
				if (days > 0) uptimeStr += `${days}d `;
				if (hours > 0) uptimeStr += `${hours}h `;
				if (minutes > 0) uptimeStr += `${minutes}m `;
				uptimeStr += `${seconds}s`;

				return json({
					type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
					data: {
						embeds: [{
							title: "📊 SpaceBot Info",
							color: 0x5865F2, // Discord Blurple
							fields: [
								{
									name: "⏱️ Uptime",
									value: uptimeStr,
									inline: true,
								},
								{
									name: "🤖 Version",
									value: `v${BOT_VERSION}`,
									inline: true,
								},
								{
									name: "⚡ Platform",
									value: "Cloudflare Workers",
									inline: true,
								},
								{
									name: "📝 Commands",
									value: `${commands.length} available`,
									inline: true,
								},
								{
									name: "🔧 Framework",
									value: "SvelteKit",
									inline: true,
								},
								{
									name: "🌐 API Version",
									value: "Discord API v10",
									inline: true,
								},
							],
							footer: {
								text: "SpaceBot • Powered by Starspace",
							},
							timestamp: new Date().toISOString(),
						}],
					},
				});
			}

			case "help": {
				const commandList = commands.map((cmd) =>
					`**/${cmd.name}** - ${cmd.description}`
				).join("\n");

				return json({
					type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
					data: {
						embeds: [{
							title: "🚀 SpaceBot Help",
							description:
								"Welcome to SpaceBot! Here are all the available commands:",
							color: 0x57F287, // Discord Green
							fields: [
								{
									name: "📋 Commands",
									value: commandList,
									inline: false,
								},
								{
									name: "🔗 Links",
									value: "[GitHub](https://github.com/starspacegroup/spacebot)",
									inline: false,
								},
							],
							footer: {
								text: "Use /command to run a command",
							},
							thumbnail: {
								url: "https://cdn.discordapp.com/embed/avatars/0.png",
							},
						}],
					},
				});
			}

			default:
				return json({
					type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
					data: {
						content: "Unknown command",
					},
				});
		}
	}

	// Type 3: MESSAGE_COMPONENT - Button clicks, select menus
	if (body.type === InteractionType.MESSAGE_COMPONENT) {
		return json({
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: {
				content: "Button interaction received!",
			},
		});
	}

	return json({ error: "Unknown interaction type" }, { status: 400 });
}

/**
 * Handle a custom command from the database
 * @param {Object} command - Command from database
 * @param {Object} interaction - Discord interaction
 * @param {D1Database} db - Database connection
 * @param {Object} platform - Platform context
 */
async function handleCustomCommand(command, interaction, db, platform) {
	const startTime = Date.now();
	const context = buildCommandContext(interaction);

	console.log(`[Command] Executing custom command: ${command.name}`);

	// Record usage
	await recordCommandUse(db, command.id);

	// Build response based on configuration
	let responseData = {};

	if (command.response_type === "message" && command.response_content) {
		responseData.content = processTemplate(command.response_content, context);
	} else if (command.response_type === "embed" && command.response_embed) {
		const embed = { ...command.response_embed };
		if (embed.description) {
			embed.description = processTemplate(embed.description, context);
		}
		if (embed.title) {
			embed.title = processTemplate(embed.title, context);
		}
		responseData.embeds = [embed];
	} else if (command.response_type === "action_only") {
		// No visible response, but we still need to acknowledge
		responseData.content = "✅ Command executed";
	} else {
		// Default fallback
		responseData.content = `Command /${command.name} executed`;
	}

	// Set ephemeral flag if configured
	if (command.ephemeral) {
		responseData.flags = 64; // EPHEMERAL flag
	}

	// For now, execute actions synchronously (defer support to be added)
	// In the future, if command.defer is true, we should defer and execute async
	let actionResult = { success: true };

	if (command.action_type && command.action_type !== "NONE") {
		// Create a minimal event object for the action executor
		const event = {
			guild_id: interaction.guild_id,
			channel_id: interaction.channel_id,
			actor_id: context.user.id,
			actor_name: context.user.name,
		};

		// Add option values to event for action processing
		if (interaction.data?.options) {
			for (const opt of interaction.data.options) {
				// Map user/channel/role options to their respective IDs
				if (opt.type === 6) { // USER
					event.target_id = opt.value;
				}
			}
		}

		// For actions that need Discord client, we'll use REST API
		// This is a simplified version - full discord.js client would be needed for complex actions
		const discord = createRESTClient(platform);

		if (discord) {
			actionResult = await executeAction(
				{ ...command, name: command.name },
				event,
				context,
				discord,
			);
		}
	}

	// Log execution
	await logCommandExecution(db, {
		command_id: command.id,
		guild_id: interaction.guild_id,
		user_id: context.user.id,
		user_name: context.user.name,
		channel_id: interaction.channel_id,
		options_used: interaction.data?.options || null,
		action_result: actionResult.result || null,
		success: actionResult.success,
		error_message: actionResult.error || null,
		execution_time_ms: Date.now() - startTime,
	});

	// If action failed, modify response
	if (!actionResult.success && command.action_type !== "NONE") {
		responseData.content = `❌ Command failed: ${
			actionResult.error || "Unknown error"
		}`;
		if (command.ephemeral) {
			responseData.flags = 64;
		}
	}

	return json({
		type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
		data: responseData,
	});
}

/**
 * Create a minimal REST client for action execution
 * Note: This is a simplified client for basic actions
 * Complex actions may need the full discord.js gateway client
 */
function createRESTClient(platform) {
	const token = platform?.env?.DISCORD_BOT_TOKEN ||
		process.env.DISCORD_BOT_TOKEN;

	if (!token) {
		console.warn("No bot token available for REST client");
		return null;
	}

	const headers = {
		"Authorization": `Bot ${token}`,
		"Content-Type": "application/json",
	};

	// Create a minimal mock of discord.js client structure
	return {
		channels: {
			async fetch(channelId) {
				const response = await fetch(
					`https://discord.com/api/v10/channels/${channelId}`,
					{ headers },
				);
				if (!response.ok) return null;
				const channel = await response.json();

				return {
					id: channel.id,
					name: channel.name,
					async send(content) {
						const body = typeof content === "string" ? { content } : content;

						const res = await fetch(
							`https://discord.com/api/v10/channels/${channelId}/messages`,
							{
								method: "POST",
								headers,
								body: JSON.stringify(body),
							},
						);
						return res.json();
					},
				};
			},
		},
		guilds: {
			async fetch(guildId) {
				const response = await fetch(
					`https://discord.com/api/v10/guilds/${guildId}`,
					{ headers },
				);
				if (!response.ok) return null;
				const guild = await response.json();

				return {
					id: guild.id,
					name: guild.name,
					members: {
						async fetch(userId) {
							const res = await fetch(
								`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`,
								{ headers },
							);
							if (!res.ok) return null;
							const member = await res.json();

							return {
								id: member.user.id,
								user: member.user,
								roles: {
									async add(roleId) {
										await fetch(
											`https://discord.com/api/v10/guilds/${guildId}/members/${userId}/roles/${roleId}`,
											{ method: "PUT", headers },
										);
									},
									async remove(roleId) {
										await fetch(
											`https://discord.com/api/v10/guilds/${guildId}/members/${userId}/roles/${roleId}`,
											{ method: "DELETE", headers },
										);
									},
								},
								async kick(reason) {
									await fetch(
										`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`,
										{
											method: "DELETE",
											headers: {
												...headers,
												"X-Audit-Log-Reason": reason || "",
											},
										},
									);
								},
								async timeout(duration, reason) {
									const until = new Date(Date.now() + duration).toISOString();
									await fetch(
										`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`,
										{
											method: "PATCH",
											headers: {
												...headers,
												"X-Audit-Log-Reason": reason || "",
											},
											body: JSON.stringify({
												communication_disabled_until: until,
											}),
										},
									);
								},
							};
						},
						async ban(userId, options = {}) {
							await fetch(
								`https://discord.com/api/v10/guilds/${guildId}/bans/${userId}`,
								{
									method: "PUT",
									headers: {
										...headers,
										"X-Audit-Log-Reason": options.reason || "",
									},
									body: JSON.stringify({
										delete_message_seconds: options.deleteMessageSeconds || 0,
									}),
								},
							);
						},
					},
				};
			},
		},
	};
}
