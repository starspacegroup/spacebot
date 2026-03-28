import { json } from "@sveltejs/kit";
import {
	InteractionResponseType,
	InteractionType,
	verifyKey,
} from "discord-interactions";
import {
	buildCommandContext,
	getCommandByName,
	logCommandExecution,
	recordCommandUse,
} from "$lib/db/commands.js";
import { executeAction, processTemplate } from "$lib/automation/engine.js";
import { log } from "$lib/db/logger.js";
import { getEnabledGuildIntegrations } from "$lib/db/integrations.js";
import { getIntegrationCommands } from "$lib/integrations/registry.js";
import { getLatestServerStats } from "$lib/db/server-stats.js";
import { getGuildMetadata } from "$lib/db/guild-metadata.js";
import { signWidgetUrl, WIDGET_TYPES } from "$lib/stats-widget.js";

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
		log.error("Signature verification error:", error);
		return { isValid: false, body: null };
	}
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ request, platform }) {
	log.debug("=== Discord Interaction Request Received ===");

	// Get the public key from environment
	const PUBLIC_KEY = platform?.env?.DISCORD_PUBLIC_KEY ||
		process.env.DISCORD_PUBLIC_KEY;

	if (!PUBLIC_KEY) {
		log.error("DISCORD_PUBLIC_KEY not configured");
		return json({ error: "Server configuration error" }, { status: 500 });
	}

	log.debug("Public key loaded, length:", PUBLIC_KEY.length);

	// Verify the request is from Discord
	const { isValid, body: rawBody } = await verifyDiscordRequest(
		request,
		PUBLIC_KEY,
	);

	log.debug("Verification result:", isValid);

	if (!isValid) {
		log.error("Invalid request signature");
		return json({ error: "Invalid request signature" }, { status: 401 });
	}

	let body;
	try {
		body = JSON.parse(rawBody);
		log.debug("Parsed body type:", body.type);
	} catch (error) {
		log.error("Failed to parse request body:", error);
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

		// Handle /stats built-in command (generates widget image)
		if (data.name === "stats" && guildId) {
			const applicationId = body.application_id;
			const interactionToken = body.token;

			const asyncWork = handleStatsCommand(body, platform, applicationId, interactionToken);

			if (platform?.context?.waitUntil) {
				platform.context.waitUntil(asyncWork);
			} else {
				asyncWork.catch(err => log.error("[Stats] Command error:", err));
			}

			return json({
				type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
				data: {},
			});
		}

		// Look up command in database (includes both custom and built-in commands)
		if (db && guildId) {
			const customCommand = await getCommandByName(db, data.name, guildId);

			if (customCommand) {
				// Check if command has actions that need deferring
				const hasActions = (customCommand.actions && customCommand.actions.length > 0) ||
					(customCommand.action_type && customCommand.action_type !== "NONE" &&
						customCommand.action_type !== "MULTIPLE");

				if (hasActions) {
					// Defer the response so Discord doesn't time out
					const applicationId = body.application_id;
					const interactionToken = body.token;

					// Fire off the async work
					const asyncWork = handleDeferredCommand(
						customCommand, body, db, platform, applicationId, interactionToken
					);

					// Use platform.context.waitUntil if available (Cloudflare Workers)
					if (platform?.context?.waitUntil) {
						platform.context.waitUntil(asyncWork);
					} else {
						// Fire and forget for non-Cloudflare environments
						asyncWork.catch(err => log.error("[Command] Deferred command error:", err));
					}

					// Return deferred response immediately (type 5)
					const deferData = {};
					if (customCommand.ephemeral) {
						deferData.flags = 64; // EPHEMERAL
					}
					return json({
						type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
						data: deferData,
					});
				}

				return await handleCustomCommand(customCommand, body, db, platform);
			}
		}

		// Check if this is an integration command
		if (db && guildId) {
			const integrationResponse = await handleIntegrationCommand(data, body, db, guildId);
			if (integrationResponse) return integrationResponse;
		}

		// No command found in database
		return json({
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: {
				content: "Unknown command",
			},
		});
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
 * Handle a command that belongs to an enabled integration.
 * Returns a JSON response if matched, or null to fall through.
 *
 * If the integration has a `webhooks.command_handler` URL, the interaction
 * payload is forwarded there and the response is relayed back to Discord.
 * This allows external projects to handle their own commands.
 */
async function handleIntegrationCommand(data, interaction, db, guildId) {
	try {
		const enabledIntegrations = await getEnabledGuildIntegrations(db, guildId);

		for (const integration of enabledIntegrations) {
			const commands = getIntegrationCommands(integration);
			const matched = commands.find((cmd) => cmd.name === data.name);
			if (!matched) continue;

			const manifest = integration.manifest || integration.manifest_json;

			// If the integration is offline or has never connected, return immediately
			if (integration.status !== 'online') {
				return json({
					type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
					data: {
						content: `⚠️ The **${integration.name || integration.slug}** integration is currently offline. Please try again later.`,
						flags: 64,
					},
				});
			}

			// If the integration has a command handler webhook, proxy the command
			if (manifest?.webhooks?.command_handler) {
				try {
					const handlerUrl = manifest.webhooks.command_handler;
					const payload = {
						type: "command",
						command: data.name,
						options: data.options || [],
						guild_id: guildId,
						user: interaction.member?.user || interaction.user || null,
						channel_id: interaction.channel_id || null,
						integration_slug: integration.slug,
					};

					log.debug(
						`[Interactions] Proxying /${data.name} to ${handlerUrl}`,
					);

					const webhookResponse = await fetch(handlerUrl, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							"X-SpaceBot-Integration": integration.slug,
							"X-SpaceBot-Guild": guildId,
						},
						body: JSON.stringify(payload),
						signal: AbortSignal.timeout(8_000), // 8s timeout (Discord allows ~15s)
					});

					if (webhookResponse.ok) {
						const responseData = await webhookResponse.json();

						// The external handler can return a Discord interaction response directly
						if (responseData.type) {
							return json(responseData);
						}

						// Or return a simplified response that we wrap
						return json({
							type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
							data: {
								content: responseData.content || "Command executed.",
								embeds: responseData.embeds || undefined,
								components: responseData.components || undefined,
								flags: responseData.ephemeral ? 64 : undefined,
							},
						});
					}

					log.warn(
						`[Interactions] Integration webhook returned ${webhookResponse.status} for /${data.name}`,
					);

					return json({
						type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
						data: {
							content: `⚠️ The **${integration.name || integration.slug}** integration failed to handle \`/${data.name}\`. It may be temporarily unavailable.`,
							flags: 64, // ephemeral
						},
					});
				} catch (err) {
					log.error(
						`[Interactions] Error proxying to integration ${integration.slug}:`,
						err,
					);

					return json({
						type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
						data: {
							content: `⚠️ The **${integration.name || integration.slug}** integration is not responding. Please try again later.`,
							flags: 64,
						},
					});
				}
			}

			// No webhook configured — check for built-in handling
			const subcommand = data.options?.find((o) => o.type === 1)?.name;

			// --- StarSpace Game fallback handling (no webhook) ---
			if (integration.slug === "starspace-game") {
				if (subcommand === "play") {
					const homepage =
						manifest?.homepage || "https://game.starspace.group/";
					return json({
						type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
						data: {
							content: `🎮 **Play *Space Game**\n${homepage}`,
						},
					});
				}

				return json({
					type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
					data: {
						content: `The \`/game ${subcommand || ""}\` command requires the Game server to be online. It doesn't appear to be connected right now.`,
					},
				});
			}

			// Generic fallback — no webhook configured
			return json({
				type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
				data: {
					content: `Integration command \`/${data.name}\` is not fully configured yet. The integration may need to connect to SpaceBot.`,
				},
			});
		}
	} catch (err) {
		log.error("[Interactions] Integration command lookup error:", err);
	}

	return null;
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
	const userId = interaction.member?.user?.id || interaction.user?.id;
	const guildId = interaction.guild_id;

	log.debug(`[Command] Executing custom command: ${command.name}`);

	// If command requires voice channel, check the user's voice state
	let voiceState = null;
	if (command.require_voice) {
		const token = platform?.env?.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;
		if (token && guildId && userId) {
			try {
				const vsRes = await fetch(
					`https://discord.com/api/v10/guilds/${guildId}/voice-states/${userId}`,
					{ headers: { "Authorization": `Bot ${token}` } },
				);
				if (vsRes.ok) {
					const vsData = await vsRes.json();
					if (vsData.channel_id) {
						// Fetch channel name for template variables
						let channelName = "";
						try {
							const chRes = await fetch(
								`https://discord.com/api/v10/channels/${vsData.channel_id}`,
								{ headers: { "Authorization": `Bot ${token}` } },
							);
							if (chRes.ok) {
								const chData = await chRes.json();
								channelName = chData.name || "";
							}
						} catch {
							// Channel name is nice-to-have, not critical
						}
						voiceState = {
							channel_id: vsData.channel_id,
							channel_name: channelName,
						};
					}
				}
			} catch (err) {
				log.error("[Command] Failed to fetch voice state:", err);
			}
		}

		if (!voiceState) {
			return json({
				type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
				data: {
					content: "🔇 You must be in a voice channel to use this command.",
					flags: 64, // EPHEMERAL
				},
			});
		}
	}

	const [guildMeta, guildStats] = await Promise.all([
		getGuildMetadata(db, guildId).catch(() => null),
		getLatestServerStats(db, guildId).catch(() => null),
	]);
	const guildInfo = {
		name: guildMeta?.name || "Unknown Server",
		member_count: guildStats?.member_count ?? guildMeta?.approximate_member_count ?? null,
		human_count: guildStats?.human_count ?? null,
		bot_count: guildStats?.bot_count ?? null,
		boost_count: guildStats?.boost_count ?? guildMeta?.premium_subscription_count ?? null,
		boost_level: guildStats?.boost_level ?? guildMeta?.premium_tier ?? null,
	};

	const context = buildCommandContext(interaction, guildInfo, voiceState);
	context.widget_signing_secret = platform?.env?.DISCORD_PUBLIC_KEY || process.env.DISCORD_PUBLIC_KEY;
	context.widget_origin = platform?.env?.APP_URL || process.env.APP_URL || process.env.API_BASE || "http://localhost:4269";

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

	// Check if command has actions to execute (either stacked or legacy)
	const hasActions = (command.actions && command.actions.length > 0) ||
		(command.action_type && command.action_type !== "NONE" &&
			command.action_type !== "MULTIPLE");

	if (hasActions) {
		// Create a minimal event object for the action executor
		const event = {
			guild_id: interaction.guild_id,
			channel_id: interaction.channel_id,
			actor_id: context.user.id,
			actor_name: context.user.name,
			options: {}, // Store all option values by name
			application_id: interaction.application_id,
			interaction_token: interaction.token,
			_bot_token: platform?.env?.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN,
		};

		// Add voice channel info to event if available
		if (voiceState) {
			event.voice_channel_id = voiceState.channel_id;
			event.voice_channel_name = voiceState.channel_name;
		}

		// For user context menu commands, the target user is in data.target_id
		// data.type === 2 means USER context menu command
		if (interaction.data?.type === 2 && interaction.data?.target_id) {
			event.target_id = interaction.data.target_id;
			event.options.user = interaction.data.target_id;
		}

		// Add option values to event for action processing
		if (interaction.data?.options) {
			for (const opt of interaction.data.options) {
				// Store all options by name for target_user resolution
				event.options[opt.name] = opt.value;

				// Legacy: Map first user option to target_id for backwards compatibility
				if (opt.type === 6 && !event.target_id) { // USER
					event.target_id = opt.value;
				}
			}
		}

		// For actions that need Discord client, we'll use REST API
		// This is a simplified version - full discord.js client would be needed for complex actions
		const discord = createRESTClient(platform);

		if (discord) {
			// Get actions array - either from stacked format or construct from legacy
			const actionsToExecute = command.actions && command.actions.length > 0
				? command.actions
				: [{ type: command.action_type, config: command.action_config || {} }];

			// Execute each action in sequence
			const results = [];
			for (const action of actionsToExecute) {
				const result = await executeAction(
					{
						name: command.name,
						action_type: action.type,
						action_config: action.config || {},
					},
					event,
					context,
					discord,
					db,
				);
				results.push(result);
				// Stop on first failure
				if (!result.success) {
					actionResult = result;
					break;
				}
			}

			// If all succeeded, combine results
			if (actionResult.success) {
				actionResult = {
					success: true,
					result: results.map((r) => r.result),
				};
			}
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
 * Handle a deferred custom command - executes actions asynchronously
 * and follows up via Discord webhook
 */
async function handleDeferredCommand(command, interaction, db, platform, applicationId, interactionToken) {
	const startTime = Date.now();
	const userId = interaction.member?.user?.id || interaction.user?.id;
	const guildId = interaction.guild_id;

	log.debug(`[Command] Executing deferred command: ${command.name}`);

	const botToken = platform?.env?.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;

	// Helper to edit the deferred response
	async function editOriginalResponse(data) {
		try {
			const res = await fetch(
				`https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}/messages/@original`,
				{
					method: "PATCH",
					headers: {
						"Authorization": `Bot ${botToken}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify(data),
				},
			);
			if (!res.ok) {
				const errText = await res.text();
				log.error("[Command] Failed to edit deferred response:", errText);
			}
		} catch (err) {
			log.error("[Command] Error editing deferred response:", err);
		}
	}

	try {
		// Check voice state if required
		let voiceState = null;
		if (command.require_voice) {
			if (botToken && guildId && userId) {
				try {
					const vsRes = await fetch(
						`https://discord.com/api/v10/guilds/${guildId}/voice-states/${userId}`,
						{ headers: { "Authorization": `Bot ${botToken}` } },
					);
					if (vsRes.ok) {
						const vsData = await vsRes.json();
						if (vsData.channel_id) {
							let channelName = "";
							try {
								const chRes = await fetch(
									`https://discord.com/api/v10/channels/${vsData.channel_id}`,
									{ headers: { "Authorization": `Bot ${botToken}` } },
								);
								if (chRes.ok) {
									const chData = await chRes.json();
									channelName = chData.name || "";
								}
							} catch { /* not critical */ }
							voiceState = {
								channel_id: vsData.channel_id,
								channel_name: channelName,
							};
						}
					}
				} catch (err) {
					log.error("[Command] Failed to fetch voice state:", err);
				}
			}

			if (!voiceState) {
				await editOriginalResponse({
					content: "🔇 You must be in a voice channel to use this command.",
				});
				return;
			}
		}

		const [guildMeta, guildStats] = await Promise.all([
			getGuildMetadata(db, guildId).catch(() => null),
			getLatestServerStats(db, guildId).catch(() => null),
		]);
		const guildInfo = {
			name: guildMeta?.name || "Unknown Server",
			member_count: guildStats?.member_count ?? guildMeta?.approximate_member_count ?? null,
			human_count: guildStats?.human_count ?? null,
			bot_count: guildStats?.bot_count ?? null,
			boost_count: guildStats?.boost_count ?? guildMeta?.premium_subscription_count ?? null,
			boost_level: guildStats?.boost_level ?? guildMeta?.premium_tier ?? null,
		};

		const context = buildCommandContext(interaction, guildInfo, voiceState);
		context.widget_signing_secret = platform?.env?.DISCORD_PUBLIC_KEY || process.env.DISCORD_PUBLIC_KEY;
		context.widget_origin = platform?.env?.APP_URL || process.env.APP_URL || process.env.API_BASE || "http://localhost:4269";

		// Record usage
		await recordCommandUse(db, command.id);

		// Build response
		let responseData = {};
		if (command.response_type === "message" && command.response_content) {
			responseData.content = processTemplate(command.response_content, context);
		} else if (command.response_type === "embed" && command.response_embed) {
			const embed = { ...command.response_embed };
			if (embed.description) embed.description = processTemplate(embed.description, context);
			if (embed.title) embed.title = processTemplate(embed.title, context);
			responseData.embeds = [embed];
		} else if (command.response_type === "action_only") {
			responseData.content = "✅ Command executed";
		} else {
			responseData.content = `Command /${command.name} executed`;
		}

		// Execute actions
		let actionResult = { success: true };

		const event = {
			guild_id: interaction.guild_id,
			channel_id: interaction.channel_id,
			actor_id: context.user.id,
			actor_name: context.user.name,
			options: {},
			application_id: applicationId,
			interaction_token: interactionToken,
			_bot_token: botToken,
		};

		if (voiceState) {
			event.voice_channel_id = voiceState.channel_id;
			event.voice_channel_name = voiceState.channel_name;
		}

		if (interaction.data?.type === 2 && interaction.data?.target_id) {
			event.target_id = interaction.data.target_id;
			event.options.user = interaction.data.target_id;
		}

		if (interaction.data?.options) {
			for (const opt of interaction.data.options) {
				event.options[opt.name] = opt.value;
				if (opt.type === 6 && !event.target_id) {
					event.target_id = opt.value;
				}
			}
		}

		const discord = createRESTClient(platform);

		if (discord) {
			const actionsToExecute = command.actions && command.actions.length > 0
				? command.actions
				: [{ type: command.action_type, config: command.action_config || {} }];

			const results = [];
			for (const action of actionsToExecute) {
				const result = await executeAction(
					{
						name: command.name,
						action_type: action.type,
						action_config: action.config || {},
					},
					event,
					context,
					discord,
					db,
				);
				results.push(result);
				if (!result.success) {
					actionResult = result;
					break;
				}
			}

			if (actionResult.success) {
				actionResult = {
					success: true,
					result: results.map((r) => r.result),
				};
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

		// Update the deferred response with the result
		if (!actionResult.success && command.action_type !== "NONE") {
			responseData.content = `❌ Command failed: ${actionResult.error || "Unknown error"}`;
		}

		await editOriginalResponse(responseData);

	} catch (err) {
		log.error("[Command] Deferred command failed:", err);
		await editOriginalResponse({
			content: `❌ Command failed: ${err.message || "Unknown error"}`,
		});
	}
}

/**
 * Handle the /stats built-in command.
 * Generates a signed widget image URL and responds with an embed containing the chart.
 */
async function handleStatsCommand(interaction, platform, applicationId, interactionToken) {
	const botToken = platform?.env?.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;
	const publicKey = platform?.env?.DISCORD_PUBLIC_KEY || process.env.DISCORD_PUBLIC_KEY;
	const guildId = interaction.guild_id;

	async function editOriginal(data) {
		try {
			const res = await fetch(
				`https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}/messages/@original`,
				{
					method: "PATCH",
					headers: {
						"Authorization": `Bot ${botToken}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify(data),
				},
			);
			if (!res.ok) {
				const errText = await res.text();
				log.error("[Stats] Failed to edit response:", errText);
			}
		} catch (err) {
			log.error("[Stats] Error editing response:", err);
		}
	}

	try {
		// Parse options
		const options = interaction.data?.options || [];
		const type = options.find(o => o.name === "type")?.value || "voice_time";
		const period = options.find(o => o.name === "period")?.value || "30d";

		const widgetInfo = WIDGET_TYPES[type];
		if (!widgetInfo) {
			await editOriginal({ content: "❌ Unknown stats type." });
			return;
		}

		if (!publicKey) {
			await editOriginal({ content: "❌ Server configuration error (missing public key)." });
			return;
		}

		// Determine our app's origin for the widget URL
		// In production: use the known production URL
		// In dev: use the dev tunnel URL
		const appUrl = platform?.env?.APP_URL || process.env.APP_URL || "https://spacebot.starspace.group";

		// Generate a signed URL to the widget endpoint
		const timestamp = Math.floor(Date.now() / 1000);
		const sig = await signWidgetUrl(guildId, type, period, timestamp, publicKey);
		const imageUrl = `${appUrl}/api/stats/${guildId}/widget?type=${type}&period=${period}&t=${timestamp}&sig=${sig}`;

		const periodLabel = period === "7d" ? "Last 7 Days" : "Last 30 Days";

		await editOriginal({
			embeds: [{
				title: `📊 ${widgetInfo.name}`,
				description: `${widgetInfo.description} • ${periodLabel}`,
				color: widgetInfo.color || 0x5865F2,
				image: { url: imageUrl },
				footer: { text: "SpaceBot Stats" },
				timestamp: new Date().toISOString(),
			}],
		});
	} catch (err) {
		log.error("[Stats] Stats command failed:", err);
		await editOriginal({
			content: `❌ Failed to generate stats widget: ${err.message || "Unknown error"}`,
		});
	}
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
		log.warn("No bot token available for REST client");
		return null;
	}

	const headers = {
		"Authorization": `Bot ${token}`,
		"Content-Type": "application/json",
	};

	// Simple Collection-like Map that supports discord.js .filter() chaining
	function createCollection(entries) {
		const map = new Map(entries);
		map.filter = function (fn) {
			const filtered = [];
			for (const [k, v] of this) {
				if (fn(v, k)) filtered.push([k, v]);
			}
			return createCollection(filtered);
		};
		return map;
	}

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

				// Text-based channel types: GUILD_TEXT(0), DM(1), GUILD_VOICE(2), GROUP_DM(3),
				// GUILD_CATEGORY(4), GUILD_ANNOUNCEMENT(5), ANNOUNCEMENT_THREAD(10),
				// PUBLIC_THREAD(11), PRIVATE_THREAD(12), GUILD_STAGE_VOICE(13), GUILD_FORUM(15)
				const textBasedTypes = [0, 1, 2, 3, 5, 10, 11, 12, 13, 15];
				const voiceTypes = [2, 13];

				return {
					id: channel.id,
					name: channel.name,
					type: channel.type,
					isTextBased() {
						return textBasedTypes.includes(channel.type);
					},
					isVoiceBased() {
						return voiceTypes.includes(channel.type);
					},
					messages: {
						async fetch(options = {}) {
							const params = new URLSearchParams();
							if (options.limit) params.set("limit", options.limit);
							if (options.before) params.set("before", options.before);
							const res = await fetch(
								`https://discord.com/api/v10/channels/${channelId}/messages?${params}`,
								{ headers },
							);
							if (!res.ok) return createCollection();
							const msgs = await res.json();
							const map = createCollection();
							for (const m of msgs) {
								map.set(m.id, {
									id: m.id,
									author: m.author,
									content: m.content,
									pinned: m.pinned,
									createdTimestamp: new Date(m.timestamp).getTime(),
									async delete() {
										await fetch(
											`https://discord.com/api/v10/channels/${channelId}/messages/${m.id}`,
											{ method: "DELETE", headers },
										);
									},
								});
							}
							return map;
						},
					},
					async bulkDelete(messages) {
						const ids = messages.map((m) => m.id);
						await fetch(
							`https://discord.com/api/v10/channels/${channelId}/messages/bulk-delete`,
							{
								method: "POST",
								headers,
								body: JSON.stringify({ messages: ids }),
							},
						);
					},
					async send(content) {
						const body = typeof content === "string" ? { content } : content;

						if (body?.files && Array.isArray(body.files) && body.files.length > 0) {
							const { files, ...payloadBody } = body;
							const formData = new FormData();
							formData.append("payload_json", JSON.stringify(payloadBody));

							files.forEach((file, index) => {
								const attachment = file?.attachment;
								const name = file?.name || `file-${index}.png`;
								const blob = attachment instanceof Blob
									? attachment
									: new Blob([attachment], { type: "image/png" });
								formData.append(`files[${index}]`, blob, name);
							});

							const fileRes = await fetch(
								`https://discord.com/api/v10/channels/${channelId}/messages`,
								{
									method: "POST",
									headers: { "Authorization": headers.Authorization },
									body: formData,
								},
							);
							return fileRes.json();
						}

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
					channels: {
						async fetch() {
							const res = await fetch(
								`https://discord.com/api/v10/guilds/${guildId}/channels`,
								{ headers },
							);
							if (!res.ok) return createCollection();
							const channels = await res.json();
							const textBasedTypes = [0, 1, 2, 3, 5, 10, 11, 12, 13, 15];
							const voiceTypes = [2, 13];
							const map = createCollection();
							for (const c of channels) {
								map.set(c.id, {
									id: c.id,
									name: c.name,
									type: c.type,
									isTextBased() {
										return textBasedTypes.includes(c.type);
									},
									isVoiceBased() {
										return voiceTypes.includes(c.type);
									},
								});
							}
							return map;
						},
					},
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
										const res = await fetch(
											`https://discord.com/api/v10/guilds/${guildId}/members/${userId}/roles/${roleId}`,
											{ method: "PUT", headers },
										);
										if (!res.ok) {
											const error = await res.text();
											log.error("Add role failed:", error);
											throw new Error(`Failed to add role: ${res.status}`);
										}
									},
									async remove(roleId) {
										const res = await fetch(
											`https://discord.com/api/v10/guilds/${guildId}/members/${userId}/roles/${roleId}`,
											{ method: "DELETE", headers },
										);
										if (!res.ok) {
											const error = await res.text();
											log.error("Remove role failed:", error);
											throw new Error(`Failed to remove role: ${res.status}`);
										}
									},
								},
								async kick(reason) {
									const res = await fetch(
										`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`,
										{
											method: "DELETE",
											headers: {
												...headers,
												"X-Audit-Log-Reason": reason || "",
											},
										},
									);
									if (!res.ok) {
										const error = await res.text();
										log.error("Kick failed:", error);
										throw new Error(`Failed to kick member: ${res.status}`);
									}
								},
								async timeout(duration, reason) {
									const until = new Date(Date.now() + duration).toISOString();
									const res = await fetch(
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
									if (!res.ok) {
										const error = await res.text();
										log.error("Timeout failed:", error);
										throw new Error(`Failed to timeout member: ${res.status}`);
									}
								},
							};
						},
						async ban(userId, options = {}) {
							const res = await fetch(
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
							if (!res.ok) {
								const error = await res.text();
								log.error("Ban failed:", error);
								throw new Error(`Failed to ban member: ${res.status}`);
							}
						},
					},
				};
			},
		},
	};
}
