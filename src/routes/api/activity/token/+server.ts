import { json } from '@sveltejs/kit';
import { getEnv } from '$lib/env.js';
import { ActivityError, exchangeCode } from '$lib/server/activity.js';
import { log } from '$lib/log.js';

/**
 * Activity sign-in, step 2: the page sends the SDK's authorization `code`, this
 * trades it for the viewer's access token (the client secret never leaves the
 * server). No cookie is involved — the Activity runs in a third-party iframe.
 */
export async function POST({ request, platform }) {
	const clientId = getEnv('DISCORD_CLIENT_ID', platform);
	const clientSecret = getEnv('DISCORD_CLIENT_SECRET', platform);
	if (!clientId || !clientSecret) {
		return json({ error: 'not_configured' }, { status: 503 });
	}
	try {
		const body: any = await request.json().catch(() => ({}));
		const accessToken = await exchangeCode(
			{ clientId, clientSecret, botToken: '' },
			body?.code
		);
		return json({ access_token: accessToken }, { headers: { 'cache-control': 'no-store' } });
	} catch (error: any) {
		if (error instanceof ActivityError) {
			return json({ error: error.code, message: error.message }, { status: error.status });
		}
		log.error('[Activity] token exchange failed:', error);
		return json({ error: 'server_error' }, { status: 500 });
	}
}
