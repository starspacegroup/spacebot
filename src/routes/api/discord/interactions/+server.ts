import { json } from '@sveltejs/kit';
import { InteractionResponseType, InteractionType, verifyKey } from 'discord-interactions';
import {
	buildCommandContext,
	getCommandByName,
	logCommandExecution,
	recordCommandUse,
	resolveEphemeralFlag,
} from '$lib/db/commands.js';
import {
	executeAction,
	processTemplate,
	resolveTargetUser,
	resolveNumberValue,
} from '$lib/automation/engine.js';
import {
	canOffloadPurge,
	enqueueMessagePurge,
	type PurgeMeta,
} from '$lib/server/message-purge-queue.js';
import type { PurgeDescriptor, PurgeMode } from '$lib/server/message-purge.js';
import { memberHasCommandPermission } from '$lib/discord/command-permissions.js';
import { applyContextMenuTargetToEvent } from '$lib/discord/context-menu.js';
import { log } from '$lib/db/logger.js';
import { getEnabledGuildIntegrations } from '$lib/db/integrations.js';
import { getIntegrationCommands } from '$lib/integrations/registry.js';
import { getLatestServerStats } from '$lib/db/server-stats.js';
import { getGuildMetadata } from '$lib/db/guild-metadata.js';
import {
	getMemberGrowthChart,
	getMessageActivityChart,
	getVoiceActivityChart,
	runStatsAggregation,
} from '$lib/db/stats-aggregation.js';
import { getTopVoiceUsers } from '$lib/db/statistics.js';
import { WIDGET_TYPES } from '$lib/stats-widget.js';

/** Cloudflare-style platform context with env bindings and waitUntil. */
interface PlatformLike {
	env?: Record<string, any>;
	context?: { waitUntil?: (promise: Promise<any>) => void };
	[key: string]: any;
}

/** Discord interaction response `data` payload (built incrementally). */
interface ResponseData {
	content?: string;
	embeds?: any[];
	components?: any[];
	flags?: number;
	[key: string]: any;
}

/** Minimal action-executor event object assembled from an interaction. */
interface ActionEvent {
	guild_id: any;
	channel_id: any;
	actor_id: any;
	actor_name: any;
	options: Record<string, any>;
	application_id: any;
	interaction_token: any;
	_bot_token: any;
	voice_channel_id?: any;
	voice_channel_name?: any;
	target_id?: any;
	target_message_id?: any;
}

/** Result returned by action execution / accumulated across actions. */
interface ActionResult {
	success: boolean;
	result?: any;
	error?: any;
	[key: string]: any;
}

/**
 * Convert hex string to Uint8Array
 */
function hexToUint8Array(hex: string) {
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
			'raw',
			hexToUint8Array(publicKey),
			{ name: 'Ed25519', namedCurve: 'Ed25519' },
			false,
			['verify']
		);

		return await crypto.subtle.verify(
			'Ed25519',
			key,
			hexToUint8Array(signature),
			encoder.encode(timestamp + body)
		);
	} catch {
		// Ed25519 not supported, fall back to discord-interactions library
		return null;
	}
}

/**
 * Verify Discord request signature
 */
async function verifyDiscordRequest(request, publicKey) {
	const signature = request.headers.get('x-signature-ed25519');
	const timestamp = request.headers.get('x-signature-timestamp');
	const body = await request.text();

	if (!signature || !timestamp) {
		return { isValid: false, body: null };
	}

	// Try Web Crypto first (for Cloudflare Workers)
	const webCryptoResult = await verifyWithWebCrypto(body, signature, timestamp, publicKey);

	if (webCryptoResult !== null) {
		return { isValid: webCryptoResult, body };
	}

	// Fall back to discord-interactions library (for Node.js environments)
	try {
		const isValid = verifyKey(body, signature, timestamp, publicKey);
		return { isValid, body };
	} catch (error) {
		log.error('Signature verification error:', error);
		return { isValid: false, body: null };
	}
}

function normalizeConditionValue(value) {
	if (value === undefined || value === null) return '';
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	return String(value).trim().toLowerCase();
}

function evaluateActionCondition(condition, event) {
	if (!condition || !condition.mode || condition.mode === 'always') {
		return true;
	}

	const optionName = condition.option;
	if (!optionName) {
		return true;
	}

	const actual = normalizeConditionValue(event.options?.[optionName]);
	const expected = normalizeConditionValue(condition.value);

	if (condition.mode === 'if_equals') {
		return actual === expected;
	}

	if (condition.mode === 'if_not_equals') {
		return actual !== expected;
	}

	return true;
}

function filterActionsByConditions(actions, event) {
	if (!Array.isArray(actions) || actions.length === 0) {
		return [];
	}

	const groupConditions = new Map();
	for (const action of actions) {
		const groupName = (action.group || 'default').trim() || 'default';
		const condition = action.condition;
		if (
			!groupConditions.has(groupName) &&
			condition &&
			condition.mode &&
			condition.mode !== 'always' &&
			condition.option
		) {
			groupConditions.set(groupName, condition);
		}
	}

	return actions.filter((action) => {
		const groupName = (action.group || 'default').trim() || 'default';
		const effectiveCondition = groupConditions.get(groupName) || action.condition;
		const shouldRun = evaluateActionCondition(effectiveCondition, event);

		if (!shouldRun) {
			log.debug(
				`[Command] Skipping action ${action.type} in group ${groupName} due to option condition mismatch`
			);
		}

		return shouldRun;
	});
}

