/**
 * Integration Events API
 *
 * POST /api/v1/integrations/events
 *
 * Called by an external integration to push a platform event into SpaceBot's
 * automation engine. The event's `type` must be declared in the integration's
 * manifest `events[]` and namespaced with the integration slug (e.g.
 * "agapeverse.poem_created").
 *
 * Platform-wide events route to the integration's designated **official guild**
 * only (`integrations.official_guild_id`). Automations in that guild whose
 * trigger matches the event type then fire.
 *
 * Auth: Bearer <integration_token> (sbi_...)
 */

import { json } from '@sveltejs/kit';
import { authenticateIntegration } from '$lib/integrations/auth.js';
import { getIntegrationById, getGuildsWithIntegration } from '$lib/db/integrations.js';
import { log, logEvent } from '$lib/db/logger.js';
import { processAutomations } from '$lib/automation/engine.js';
import { createDiscordRestClient } from '$lib/discord/rest-client.js';
import { getLatestServerStats } from '$lib/db/server-stats.js';
import { getGuildMetadata } from '$lib/db/guild-metadata.js';

function getEnv(platform: any, name: string) {
	return (
		platform?.env?.[name] ?? (typeof process !== 'undefined' ? process.env?.[name] : undefined)
	);
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ request, platform }) {
	const auth = await authenticateIntegration(request, platform);
	if (!auth.authenticated) {
		return json({ error: auth.error }, { status: auth.status });
	}

	const db = (platform as any)?.env?.DB;
	if (!db) {
		return json({ error: 'Database not available' }, { status: 500 });
	}

	let body: any;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const type = body?.type;
	if (!type || typeof type !== 'string') {
		return json({ error: "Event must include a string 'type'" }, { status: 400 });
	}

	// Type must be namespaced with the authenticated integration's slug.
	if (!type.startsWith(`${auth.slug}.`)) {
		return json(
			{ error: `Event type '${type}' must be namespaced as '${auth.slug}.<name>'` },
			{ status: 400 }
		);
	}

	const integration = await getIntegrationById(db, auth.integrationId);
	if (!integration) {
		return json({ error: 'Integration not found' }, { status: 404 });
	}

	// The event type must be declared in the manifest so it shows up in the
	// automation trigger picker; otherwise reject (prevents undeclared events).
	const manifest = integration.manifest || integration.manifest_json;
	const declared = Array.isArray(manifest?.events) ? manifest.events : [];
	if (!declared.some((e: any) => e?.type === type)) {
		return json(
			{ error: `Event type '${type}' is not declared in the integration manifest` },
			{ status: 400 }
		);
	}

	// Platform events route to the designated official guild only.
	const targetGuildId = integration.official_guild_id;
	if (!targetGuildId) {
		return json(
			{ error: 'This integration has no official guild configured to receive events' },
			{ status: 409 }
		);
	}

	// The integration must actually be enabled in the official guild.
	const enabledGuilds = await getGuildsWithIntegration(db, integration.id);
	if (!enabledGuilds.includes(targetGuildId)) {
		return json(
			{ error: 'The integration is not enabled in its official guild' },
			{ status: 409 }
		);
	}

	const event: any = {
		event_type: type,
		event_category: integration.slug,
		guild_id: targetGuildId,
		actor_id: body.actor?.id ?? null,
		actor_name: body.actor?.name ?? null,
		target_id: body.target?.id ?? null,
		target_name: body.target?.name ?? null,
		channel_id: body.channel_id ?? null,
		details: body.details && typeof body.details === 'object' ? body.details : {},
		summary: typeof body.summary === 'string' ? body.summary : null,
		integration_slug: integration.slug,
	};

	try {
		await logEvent(db, event);
	} catch (err: any) {
		log.warn(`[IntegrationEvents] Failed to log event: ${err.message}`);
	}

	let automationsTriggered = 0;
	try {
		const botToken = getEnv(platform, 'DISCORD_BOT_TOKEN');
		event._widget_signing_secret = getEnv(platform, 'DISCORD_PUBLIC_KEY');
		event._widget_origin =
			getEnv(platform, 'APP_URL') || getEnv(platform, 'API_BASE') || 'http://localhost:4269';
		const discord = botToken ? createDiscordRestClient(botToken) : null;
		const [guildMeta, guildStats] = await Promise.all([
			getGuildMetadata(db, targetGuildId).catch(() => null),
			getLatestServerStats(db, targetGuildId).catch(() => null),
		]);
		const guildInfo = {
			name: guildMeta?.name || 'Unknown Server',
			member_count: guildStats?.member_count ?? guildMeta?.approximate_member_count ?? null,
			human_count: guildStats?.human_count ?? null,
			bot_count: guildStats?.bot_count ?? null,
			boost_count: guildStats?.boost_count ?? guildMeta?.premium_subscription_count ?? null,
			boost_level: guildStats?.boost_level ?? guildMeta?.premium_tier ?? null,
		};
		const result = await processAutomations(event, db, discord, guildInfo, {});
		automationsTriggered = result?.executed ?? 0;
	} catch (err: any) {
		log.error(`[IntegrationEvents] Automation processing error: ${err.message}`);
	}

	log.info(`[IntegrationEvents] ${auth.slug} event ${type} → guild ${targetGuildId}`);

	return json({
		success: true,
		event_type: type,
		guild_id: targetGuildId,
		automations_triggered: automationsTriggered,
	});
}
