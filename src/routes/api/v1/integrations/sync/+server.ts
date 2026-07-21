/**
 * Integration Sync API
 *
 * POST /api/v1/integrations/sync
 *
 * Called by external projects to push their manifest to SpaceBot.
 * This tells SpaceBot what commands the integration provides, what webhook
 * URLs to call for command handling, and other metadata.
 *
 * After a successful sync, SpaceBot re-registers Discord commands for all
 * guilds that have this integration enabled.
 *
 * Auth: Bearer <integration_token> (sbi_...)
 */

import { json } from '@sveltejs/kit';
import { authenticateIntegration } from '$lib/integrations/auth.js';
import { updateIntegrationManifest, getGuildsWithIntegration } from '$lib/db/integrations.js';
import { syncGuildCommands } from '$lib/discord/commands.js';
import { log } from '$lib/db/logger.js';

/** @type {import('./$types').RequestHandler} */
export async function POST({ request, platform }) {
	// Authenticate the integration
	const auth = await authenticateIntegration(request, platform);
	if (!auth.authenticated) {
		return json({ error: auth.error }, { status: auth.status });
	}

	const db = (platform as any)?.env?.DB;
	if (!db) {
		return json({ error: 'Database not available' }, { status: 500 });
	}

	// Parse the manifest from the request body
	let manifest;
	try {
		manifest = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	// Validate required manifest fields
	if (!manifest.name || !manifest.slug) {
		return json({ error: "Manifest must include 'name' and 'slug' fields" }, { status: 400 });
	}

	// Ensure the manifest slug matches the authenticated integration
	if (manifest.slug !== auth.slug) {
		return json(
			{
				error: `Manifest slug '${manifest.slug}' does not match authenticated integration '${auth.slug}'`,
			},
			{ status: 403 }
		);
	}

	// Validate commands array if present
	if (manifest.commands && !Array.isArray(manifest.commands)) {
		return json({ error: "'commands' must be an array" }, { status: 400 });
	}

	// Validate webhooks if present
	if (manifest.webhooks && typeof manifest.webhooks !== 'object') {
		return json({ error: "'webhooks' must be an object" }, { status: 400 });
	}

	// Actions & events are contributed into SpaceBot's shared systems, so their
	// keys/types MUST be namespaced with the integration slug (e.g.
	// "agapeverse.generate_poem"). This prevents an integration from shadowing
	// built-in action/event types or another integration's keys.
	const namespacePrefix = `${auth.slug}.`;

	if (manifest.actions !== undefined) {
		if (!Array.isArray(manifest.actions)) {
			return json({ error: "'actions' must be an array" }, { status: 400 });
		}
		for (const action of manifest.actions) {
			if (!action?.key || typeof action.key !== 'string') {
				return json({ error: "Each action must have a string 'key'" }, { status: 400 });
			}
			if (!action.key.startsWith(namespacePrefix)) {
				return json(
					{
						error: `Action key '${action.key}' must be namespaced as '${namespacePrefix}<name>'`,
					},
					{ status: 400 }
				);
			}
		}
	}

	if (manifest.events !== undefined) {
		if (!Array.isArray(manifest.events)) {
			return json({ error: "'events' must be an array" }, { status: 400 });
		}
		for (const evt of manifest.events) {
			if (!evt?.type || typeof evt.type !== 'string') {
				return json({ error: "Each event must have a string 'type'" }, { status: 400 });
			}
			if (!evt.type.startsWith(namespacePrefix)) {
				return json(
					{
						error: `Event type '${evt.type}' must be namespaced as '${namespacePrefix}<name>'`,
					},
					{ status: 400 }
				);
			}
		}
	}

	if (manifest.command_templates !== undefined && !Array.isArray(manifest.command_templates)) {
		return json({ error: "'command_templates' must be an array" }, { status: 400 });
	}

	// Update the manifest in the database
	const result = await updateIntegrationManifest(db, auth.integrationId, manifest);
	if (!result.success) {
		return json({ error: result.error }, { status: 500 });
	}

	// Re-sync Discord commands for all guilds that have this integration enabled
	const syncResults = [];
	try {
		const guildIds = await getGuildsWithIntegration(db, auth.integrationId);

		if (guildIds.length > 0) {
			log.info(
				`[IntegrationSync] Re-syncing commands for ${guildIds.length} guild(s) after manifest update from ${auth.slug}`
			);

			// Sync in parallel, but cap concurrency
			const batchSize = 5;
			for (let i = 0; i < guildIds.length; i += batchSize) {
				const batch = guildIds.slice(i, i + batchSize);
				const results = await Promise.allSettled(
					batch.map((guildId) => syncGuildCommands(db, guildId, (platform as any).env))
				);

				for (let j = 0; j < results.length; j++) {
					const r = results[j];
					syncResults.push({
						guild_id: batch[j],
						success: r.status === 'fulfilled' && r.value?.success,
						registered: r.status === 'fulfilled' ? r.value?.registered : undefined,
						error: r.status === 'rejected' ? r.reason?.message : r.value?.error,
					});
				}
			}
		}
	} catch (err) {
		log.error('[IntegrationSync] Error syncing guild commands:', err);
	}

	log.info(`[IntegrationSync] Manifest synced for ${auth.slug}`);

	return json({
		success: true,
		integration: auth.slug,
		guilds_synced: syncResults.length,
		sync_results: syncResults,
	});
}