function getEnv(platform: PlatformLike | undefined, name: string) {
	return (
		platform?.env?.[name] ?? (typeof process !== 'undefined' ? process.env?.[name] : undefined)
	);
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ request, platform: rawPlatform }) {
	const platform = rawPlatform as PlatformLike | undefined;
	log.debug('=== Discord Interaction Request Received ===');

	// Get the public key from environment
	const PUBLIC_KEY = getEnv(platform, 'DISCORD_PUBLIC_KEY');

	if (!PUBLIC_KEY) {
		log.error('DISCORD_PUBLIC_KEY not configured');
		return json({ error: 'Server configuration error' }, { status: 500 });
	}

	log.debug('Public key loaded, length:', PUBLIC_KEY.length);

	// Verify the request is from Discord
	const { isValid, body: rawBody } = await verifyDiscordRequest(request, PUBLIC_KEY);

	log.debug('Verification result:', isValid);

	if (!isValid) {
		log.error('Invalid request signature');
		return json({ error: 'Invalid request signature' }, { status: 401 });
	}

	let body;
	try {
		body = JSON.parse(rawBody);
		log.debug('Parsed body type:', body.type);
	} catch (error) {
		log.error('Failed to parse request body:', error);
		return json({ error: 'Invalid JSON' }, { status: 400 });
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

		// DM slash commands do not include guild_id. Provide a built-in /help response there.
		if (!guildId && data.name === 'help') {
			return json({
				type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
				data: {
					embeds: [
						{
							title: '🚀 SpaceBot Help',
							description:
								'Welcome to SpaceBot! Use /ping to check if the bot is online, /info for bot details, and /help for this message. Custom commands are configured by your server admin.',
							color: 0x57f287,
							fields: [
								{
									name: '🔗 Links',
									value: '[GitHub](https://github.com/starspacegroup/spacebot)',
									inline: false,
								},
							],
							footer: { text: 'Use /command to run a command' },
						},
					],
				},
			});
		}

		// Handle /stats built-in command (generates chart image)
		if (data.name === 'stats' && guildId) {
			const applicationId = body.application_id;
			const interactionToken = body.token;

			const asyncWork = handleStatsCommand(body, platform, applicationId, interactionToken);

			if (platform?.context?.waitUntil) {
				platform.context.waitUntil(asyncWork);
			} else {
				asyncWork.catch((err) => log.error('[Stats] Command error:', err));
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
				// Enforce configured permission restrictions server-side. Discord
				// also gates on default_member_permissions at its UI layer, but that
				// is advisory — re-check the invoking member's permissions here so a
				// crafted/stale interaction cannot bypass the restriction.
				if (
					!memberHasCommandPermission(
						body.member?.permissions,
						customCommand.default_member_permissions
					)
				) {
					return json({
						type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
						data: {
							content: "🚫 You don't have permission to use this command.",
							flags: 64, // EPHEMERAL
						},
					});
				}

				// Resolve per-invocation ephemerality NOW — before the defer
				// decision below, because Discord fixes a deferred reply's
				// visibility at defer time and it cannot be changed afterward.
				// Collapse the command to a plain boolean so every downstream
				// read (defer flag, response builder, failure path) is consistent.
				customCommand.ephemeral = resolveEphemeralFlag(customCommand, body);
				customCommand.ephemeral_option = null;

				// Check if command has actions that need deferring
				const hasActions =
					(customCommand.actions && customCommand.actions.length > 0) ||
					(customCommand.action_type &&
						customCommand.action_type !== 'NONE' &&
						customCommand.action_type !== 'MULTIPLE');

				if (hasActions) {
					// Defer the response so Discord doesn't time out
					const applicationId = body.application_id;
					const interactionToken = body.token;

					// Fire off the async work
					const asyncWork = handleDeferredCommand(
						customCommand,
						body,
						db,
						platform,
						applicationId,
						interactionToken
					);

					// Use platform.context.waitUntil if available (Cloudflare Workers)
					if (platform?.context?.waitUntil) {
						platform.context.waitUntil(asyncWork);
					} else {
						// Fire and forget for non-Cloudflare environments
						asyncWork.catch((err) =>
							log.error('[Command] Deferred command error:', err)
						);
					}

					// Return deferred response immediately (type 5)
					const deferData: ResponseData = {};
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
				content: 'Unknown command',
			},
		});
	}

	// Type 3: MESSAGE_COMPONENT - Button clicks, select menus
	if (body.type === InteractionType.MESSAGE_COMPONENT) {
		return json({
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: {
				content: 'Button interaction received!',
			},
		});
	}

	return json({ error: 'Unknown interaction type' }, { status: 400 });
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
						type: 'command',
						command: data.name,
						options: data.options || [],
						guild_id: guildId,
						user: interaction.member?.user || interaction.user || null,
						channel_id: interaction.channel_id || null,
						integration_slug: integration.slug,
					};

					log.debug(`[Interactions] Proxying /${data.name} to ${handlerUrl}`);

					const webhookResponse = await fetch(handlerUrl, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'X-SpaceBot-Integration': integration.slug,
							'X-SpaceBot-Guild': guildId,
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
								content: responseData.content || 'Command executed.',
								embeds: responseData.embeds || undefined,
								components: responseData.components || undefined,
								flags: responseData.ephemeral ? 64 : undefined,
							},
						});
					}

					log.warn(
						`[Interactions] Integration webhook returned ${webhookResponse.status} for /${data.name}`
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
						err
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
			if (integration.slug === 'starspace-game') {
				if (subcommand === 'play') {
					const homepage = manifest?.homepage || 'https://game.starspace.group/';
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
						content: `The \`/game ${subcommand || ''}\` command requires the Game server to be online. It doesn't appear to be connected right now.`,
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
		log.error('[Interactions] Integration command lookup error:', err);
	}

	return null;
}

/**
 * Build the visible response for a custom command from its configured
 * response_type / templates. Call this AFTER actions run so that fields an
 * integration action returned are available in the template as {action.*}.
 */
function buildCommandResponseData(command: any, context: any, includeFlags = true): ResponseData {
	const responseData: ResponseData = {};

	if (command.response_type === 'message' && command.response_content) {
		responseData.content = processTemplate(command.response_content, context);
	} else if (command.response_type === 'embed' && command.response_embed) {
		const embed = { ...command.response_embed };
		if (embed.description) {
			embed.description = processTemplate(embed.description, context);
		}
		if (embed.title) {
			embed.title = processTemplate(embed.title, context);
		}
		responseData.embeds = [embed];
	} else if (command.response_type === 'action_only') {
		// No configured response — acknowledge (may be replaced by an
		// integration action's own content/embeds by the caller).
		responseData.content = '✅ Command executed';
	} else {
		responseData.content = `Command /${command.name} executed`;
	}

	if (includeFlags && command.ephemeral) {
		responseData.flags = 64; // EPHEMERAL
	}

	return responseData;
}

/**
 * Whether the command author configured an explicit visible response. When they
 * didn't, an integration action's own content/embeds may stand in as the reply.
 */
function commandHasConfiguredResponse(command: any): boolean {
	return (
		(command.response_type === 'message' && !!command.response_content) ||
		(command.response_type === 'embed' && !!command.response_embed)
	);
}

/**
 * Pick the last integration-action direct response (content/embeds) from a set
 * of action results, if any action returned one.
 */
function pickIntegrationResponse(
	results: any[]
): { content?: string; embeds?: any[]; ephemeral?: boolean } | null {
	for (let i = results.length - 1; i >= 0; i--) {
		const r = results[i];
		if (
			r &&
			r.response &&
			(r.response.content !== undefined || Array.isArray(r.response.embeds))
		) {
			return r.response;
		}
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
async function handleCustomCommand(
	command: any,
	interaction: any,
	db: any,
	platform: PlatformLike | undefined
) {
	const startTime = Date.now();
	const userId = interaction.member?.user?.id || interaction.user?.id;
	const guildId = interaction.guild_id;

	log.debug(`[Command] Executing custom command: ${command.name}`);

	// If command requires voice channel, check the user's voice state
	let voiceState = null;
	if (command.require_voice) {
		const token = getEnv(platform, 'DISCORD_BOT_TOKEN');
		if (token && guildId && userId) {
			try {
				const vsRes = await fetch(
					`https://discord.com/api/v10/guilds/${guildId}/voice-states/${userId}`,
					{ headers: { Authorization: `Bot ${token}` } }
				);
				if (vsRes.ok) {
					const vsData = await vsRes.json();
					if (vsData.channel_id) {
						// Fetch channel name for template variables
						let channelName = '';
						try {
							const chRes = await fetch(
								`https://discord.com/api/v10/channels/${vsData.channel_id}`,
								{ headers: { Authorization: `Bot ${token}` } }
							);
							if (chRes.ok) {
								const chData = await chRes.json();
								channelName = chData.name || '';
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
				log.error('[Command] Failed to fetch voice state:', err);
			}
		}

		if (!voiceState) {
			return json({
				type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
				data: {
					content: '🔇 You must be in a voice channel to use this command.',
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
		name: guildMeta?.name || 'Unknown Server',
		member_count: guildStats?.member_count ?? guildMeta?.approximate_member_count ?? null,
		human_count: guildStats?.human_count ?? null,
		bot_count: guildStats?.bot_count ?? null,
		boost_count: guildStats?.boost_count ?? guildMeta?.premium_subscription_count ?? null,
		boost_level: guildStats?.boost_level ?? guildMeta?.premium_tier ?? null,
	};

	const context: any = buildCommandContext(interaction, guildInfo, voiceState);
	context.widget_signing_secret = getEnv(platform, 'DISCORD_PUBLIC_KEY');
	context.widget_origin =
		getEnv(platform, 'APP_URL') ?? getEnv(platform, 'API_BASE') ?? 'http://localhost:4269';

	// Record usage
	await recordCommandUse(db, command.id);

	// The visible response is built AFTER actions run (see below) so that fields
	// an integration action returns are available to the template as {action.*}.
	let integrationResponse: { content?: string; embeds?: any[]; ephemeral?: boolean } | null =
		null;

	// For now, execute actions synchronously (defer support to be added)
	// In the future, if command.defer is true, we should defer and execute async
	let actionResult: ActionResult = { success: true };

	// Check if command has actions to execute (either stacked or legacy)
	const hasActions =
		(command.actions && command.actions.length > 0) ||
		(command.action_type &&
			command.action_type !== 'NONE' &&
			command.action_type !== 'MULTIPLE');

	if (hasActions) {
		// Create a minimal event object for the action executor
		const event: ActionEvent = {
			guild_id: interaction.guild_id,
			channel_id: interaction.channel_id,
			actor_id: context.user.id,
			actor_name: context.user.name,
			options: {}, // Store all option values by name
			application_id: interaction.application_id,
			interaction_token: interaction.token,
			_bot_token: getEnv(platform, 'DISCORD_BOT_TOKEN'),
		};

		// Add voice channel info to event if available
		if (voiceState) {
			event.voice_channel_id = voiceState.channel_id;
			event.voice_channel_name = voiceState.channel_name;
		}

		// Resolve user/message context-menu targets into the action event so
		// context-menu commands reuse the slash-command action pipeline.
		applyContextMenuTargetToEvent(event, interaction.data, interaction.channel_id);

		// Add option values to event for action processing
		if (interaction.data?.options) {
			for (const opt of interaction.data.options) {
				// Store all options by name for target_user resolution
				event.options[opt.name] = opt.value;

				// Legacy: Map first user option to target_id for backwards compatibility
				if (opt.type === 6 && !event.target_id) {
					// USER
					event.target_id = opt.value;
				}
			}
		}

		// For actions that need Discord client, we'll use REST API
		// This is a simplified version - full discord.js client would be needed for complex actions
		const discord = createRESTClient(platform);

		if (discord) {
			// Get actions array - either from stacked format or construct from legacy
			const actionsToExecute =
				command.actions && command.actions.length > 0
					? command.actions
					: [{ type: command.action_type, config: command.action_config || {} }];
			const filteredActions = filterActionsByConditions(actionsToExecute, event);

			// Execute each action in sequence
			const results = [];
			for (const action of filteredActions) {
				const result = await executeAction(
					{
						name: command.name,
						action_type: action.type,
						action_config: action.config || {},
					},
					event,
					context,
					discord,
					db
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

			integrationResponse = pickIntegrationResponse(results);
		}
	}

	// Build the visible response now that actions have populated {action.*}.
	const responseData = buildCommandResponseData(command, context);

	// If the author didn't configure a response but an integration action
	// returned its own content/embeds, use that as the reply. A returned
	// `ephemeral` flag chooses per-invocation whether the reply is private —
	// honored generically here (this is the immediate, non-deferred path, so we
	// can set the flag directly).
	if (integrationResponse && !commandHasConfiguredResponse(command)) {
		if (integrationResponse.content !== undefined) {
			responseData.content = integrationResponse.content;
		}
		if (Array.isArray(integrationResponse.embeds)) {
			responseData.embeds = integrationResponse.embeds;
		}
		if (typeof integrationResponse.ephemeral === 'boolean') {
			responseData.flags = integrationResponse.ephemeral ? 64 : undefined;
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
	if (!actionResult.success && command.action_type !== 'NONE') {
		responseData.content = `❌ Command failed: ${actionResult.error || 'Unknown error'}`;
		if (command.ephemeral) {
			responseData.flags = 64;
		}
	}

	return json({
		type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
		data: responseData,
	});
}

/** Delete actions that sweep message history and can grow unbounded. */
const PURGE_ACTION_TYPES = new Set([
	'DELETE_USER_MESSAGES',
	'DELETE_MESSAGES',
	'DELETE_MENTIONED_MESSAGES',
]);

/** A server-wide sweep (every channel) is the case the edge can't reliably
 * finish within one request's subrequest budget — offload those. Explicit,
 * bounded channel lists stay inline. */
function isBroadSweep(config: any): boolean {
	const channels = config?.channel_ids;
	return !channels || channels === 'ALL';
}

/** Map a delete action's config into a durable PurgeDescriptor, resolving the
 * target user and any option-ref numbers against the interaction event. Returns
 * null when the target user can't be resolved. */
function buildPurgeDescriptor(actionType: string, config: any, event: any): PurgeDescriptor | null {
	const userId = resolveTargetUser(config, event);
	if (!userId) return null;

	const channel_ids = config?.channel_ids || 'ALL';
	const common = { guild_id: event.guild_id, user_id: userId, channel_ids };

	if (actionType === 'DELETE_USER_MESSAGES') {
		return {
			...common,
			mode: 'user' as PurgeMode,
			max_age_days: resolveNumberValue(config?.max_age_days, event, null),
			max_messages: resolveNumberValue(config?.max_messages, event, null),
			skip_pinned: config?.skip_pinned !== false && config?.skip_pinned !== 'false',
		};
	}

	// DELETE_MESSAGES / DELETE_MENTIONED_MESSAGES: bounded by `limit`, no age/pin.
	const mode: PurgeMode = actionType === 'DELETE_MENTIONED_MESSAGES' ? 'mentions' : 'user';
	return {
		...common,
		mode,
		max_age_days: null,
		max_messages: Number(config?.limit) || 100,
		skip_pinned: false,
	};
}

/**
 * Handle a deferred custom command - executes actions asynchronously
 * and follows up via Discord webhook
 */
async function handleDeferredCommand(
	command: any,
	interaction: any,
	db: any,
	platform: PlatformLike | undefined,
	applicationId: any,
	interactionToken: any
) {
	const startTime = Date.now();
	const userId = interaction.member?.user?.id || interaction.user?.id;
	const guildId = interaction.guild_id;

	log.debug(`[Command] Executing deferred command: ${command.name}`);

	const botToken = getEnv(platform, 'DISCORD_BOT_TOKEN');

	// Helper to edit the deferred response
	async function editOriginalResponse(data: any) {
		try {
			const res = await fetch(
				`https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}/messages/@original`,
				{
					method: 'PATCH',
					headers: {
						Authorization: `Bot ${botToken}`,
						'Content-Type': 'application/json',
					},
					body: JSON.stringify(data),
				}
			);
			if (!res.ok) {
				const errText = await res.text();
				log.error('[Command] Failed to edit deferred response:', errText);
			}
		} catch (err) {
			log.error('[Command] Error editing deferred response:', err);
		}
	}

	// Post an additional interaction message. Without the ephemeral flag it is a
	// normal (public) channel message — used to promote an integration action's
	// `ephemeral: false` response to the channel when the deferred reply itself
	// was created ephemerally (ephemerality is fixed at defer time).
	async function sendFollowup(data: any) {
		try {
			const res = await fetch(
				`https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}`,
				{
					method: 'POST',
					headers: {
						Authorization: `Bot ${botToken}`,
						'Content-Type': 'application/json',
					},
					body: JSON.stringify(data),
				}
			);
			if (!res.ok) {
				const errText = await res.text();
				log.error('[Command] Failed to send followup:', errText);
			}
		} catch (err) {
			log.error('[Command] Error sending followup:', err);
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
						{ headers: { Authorization: `Bot ${botToken}` } }
					);
					if (vsRes.ok) {
						const vsData = await vsRes.json();
						if (vsData.channel_id) {
							let channelName = '';
							try {
								const chRes = await fetch(
									`https://discord.com/api/v10/channels/${vsData.channel_id}`,
									{ headers: { Authorization: `Bot ${botToken}` } }
								);
								if (chRes.ok) {
									const chData = await chRes.json();
									channelName = chData.name || '';
								}
							} catch {
								/* not critical */
							}
							voiceState = {
								channel_id: vsData.channel_id,
								channel_name: channelName,
							};
						}
					}
				} catch (err) {
					log.error('[Command] Failed to fetch voice state:', err);
				}
			}

			if (!voiceState) {
				await editOriginalResponse({
					content: '🔇 You must be in a voice channel to use this command.',
				});
				return;
			}
		}

		const [guildMeta, guildStats] = await Promise.all([
			getGuildMetadata(db, guildId).catch(() => null),
			getLatestServerStats(db, guildId).catch(() => null),
		]);
		const guildInfo = {
			name: guildMeta?.name || 'Unknown Server',
			member_count: guildStats?.member_count ?? guildMeta?.approximate_member_count ?? null,
			human_count: guildStats?.human_count ?? null,
			bot_count: guildStats?.bot_count ?? null,
			boost_count: guildStats?.boost_count ?? guildMeta?.premium_subscription_count ?? null,
			boost_level: guildStats?.boost_level ?? guildMeta?.premium_tier ?? null,
		};

		const context: any = buildCommandContext(interaction, guildInfo, voiceState);
		context.widget_signing_secret = getEnv(platform, 'DISCORD_PUBLIC_KEY');
		context.widget_origin =
			getEnv(platform, 'APP_URL') ?? getEnv(platform, 'API_BASE') ?? 'http://localhost:4269';

		// Record usage
		await recordCommandUse(db, command.id);

		// The visible response is built AFTER actions run (below) so an
		// integration action's returned fields are available as {action.*}.
		let integrationResponse: { content?: string; embeds?: any[]; ephemeral?: boolean } | null =
			null;

		// Execute actions
		let actionResult: ActionResult = { success: true };

		const event: ActionEvent = {
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

		// Resolve user/message context-menu targets into the action event.
		applyContextMenuTargetToEvent(event, interaction.data, interaction.channel_id);

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
			const actionsToExecute =
				command.actions && command.actions.length > 0
					? command.actions
					: [{ type: command.action_type, config: command.action_config || {} }];
			const filteredActions = filterActionsByConditions(actionsToExecute, event);

			const results = [];
			let purgeOffloaded = false;
			for (const action of filteredActions) {
				// A server-wide message purge can exceed a single edge request's
				// subrequest budget. Hand those to the durable MessagePurgeWorkflow,
				// which pages through history one bounded batch at a time. Bounded,
				// single-channel deletes still run inline below.
				if (
					PURGE_ACTION_TYPES.has(action.type) &&
					isBroadSweep(action.config || {}) &&
					canOffloadPurge(platform)
				) {
					const descriptor = buildPurgeDescriptor(
						action.type,
						action.config || {},
						event
					);
					if (descriptor) {
						const meta: PurgeMeta = {
							interaction_id: interaction.id,
							application_id: applicationId,
							interaction_token: interactionToken,
							channel_id: interaction.channel_id,
							command_name: command.name,
						};
						const enqueued = await enqueueMessagePurge(platform, descriptor, meta);
						if (enqueued) {
							purgeOffloaded = true;
							results.push({ success: true, result: { offloaded: 'message_purge' } });
							continue;
						}
						// Enqueue failed → fall through to inline execution.
					}
				}

				const result = await executeAction(
					{
						name: command.name,
						action_type: action.type,
						action_config: action.config || {},
					},
					event,
					context,
					discord,
					db
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

			integrationResponse = pickIntegrationResponse(results);

			// A queued purge updates its own reply as it runs; show a starting note
			// instead of the generic command response and skip the final edit below.
			// If another action in the command failed, fall through to the normal
			// failure edit rather than masking it.
			if (purgeOffloaded && actionResult.success) {
				await editOriginalResponse({
					content:
						'🧹 Purging messages across the server… I’ll update this message as it runs.',
				});
				await logCommandExecution(db, {
					command_id: command.id,
					guild_id: interaction.guild_id,
					user_id: context.user.id,
					user_name: context.user.name,
					channel_id: interaction.channel_id,
					options_used: interaction.data?.options || null,
					action_result: { offloaded: 'message_purge' },
					success: true,
					error_message: null,
					execution_time_ms: Date.now() - startTime,
				});
				return;
			}
		}

		// Build the visible response now that actions have populated {action.*}.
		// Ephemerality was fixed at defer time, so don't re-apply the flag here.
		const responseData = buildCommandResponseData(command, context, false);

		if (integrationResponse && !commandHasConfiguredResponse(command)) {
			// Ephemerality is fixed at defer time. If the action asked for a public
			// reply (`ephemeral: false`) but we deferred ephemerally, we can't
			// un-hide the deferred message — so post the content/embeds as a public
			// followup and leave the ephemeral reply as a short ack only the user
			// sees. This is generic (driven by the action response, not any one
			// integration), so an integration can decide per invocation.
			const deferredEphemeral = Boolean(command.ephemeral);
			const wantsPublic = integrationResponse.ephemeral === false;

			if (wantsPublic && deferredEphemeral) {
				await sendFollowup({
					content: integrationResponse.content ?? undefined,
					embeds: Array.isArray(integrationResponse.embeds)
						? integrationResponse.embeds
						: undefined,
				});
				responseData.content = '✅ Posted to the channel.';
				responseData.embeds = undefined;
			} else {
				if (integrationResponse.content !== undefined) {
					responseData.content = integrationResponse.content;
				}
				if (Array.isArray(integrationResponse.embeds)) {
					responseData.embeds = integrationResponse.embeds;
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

		// Update the deferred response with the result
		if (!actionResult.success && command.action_type !== 'NONE') {
			responseData.content = `❌ Command failed: ${actionResult.error || 'Unknown error'}`;
		}

		await editOriginalResponse(responseData);
	} catch (err) {
		log.error('[Command] Deferred command failed:', err);
		await editOriginalResponse({
			content: `❌ Command failed: ${err.message || 'Unknown error'}`,
		});
	}
}

/**
 * Convert YYYY-MM-DD into a compact month/day label for chart x-axis.
 */
function formatChartDateLabel(dateStr) {
	const parsed = new Date(`${dateStr}T00:00:00Z`);
	if (Number.isNaN(parsed.getTime())) return dateStr;
	return `${parsed.getUTCMonth() + 1}/${parsed.getUTCDate()}`;
}

/**
 * Build a QuickChart (Chart.js) config for the selected stats type.
 */
function buildStatsChartConfig(type, period, widgetInfo, chartRows, latestMemberCount = null) {
	const labels = chartRows.map((row) => formatChartDateLabel(row.date));
	const isSevenDay = period === '7d';
	const pointRadius = isSevenDay ? 3 : 2;

	const baseOptions = {
		responsive: false,
		maintainAspectRatio: false,
		plugins: {
			legend: {
				labels: {
					color: '#f8fafc',
					font: { size: 12 },
				},
			},
			title: {
				display: true,
				text: widgetInfo.name,
				color: '#ffffff',
				font: { size: 18, weight: 'bold' },
			},
		},
		scales: {
			x: {
				ticks: { color: '#cbd5e1', maxRotation: 0, autoSkip: true, maxTicksLimit: 10 },
				grid: { color: 'rgba(148, 163, 184, 0.15)' },
			},
			y: {
				beginAtZero: true,
				ticks: { color: '#cbd5e1' },
				grid: { color: 'rgba(148, 163, 184, 0.15)' },
			},
		},
	};

	if (type === 'voice_time') {
		return {
			type: 'line',
			data: {
				labels,
				datasets: [
					{
						label: 'Hours in Voice',
						data: chartRows.map((row) => row.totalHours || 0),
						borderColor: '#06b6d4',
						backgroundColor: 'rgba(6, 182, 212, 0.25)',
						fill: true,
						tension: 0.35,
						pointRadius,
					},
				],
			},
			options: baseOptions,
		};
	}

	if (type === 'voice_users') {
		return {
			type: 'bar',
			data: {
				labels,
				datasets: [
					{
						label: 'Unique Voice Users',
						data: chartRows.map((row) => row.uniqueUsers || 0),
						backgroundColor: 'rgba(59, 130, 246, 0.8)',
					},
				],
			},
			options: baseOptions,
		};
	}

	if (type === 'voice_peak') {
		return {
			type: 'bar',
			data: {
				labels,
				datasets: [
					{
						label: 'Peak Concurrent Voice',
						data: chartRows.map((row) => row.peakConcurrent || 0),
						backgroundColor: 'rgba(14, 165, 233, 0.85)',
					},
				],
			},
			options: baseOptions,
		};
	}

	if (type === 'member_count') {
		const latest = Number(latestMemberCount);
		let running = Number.isFinite(latest) ? latest : 0;
		const memberCounts = new Array(chartRows.length);

		for (let i = chartRows.length - 1; i >= 0; i--) {
			memberCounts[i] = Math.max(0, Math.round(running));
			running -= Number(chartRows[i].netChange || 0);
		}

		return {
			type: 'line',
			data: {
				labels,
				datasets: [
					{
						label: 'Estimated Member Count',
						data: memberCounts,
						borderColor: '#22c55e',
						backgroundColor: 'rgba(34, 197, 94, 0.25)',
						fill: true,
						tension: 0.25,
						pointRadius,
					},
				],
			},
			options: baseOptions,
		};
	}

	if (type === 'member_growth') {
		return {
			type: 'bar',
			data: {
				labels,
				datasets: [
					{
						label: 'Joins',
						data: chartRows.map((row) => row.joins || 0),
						backgroundColor: 'rgba(34, 197, 94, 0.85)',
					},
					{
						label: 'Leaves',
						data: chartRows.map((row) => row.leaves || 0),
						backgroundColor: 'rgba(239, 68, 68, 0.85)',
					},
				],
			},
			options: baseOptions,
		};
	}

	if (type === 'member_joins') {
		return {
			type: 'bar',
			data: {
				labels,
				datasets: [
					{
						label: 'Member Joins',
						data: chartRows.map((row) => row.joins || 0),
						backgroundColor: 'rgba(16, 185, 129, 0.85)',
					},
				],
			},
			options: baseOptions,
		};
	}

	if (type === 'member_leaves') {
		return {
			type: 'bar',
			data: {
				labels,
				datasets: [
					{
						label: 'Member Leaves',
						data: chartRows.map((row) => row.leaves || 0),
						backgroundColor: 'rgba(244, 63, 94, 0.85)',
					},
				],
			},
			options: baseOptions,
		};
	}

	if (type === 'member_net_change') {
		return {
			type: 'line',
			data: {
				labels,
				datasets: [
					{
						label: 'Net Change',
						data: chartRows.map((row) => row.netChange || 0),
						borderColor: '#f59e0b',
						backgroundColor: 'rgba(245, 158, 11, 0.25)',
						fill: true,
						tension: 0.25,
						pointRadius,
					},
				],
			},
			options: {
				...baseOptions,
				scales: {
					...baseOptions.scales,
					y: {
						...baseOptions.scales.y,
						beginAtZero: false,
					},
				},
			},
		};
	}

	if (type === 'message_count') {
		return {
			type: 'bar',
			data: {
				labels,
				datasets: [
					{
						label: 'Messages',
						data: chartRows.map((row) => row.messageCount || 0),
						backgroundColor: 'rgba(168, 85, 247, 0.85)',
					},
				],
			},
			options: baseOptions,
		};
	}

	return {
		type: 'line',
		data: {
			labels,
			datasets: [
				{
					label: 'Unique Message Authors',
					data: chartRows.map((row) => row.messageUniqueUsers || 0),
					borderColor: '#a855f7',
					backgroundColor: 'rgba(168, 85, 247, 0.25)',
					fill: true,
					tension: 0.3,
					pointRadius,
				},
			],
		},
		options: baseOptions,
	};
}

/**
 * Create a hosted QuickChart URL for an embed image.
 */
async function createQuickChartUrl(chartConfig) {
	const payload = {
		width: 900,
		height: 420,
		backgroundColor: '#0f172a',
		devicePixelRatio: 2,
		format: 'png',
		chart: chartConfig,
	};

	try {
		const res = await fetch('https://quickchart.io/chart/create', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		});

		if (res.ok) {
			const body = await res.json();
			if (body?.url) {
				return body.url;
			}
		}
	} catch (err) {
		log.warn('[Stats] QuickChart short URL creation failed, using direct URL fallback:', err);
	}

	const encoded = encodeURIComponent(JSON.stringify(chartConfig));
	return `https://quickchart.io/chart?width=900&height=420&devicePixelRatio=2&bkg=%230f172a&format=png&c=${encoded}`;
}

function formatLeaderboardDuration(totalSeconds) {
	const clamped = Math.max(0, Number(totalSeconds) || 0);
	const hours = Math.floor(clamped / 3600);
	const minutes = Math.floor((clamped % 3600) / 60);

	if (hours > 0) {
		return `${hours}h ${minutes}m`;
	}

	return `${minutes}m`;
}

function getStatsPeriodLabel(period) {
	return period === '7d' ? 'Last 7 Days' : 'Last 30 Days';
}

/**
 * Handle the /stats built-in command.
 * Builds a QuickChart image from server stats data and responds with an embed containing the chart.
 */
async function handleStatsCommand(
	interaction: any,
	platform: PlatformLike | undefined,
	applicationId: any,
	interactionToken: any
) {
	const botToken = getEnv(platform, 'DISCORD_BOT_TOKEN');
	const guildId = interaction.guild_id;
	const db = platform?.env?.DB;

	async function editOriginal(data) {
		try {
			const res = await fetch(
				`https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}/messages/@original`,
				{
					method: 'PATCH',
					headers: {
						Authorization: `Bot ${botToken}`,
						'Content-Type': 'application/json',
					},
					body: JSON.stringify(data),
				}
			);
			if (!res.ok) {
				const errText = await res.text();
				log.error('[Stats] Failed to edit response:', errText);
			}
		} catch (err) {
			log.error('[Stats] Error editing response:', err);
		}
	}

	try {
		// Parse options
		const options = interaction.data?.options || [];
		const type = options.find((o) => o.name === 'type')?.value || 'voice_time';
		const period = options.find((o) => o.name === 'period')?.value || '30d';
		const periodLabel = getStatsPeriodLabel(period);
		const isVoiceLeaderboard = type === 'voice_leaderboard';

		const widgetInfo = isVoiceLeaderboard ? null : WIDGET_TYPES[type];
		if (!isVoiceLeaderboard && !widgetInfo) {
			await editOriginal({ content: '❌ Unknown stats type.' });
			return;
		}

		if (!db) {
			await editOriginal({ content: '❌ Database not available.' });
			return;
		}

		const [guildMeta, latest] = await Promise.all([
			getGuildMetadata(db, guildId).catch(() => null),
			getLatestServerStats(db, guildId).catch(() => null),
		]);

		const timezone = guildMeta?.timezone || null;
		await runStatsAggregation(db, guildId).catch((err) => {
			log.warn(`[Stats] Aggregation failed for ${guildId}:`, err);
		});

		if (isVoiceLeaderboard) {
			const leaderboardRows = await getTopVoiceUsers(db, guildId, 10, period);

			if (!leaderboardRows.length) {
				await editOriginal({
					content:
						'ℹ️ Not enough voice history data yet. Try again after more voice activity has been logged.',
				});
				return;
			}

			const topLines = leaderboardRows.map((row, index) => {
				const userLabel = row.actor_id
					? `<@${row.actor_id}>`
					: row.actor_name || 'Unknown User';
				const duration = formatLeaderboardDuration(row.total_seconds);
				return `${index + 1}. ${userLabel} - ${duration}`;
			});

			await editOriginal({
				embeds: [
					{
						title: '🎙️ Voice Chat Leaderboard',
						description: `${periodLabel}`,
						color: 0x57f287,
						fields: [
							{
								name: 'Top Voice Time',
								value: topLines.join('\n'),
							},
						],
						footer: { text: 'SpaceBot Stats' },
						timestamp: new Date().toISOString(),
					},
				],
			});
			return;
		}

		let chartRows = [];
		if (type === 'voice_time' || type === 'voice_users' || type === 'voice_peak') {
			chartRows = await getVoiceActivityChart(db, guildId, period, timezone);
		} else if (
			type === 'member_count' ||
			type === 'member_growth' ||
			type === 'member_joins' ||
			type === 'member_leaves' ||
			type === 'member_net_change'
		) {
			chartRows = await getMemberGrowthChart(db, guildId, period, timezone);
		} else if (type === 'message_count' || type === 'message_users') {
			chartRows = await getMessageActivityChart(db, guildId, period, timezone);
		}

		if (!chartRows.length) {
			await editOriginal({
				content:
					'ℹ️ Not enough stats data yet. Try again after some server activity has been logged.',
			});
			return;
		}

		const latestMemberCount = latest?.human_count ?? latest?.member_count ?? null;
		const chartConfig = buildStatsChartConfig(
			type,
			period,
			widgetInfo,
			chartRows,
			latestMemberCount
		);
		const imageUrl = await createQuickChartUrl(chartConfig);

		await editOriginal({
			embeds: [
				{
					title: `📊 ${widgetInfo.name}`,
					description: `${widgetInfo.description} • ${periodLabel}`,
					color: widgetInfo.color || 0x5865f2,
					image: { url: imageUrl },
					footer: { text: 'SpaceBot Stats' },
					timestamp: new Date().toISOString(),
				},
			],
		});
	} catch (err) {
		log.error('[Stats] Stats command failed:', err);
		await editOriginal({
			content: `❌ Failed to generate stats chart: ${err.message || 'Unknown error'}`,
		});
	}
}

/**
 * Create a minimal REST client for action execution
 * Note: This is a simplified client for basic actions
 * Complex actions may need the full discord.js gateway client
 */
function createRESTClient(platform: PlatformLike | undefined) {
	const token = getEnv(platform, 'DISCORD_BOT_TOKEN');

	if (!token) {
		log.warn('No bot token available for REST client');
		return null;
	}

	const headers = {
		Authorization: `Bot ${token}`,
		'Content-Type': 'application/json',
	};

	// Simple Collection-like Map that supports discord.js .filter() chaining
	function createCollection(entries?: Iterable<readonly [any, any]>) {
		const map = new Map<any, any>(entries) as Map<any, any> & {
			filter: (fn: (v: any, k: any) => boolean) => any;
		};
		map.filter = function (fn: (v: any, k: any) => boolean) {
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
				const response = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
					headers,
				});
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
						async fetch(options: { limit?: any; before?: any } = {}) {
							const params = new URLSearchParams();
							if (options.limit) params.set('limit', options.limit);
							if (options.before) params.set('before', options.before);
							const res = await fetch(
								`https://discord.com/api/v10/channels/${channelId}/messages?${params}`,
								{ headers }
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
									// discord.js exposes MessageMentions.has(); mirror it over the
									// raw mentions array so DELETE_MENTIONED_MESSAGES works on the
									// edge REST client, not just the gateway.
									mentions: {
										has: (id: string) =>
											Array.isArray(m.mentions) &&
											m.mentions.some((u: { id?: string }) => u?.id === id),
									},
									async delete() {
										await fetch(
											`https://discord.com/api/v10/channels/${channelId}/messages/${m.id}`,
											{ method: 'DELETE', headers }
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
								method: 'POST',
								headers,
								body: JSON.stringify({ messages: ids }),
							}
						);
					},
					async send(content) {
						const body = typeof content === 'string' ? { content } : content;

						if (body?.files && Array.isArray(body.files) && body.files.length > 0) {
							const { files, ...payloadBody } = body;
							const formData = new FormData();
							formData.append('payload_json', JSON.stringify(payloadBody));

							files.forEach((file, index) => {
								const attachment = file?.attachment;
								const name = file?.name || `file-${index}.png`;
								const blob =
									attachment instanceof Blob
										? attachment
										: new Blob([attachment], { type: 'image/png' });
								formData.append(`files[${index}]`, blob, name);
							});

							const fileRes = await fetch(
								`https://discord.com/api/v10/channels/${channelId}/messages`,
								{
									method: 'POST',
									headers: { Authorization: headers.Authorization },
									body: formData,
								}
							);
							return fileRes.json();
						}

						const res = await fetch(
							`https://discord.com/api/v10/channels/${channelId}/messages`,
							{
								method: 'POST',
								headers,
								body: JSON.stringify(body),
							}
						);
						return res.json();
					},
				};
			},
		},
		guilds: {
			async fetch(guildId) {
				const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}`, {
					headers,
				});
				if (!response.ok) return null;
				const guild = await response.json();

				return {
					id: guild.id,
					name: guild.name,
					channels: {
						async fetch() {
							const res = await fetch(
								`https://discord.com/api/v10/guilds/${guildId}/channels`,
								{ headers }
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
								{ headers }
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
											{ method: 'PUT', headers }
										);
										if (!res.ok) {
											const error = await res.text();
											log.error('Add role failed:', error);
											throw new Error(`Failed to add role: ${res.status}`);
										}
									},
									async remove(roleId) {
										const res = await fetch(
											`https://discord.com/api/v10/guilds/${guildId}/members/${userId}/roles/${roleId}`,
											{ method: 'DELETE', headers }
										);
										if (!res.ok) {
											const error = await res.text();
											log.error('Remove role failed:', error);
											throw new Error(`Failed to remove role: ${res.status}`);
										}
									},
								},
								async kick(reason) {
									const res = await fetch(
										`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`,
										{
											method: 'DELETE',
											headers: {
												...headers,
												'X-Audit-Log-Reason': reason || '',
											},
										}
									);
									if (!res.ok) {
										const error = await res.text();
										log.error('Kick failed:', error);
										throw new Error(`Failed to kick member: ${res.status}`);
									}
								},
								async timeout(duration, reason) {
									const until = new Date(Date.now() + duration).toISOString();
									const res = await fetch(
										`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`,
										{
											method: 'PATCH',
											headers: {
												...headers,
												'X-Audit-Log-Reason': reason || '',
											},
											body: JSON.stringify({
												communication_disabled_until: until,
											}),
										}
									);
									if (!res.ok) {
										const error = await res.text();
										log.error('Timeout failed:', error);
										throw new Error(`Failed to timeout member: ${res.status}`);
									}
								},
							};
						},
						async ban(
							userId: any,
							options: { reason?: any; deleteMessageSeconds?: any } = {}
						) {
							const res = await fetch(
								`https://discord.com/api/v10/guilds/${guildId}/bans/${userId}`,
								{
									method: 'PUT',
									headers: {
										...headers,
										'X-Audit-Log-Reason': options.reason || '',
									},
									body: JSON.stringify({
										delete_message_seconds: options.deleteMessageSeconds || 0,
									}),
								}
							);
							if (!res.ok) {
								const error = await res.text();
								log.error('Ban failed:', error);
								throw new Error(`Failed to ban member: ${res.status}`);
							}
						},
					},
				};
			},
		},
	};
}
