/**
 * Integration Registry
 *
 * Maintains the catalog of known integrations and seeds them into the DB.
 * Each integration declares a manifest that tells SpaceBot what commands,
 * webhooks, and configuration the integration needs.
 *
 * Third-party integrations can also publish a `spacebot-integration.json`
 * at a remote URL that SpaceBot can fetch and register.
 */

import { log } from '../log.js';
import { upsertIntegration } from '../db/integrations.js';

// ---------------------------------------------------------------------------
// Manifest schema (what an integration declares)
// ---------------------------------------------------------------------------
//
// {
//   "name": "My Integration",
//   "slug": "my-integration",
//   "version": "1.0.0",
//   "description": "Short description",
//   "author": "Author Name",
//   "icon": "🎮",                          // emoji or URL
//   "category": "gaming" | "ai" | "moderation" | "utility" | "general",
//   "homepage": "https://...",
//   "manifest_url": "https://...spacebot-integration.json",
//
//   "commands": [
//     {
//       "name": "play",
//       "description": "Start a game",
//       "type": 1,                           // CHAT_INPUT
//       "options": [ ... ]                    // Discord command options
//     }
//   ],
//
//   "webhooks": {
//     "on_enable":  "https://game.example.com/api/spacebot/on-enable",
//     "on_disable": "https://game.example.com/api/spacebot/on-disable",
//     "command_handler": "https://game.example.com/api/spacebot/command"
//   },
//
//   "config_schema": [
//     { "key": "api_key",  "label": "Game API Key",  "type": "string", "required": false },
//     { "key": "channel",  "label": "Game Channel",  "type": "channel", "required": false }
//   ]
// }
//
// ---------------------------------------------------------------------------

/**
 * Built-in integrations that ship with SpaceBot.
 * These are always available in the catalog.
 */
export const BUILT_IN_INTEGRATIONS = [
	{
		slug: 'starspace-game',
		name: '*Space Game',
		description:
			'Connect the *Space multiplayer game to your Discord server. Adds commands for checking player stats, leaderboards, and linking Discord accounts to game profiles.',
		icon: '🎮',
		author: '*Space',
		version: '1.0.0',
		category: 'gaming',
		is_official: true,
		manifest_url:
			'https://raw.githubusercontent.com/starspacegroup/game/main/spacebot-integration.json',
		manifest_json: {
			name: '*Space Game',
			slug: 'starspace-game',
			version: '1.0.0',
			description: 'Connect the *Space multiplayer game to your Discord server.',
			author: '*Space',
			author_url: 'https://starspace.group',
			icon: '🎮',
			category: 'gaming',
			homepage: 'https://game.starspace.group/',

			// Commands, webhooks, and health_endpoint are provided by the Game
			// project via the sync API when it starts up. The seed only contains
			// metadata so SpaceBot knows the integration exists in the catalog.
			// The Game project pushes the real manifest (with commands & webhooks)
			// when it connects.
			commands: [],
			webhooks: {},
			config_schema: [],
		},
	},
	{
		slug: 'github',
		name: 'GitHub',
		description:
			'Receive GitHub repository events in your Discord server. Get notified about pushes, pull requests, issues, releases, and more — and trigger automations based on GitHub activity.',
		icon: '🐙',
		author: '*Space',
		version: '1.0.0',
		category: 'utility',
		is_official: true,
		manifest_json: {
			name: 'GitHub',
			slug: 'github',
			version: '1.0.0',
			description:
				'Receive GitHub repository events and trigger automations from GitHub activity.',
			author: '*Space',
			author_url: 'https://starspace.group',
			icon: '🐙',
			category: 'utility',

			// GitHub integration is built-in — it receives webhooks directly
			// from GitHub rather than using an external command handler.
			// No Discord slash commands; events flow into the automation engine.
			commands: [],
			webhooks: {},
			config_schema: [
				{
					key: 'webhook_secret',
					label: 'Webhook Secret',
					type: 'string',
					required: false,
					description:
						'A secret to verify incoming GitHub webhooks (auto-generated if empty)',
				},
			],
		},
	},
];

