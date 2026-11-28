/**
 * External API v1 - Incoming webhooks
 *
 * GET  /api/v1/webhooks  - List this server's incoming webhooks (scope webhooks:read)
 * POST /api/v1/webhooks  - Create one: { "name": string, "description"?: string } (scope webhooks:write)
 *                          The secret is returned once, in this response only.
 * Auth: Bearer <api_key>. Reads never include a secret.
 */
import { json } from '@sveltejs/kit';
import { authenticateApiKey, hasScope } from '$lib/api-auth.js';
import { apiCreateWebhook, apiListWebhooks } from '$lib/server/inbound-webhook-actions.js';

/** @type {import('./$types').RequestHandler} */
export async function GET({ request, platform, url }) {
	const auth = await authenticateApiKey(request, platform);
	if (!auth.authenticated) return json({ error: auth.error }, { status: auth.status });
	if (!hasScope(auth, 'webhooks:read')) {
		return json({ error: 'Insufficient scope. Required: webhooks:read' }, { status: 403 });
	}
	const db = (platform as any)?.env?.DB;
	if (!db) return json({ error: 'Database not available' }, { status: 500 });
	return json({
		success: true,
		guild_id: auth.guildId,
		...(await apiListWebhooks(db, auth, url.origin)),
	});
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ request, platform, url }) {
	const auth = await authenticateApiKey(request, platform);
	if (!auth.authenticated) return json({ error: auth.error }, { status: auth.status });
	if (!hasScope(auth, 'webhooks:write')) {
		return json({ error: 'Insufficient scope. Required: webhooks:write' }, { status: 403 });
	}
	const db = (platform as any)?.env?.DB;
	if (!db) return json({ error: 'Database not available' }, { status: 500 });
	let body: any;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	const r = await apiCreateWebhook(
		db,
		auth,
		url.origin,
		body && typeof body === 'object' ? body : {},
		'api'
	);
	if (!r.ok) return json({ error: r.error }, { status: r.status });
	const { ok: _ok, ...rest } = r;
	return json({ success: true, ...rest }, { status: 201 });
}
