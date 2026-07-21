/**
 * Superadmin: register an integration by URL
 *
 * POST /api/integrations/register — { url, isOfficial? }
 *   Point SpaceBot at a public service (e.g. https://agapeverse.app). SpaceBot
 *   fetches its discovery manifest (`{origin}/spacebot-integration.json`, or a
 *   full …/x.json URL), validates the protocol surfaces it declares, creates the
 *   catalog record, probes its health endpoint, and — for a brand-new
 *   integration — issues an integration token to hand to the service.
 *
 *   The public manifest bootstraps metadata; the service then keeps it current
 *   (and provides secret-bearing webhook URLs) via the authenticated Sync API.
 *
 * Superadmin only (checked via ADMIN_USER_IDS).
 */

import { json } from '@sveltejs/kit';
import { log } from '$lib/db/logger.js';
import {
	getIntegrationBySlug,
	upsertIntegration,
	createIntegrationToken,
} from '$lib/db/integrations.js';
import {
	fetchRemoteManifest,
	resolveManifestUrl,
	validateManifest,
} from '$lib/integrations/registry.js';

function isSuperAdmin(cookies: any, platform: any) {
	const userId = cookies.get('discord_user_id');
	if (!userId) return false;
	const adminUserIds =
		(platform as any)?.env?.ADMIN_USER_IDS ||
		(typeof process !== 'undefined' ? process.env?.ADMIN_USER_IDS : '') ||
		'';
	return adminUserIds
		.split(',')
		.map((id: string) => id.trim())
		.filter(Boolean)
		.includes(userId);
}

/** Best-effort probe of the integration's declared health endpoint. */
async function probeHealth(healthUrl: string | undefined) {
	if (!healthUrl) return { checked: false };
	try {
		const res = await fetch(healthUrl, {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(5000),
		});
		return { checked: true, ok: res.ok, status: res.status };
	} catch (err: any) {
		return { checked: true, ok: false, error: err?.message || 'unreachable' };
	}
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ request, cookies, platform }) {
	if (!isSuperAdmin(cookies, platform)) {
		return json({ error: 'Unauthorized' }, { status: 403 });
	}

	const db = (platform as any)?.env?.DB;
	if (!db) {
		return json({ error: 'Database not available' }, { status: 500 });
	}

	let body: any;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const manifestUrl = resolveManifestUrl(body?.url);
	if (!manifestUrl) {
		return json(
			{ error: 'Enter a valid http(s) service URL (e.g. https://agapeverse.app)' },
			{ status: 400 }
		);
	}

	// Fetch the public discovery manifest.
	const manifest = await fetchRemoteManifest(manifestUrl);
	if (!manifest) {
		return json(
			{ error: `Could not fetch or parse a manifest at ${manifestUrl}` },
			{ status: 502 }
		);
	}

	// Validate structure + namespacing before trusting it into the catalog.
	const validation = validateManifest(manifest);
	if (!validation.ok) {
		return json({ error: `Invalid manifest: ${validation.error}` }, { status: 400 });
	}

	const health = await probeHealth(manifest.health_endpoint);

	const existing = await getIntegrationBySlug(db, manifest.slug);

	const upsert = await upsertIntegration(db, {
		slug: manifest.slug,
		name: manifest.name,
		description: manifest.description || null,
		icon: manifest.icon || null,
		author: manifest.author || null,
		version: manifest.version || '1.0.0',
		category: manifest.category || 'general',
		manifest_url: manifestUrl,
		manifest_json: manifest,
		is_official: !!body?.isOfficial,
	});
	if (!upsert.success) {
		return json({ error: upsert.error || 'Failed to save integration' }, { status: 500 });
	}

	const integrationId = upsert.id;
	const surfaces = {
		commands: Array.isArray(manifest.commands) ? manifest.commands.length : 0,
		actions: Array.isArray(manifest.actions) ? manifest.actions.length : 0,
		events: Array.isArray(manifest.events) ? manifest.events.length : 0,
		command_templates: Array.isArray(manifest.command_templates)
			? manifest.command_templates.length
			: 0,
	};

	// Issue a token only for a brand-new integration; re-registering an existing
	// one refreshes its manifest without disturbing its token.
	let token: string | undefined;
	if (!existing && integrationId) {
		const tok = await createIntegrationToken(db, integrationId, manifest.slug);
		if (tok.success) token = tok.token;
	}

	log.info(
		`[Superadmin] ${existing ? 'Refreshed' : 'Registered'} integration ${manifest.slug} from ${manifestUrl}`
	);

	return json({
		success: true,
		created: !existing,
		integration: {
			id: integrationId,
			slug: manifest.slug,
			name: manifest.name,
			manifest_url: manifestUrl,
		},
		surfaces,
		health,
		token, // present only on first registration — shown once
	});
}