/**
 * Seed the built-in integrations into the database.
 * Safe to call multiple times — uses upsert.
 * Built-in integrations that don't use external heartbeats are marked
 * as connected immediately so they appear in the guild integrations list.
 */
export async function seedBuiltInIntegrations(db) {
	if (!db) {
		log.warn('[IntegrationRegistry] No database, skipping seed');
		return;
	}

	for (const integration of BUILT_IN_INTEGRATIONS) {
		const result = await upsertIntegration(db, integration);
		if (result.success) {
			log.debug(`[IntegrationRegistry] Seeded integration: ${integration.slug}`);

			// Mark built-in integrations without a manifest_url as connected,
			// since they receive events directly (e.g. GitHub webhooks).
			if (!integration.manifest_url && result.id) {
				try {
					await db
						.prepare(
							"UPDATE integrations SET connected_at = COALESCE(connected_at, ?), status = 'online' WHERE id = ?"
						)
						.bind(new Date().toISOString(), result.id)
						.run();
				} catch (err) {
					log.debug(
						`[IntegrationRegistry] Could not set connected_at for ${integration.slug}: ${err.message}`
					);
				}
			}
		} else {
			log.error(`[IntegrationRegistry] Failed to seed ${integration.slug}:`, result.error);
		}
	}
}

/**
 * Fetch a remote integration manifest from a URL.
 * Returns the parsed manifest or null on failure.
 */
export async function fetchRemoteManifest(url) {
	try {
		const response = await fetch(url, {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(10_000),
		});

		if (!response.ok) {
			log.warn(
				`[IntegrationRegistry] Failed to fetch manifest from ${url}: ${response.status}`
			);
			return null;
		}

		const manifest = await response.json();

		// Basic validation
		if (!manifest.slug || !manifest.name) {
			log.warn(`[IntegrationRegistry] Invalid manifest from ${url}: missing slug or name`);
			return null;
		}

		return manifest;
	} catch (error) {
		log.error(`[IntegrationRegistry] Error fetching manifest from ${url}:`, error);
		return null;
	}
}

/**
 * Whether an integration authenticates as an external service using
 * SpaceBot-issued integration tokens.
 */
export function usesIntegrationTokenAuth(integration) {
	const manifest = integration?.manifest || integration?.manifest_json;
	return Boolean(integration?.manifest_url || manifest?.webhooks?.command_handler);
}

/**
 * Given an integration's manifest, return the Discord command payloads
 * that should be registered when the integration is enabled for a guild.
 */
export function getIntegrationCommands(integration) {
	const manifest = integration.manifest || integration.manifest_json;
	if (!manifest?.commands || !Array.isArray(manifest.commands)) return [];
	return manifest.commands;
}

/**
 * Given an integration's manifest, return the actions it contributes to
 * SpaceBot's shared action system (used by the command & automation builders).
 * Each action declares a namespaced `key` (e.g. "agapeverse.generate_poem").
 */
export function getIntegrationActions(integration) {
	const manifest = integration.manifest || integration.manifest_json;
	if (!manifest?.actions || !Array.isArray(manifest.actions)) return [];
	return manifest.actions;
}

/**
 * Given an integration's manifest, return the custom event types it declares.
 * Each event has a namespaced `type` (e.g. "agapeverse.poem_created") and shows
 * up in the automation trigger picker for guilds that enabled the integration.
 */
export function getIntegrationEvents(integration) {
	const manifest = integration.manifest || integration.manifest_json;
	if (!manifest?.events || !Array.isArray(manifest.events)) return [];
	return manifest.events;
}

/**
 * Given an integration's manifest, return the one-click command templates it
 * ships. Each template is a full command definition an admin can clone into
 * their own commands and then modify.
 */
export function getIntegrationCommandTemplates(integration) {
	const manifest = integration.manifest || integration.manifest_json;
	if (!manifest?.command_templates || !Array.isArray(manifest.command_templates)) return [];
	return manifest.command_templates;
}
