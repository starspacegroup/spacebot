/**
 * External API v1 - Rotate an incoming webhook's secret
 *
 * POST /api/v1/webhooks/:id/rotate  (scope webhooks:write)
 * The old secret stops working at once. The new one is returned once, in this response only.
 */
import { json } from '@sveltejs/kit';
import { authenticateApiKey, hasScope } from '$lib/api-auth.js';
import { apiRotateWebhookSecret } from '$lib/server/inbound-webhook-actions.js';

/** @type {import('./$types').RequestHandler} */
export async function POST({ request, platform, params, url }) {
	const auth = await authenticateApiKey(request, platform);
	if (!auth.authenticated) return json({ error: auth.error }, { status: auth.status });
	if (!hasScope(auth, 'webhooks:write')) {
		return json({ error: 'Insufficient scope. Required: webhooks:write' }, { status: 403 });
	}
	const db = (platform as any)?.env?.DB;
	if (!db) return json({ error: 'Database not available' }, { status: 500 });
	const r = await apiRotateWebhookSecret(db, auth, url.origin, params.id, 'api');
	if (!r.ok) return json({ error: r.error }, { status: r.status });
	const { ok: _ok, ...rest } = r;
	return json({ success: true, ...rest });
}
