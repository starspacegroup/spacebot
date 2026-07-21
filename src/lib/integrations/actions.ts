/**
 * Integration Actions
 *
 * Lets an external integration contribute *actions* into SpaceBot's shared
 * action system (the same one that powers custom commands and automations).
 * An integration declares actions in its manifest:
 *
 *   "actions": [
 *     {
 *       "key": "agapeverse.generate_poem",   // MUST be namespaced <slug>.<name>
 *       "name": "Generate Poem",
 *       "configSchema": { "theme": { "type": "text", "supportsOptionRef": true } },
 *       "returns": ["poem", "title"]
 *     }
 *   ],
 *   "webhooks": { "action_handler": "https://.../api/spacebot/action" }
 *
 * When a command/automation runs an action whose type is an integration action
 * key, SpaceBot POSTs the resolved config to the integration's `action_handler`
 * and feeds the returned fields back into the response template as {action.*}.
 *
 * This module deliberately does NOT import from ../automation/engine.js so the
 * engine can import it without a cycle.
 */

import { log } from '../log.js';
import { getEnabledGuildIntegrations } from '../db/integrations.js';

/** How long the integration's action handler has to respond. Mirrors the
 *  command_handler timeout in the interactions route. */
const ACTION_HANDLER_TIMEOUT_MS = 8000;

/**
 * A string is an integration action key if it is namespaced with a dot
 * (e.g. "agapeverse.generate_poem"). Built-in action types are ALL-CAPS with
 * no dot (e.g. "SEND_MESSAGE"), so this never collides with them.
 */
export function isIntegrationActionType(actionType) {
	return typeof actionType === 'string' && actionType.includes('.');
}

/**
 * Resolve a single action-config value against the triggering event.
 * Supports the same option-reference conventions the builder emits:
 *   - "option:<name>"                        → event.options[name]
 *   - { source: "option", option: "<name>" } → event.options[name]
 *   - { source: "static", value: X }         → X
 * Any other value is passed through literally.
 */
export function resolveConfigValue(value, event) {
	if (typeof value === 'string') {
		if (value.startsWith('option:')) {
			const name = value.slice(7);
			if (event?.options?.[name] !== undefined) return event.options[name];
			if (event?.[`option_${name}`] !== undefined) return event[`option_${name}`];
			return '';
		}
		return value;
	}
	if (value && typeof value === 'object') {
		if (value.source === 'option' && value.option) {
			return event?.options?.[value.option] ?? '';
		}
		if (value.source === 'static') return value.value;
	}
	return value;
}

/**
 * Resolve every entry in an action config against the event.
 */
export function resolveActionConfig(actionConfig, event) {
	const resolved = {};
	for (const [key, value] of Object.entries(actionConfig || {})) {
		resolved[key] = resolveConfigValue(value, event);
	}
	return resolved;
}

/**
 * Find the enabled integration in this guild that declares `actionKey`.
 * Returns { integration, manifest, action } or null.
 */
export async function findGuildActionProvider(db, guildId, actionKey) {
	const enabled = await getEnabledGuildIntegrations(db, guildId);
	for (const integration of enabled) {
		const manifest = integration.manifest || integration.manifest_json;
		const actions = Array.isArray(manifest?.actions) ? manifest.actions : [];
		const action = actions.find((a) => a?.key === actionKey);
		if (action) return { integration, manifest, action };
	}
	return null;
}

/**
 * Execute an integration-contributed action.
 *
 * Looks up the enabled integration that owns `actionType` for this guild,
 * resolves the config, and POSTs it to the integration's `action_handler`.
 * On success it mutates `context.action` so the response template can reference
 * the returned fields as {action.<field>}, and returns any direct
 * `content`/`embeds` the handler chose to send.
 *
 * @returns {Promise<{success: boolean, result?: object, response?: {content?: string, embeds?: any[], ephemeral?: boolean}|null, error?: string}>}
 */
export async function executeIntegrationAction({
	db,
	guildId,
	actionType,
	actionConfig,
	event,
	context,
}) {
	if (!db) return { success: false, error: 'Database not available' };
	if (!guildId) return { success: false, error: 'Missing guild' };

	let provider;
	try {
		provider = await findGuildActionProvider(db, guildId, actionType);
	} catch (err) {
		log.error(`[IntegrationAction] Lookup failed for ${actionType}:`, err);
		return { success: false, error: 'Integration lookup failed' };
	}

	if (!provider) {
		return {
			success: false,
			error: `Action "${actionType}" is not provided by an enabled integration in this server`,
		};
	}

	const { integration, manifest } = provider;
	const label = integration.name || integration.slug;

	if (integration.status !== 'online') {
		return { success: false, error: `The ${label} integration is currently offline` };
	}

	const handlerUrl = manifest?.webhooks?.action_handler;
	if (!handlerUrl) {
		return {
			success: false,
			error: `The ${label} integration has no action handler configured`,
		};
	}

	const config = resolveActionConfig(actionConfig, event);

	const payload = {
		type: 'action',
		action_key: actionType,
		config,
		guild_id: guildId,
		channel_id: event?.channel_id ?? null,
		user: event?.actor_id ? { id: event.actor_id, username: event.actor_name ?? null } : null,
		integration_slug: integration.slug,
	};

	let data;
	try {
		const res = await fetch(handlerUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-SpaceBot-Integration': integration.slug,
				'X-SpaceBot-Guild': String(guildId),
			},
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(ACTION_HANDLER_TIMEOUT_MS),
		});

		if (!res.ok) {
			log.warn(
				`[IntegrationAction] ${integration.slug} handler returned ${res.status} for ${actionType}`
			);
			return {
				success: false,
				error: `The ${label} integration failed to run "${actionType}"`,
			};
		}

		data = await res.json();
	} catch (err) {
		log.error(`[IntegrationAction] Error calling ${integration.slug} handler:`, err);
		return { success: false, error: `The ${label} integration is not responding` };
	}

	const result = data && typeof data.result === 'object' && data.result ? data.result : {};

	// Expose returned fields to response templates as {action.<field>}.
	if (context) {
		context.action = { ...(context.action || {}), ...result };
	}

	// A handler can control the reply directly with `content`/`embeds`, and set
	// `ephemeral` to choose whether the message is private to the invoking user
	// or posted to the channel. `ephemeral` is honored generically by the
	// interactions handler (see api/discord/interactions) — no per-integration
	// logic here.
	const response =
		data && (data.content !== undefined || Array.isArray(data.embeds))
			? {
					content: data.content,
					embeds: data.embeds,
					...(typeof data.ephemeral === 'boolean' ? { ephemeral: data.ephemeral } : {}),
				}
			: null;

	return { success: true, result, response };
}
