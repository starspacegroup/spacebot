/**
 * External API v1 - One incoming webhook
 *
 * GET   /api/v1/webhooks/:id  (scope webhooks:read)   :id is the numeric id or the public id
 * PATCH /api/v1/webhooks/:id  { "enabled": boolean }  (scope webhooks:write)
 * Delete is dashboard-only. Reads never include a secret.
 */
import { json } from '@sveltejs/kit';
import { authenticateApiKey, hasScope } from '$lib/api-auth.js';
import { apiGetWebhook, apiSetWebhookEnabled } from '$lib/server/inbound-webhook-actions.js';

/** @type {import('./$types').RequestHandler} */
export async function GET({ request, platform, params, url }) {
	const auth = await authenticateApiKey(request, platform);
	if (!auth.authenticated) return json({ error: auth.error }, { status: auth.status });
	if (!hasScope(auth, 'webhooks:read')) {
		return json({ error: 'Insufficient scope. Required: webhooks:read' }, { status: 403 });
	}
	const db = (platform as any)?.env?.DB;
	if (!db) return json({ error: 'Database not available' }, { status: 500 });
	const r = await apiGetWebhook(db, auth, url.origin, params.id);
	if (!r.ok) return json({ error: r.error }, { status: r.status });
	return json({ success: true, webhook: r.webhook });
}

/** @type {import('./$types').RequestHandler} */
export async function PATCH({ request, platform, params, url }) {
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
	const r = await apiSetWebhookEnabled(db, auth, url.origin, params.id, body?.enabled, 'api');
	if (!r.ok) return json({ error: r.error }, { status: r.status });
	return json({ success: true, webhook: r.webhook });
}
