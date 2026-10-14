import { json } from '@sveltejs/kit';
import { getEnv } from '$lib/env.js';
import { ActivityError, createActivitySession } from '$lib/server/activity.js';
import { log } from '$lib/log.js';

/**
 * Activity sign-in, step 3: verify who the viewer is and where the Activity was
 * opened (asking Discord, not the page), and return a short-lived signed token
 * plus the servers and modules this viewer may use. The page calls this again
 * to refresh before the token expires, and when the people in the instance change.
 */
export async function POST({ request, platform }) {
	const clientId = getEnv('DISCORD_CLIENT_ID', platform);
	const clientSecret = getEnv('DISCORD_CLIENT_SECRET', platform);
	const botToken = getEnv('DISCORD_BOT_TOKEN', platform);
	const db = platform?.env?.DB;
	if (!clientId || !clientSecret || !botToken || !db) {
		return json({ error: 'not_configured' }, { status: 503 });
	}
	try {
		const body: any = await request.json().catch(() => ({}));
		const session = await createActivitySession({ clientId, clientSecret, botToken }, db, {
			accessToken: body?.access_token,
			instanceId: body?.instance_id,
		});
		return json(session, { headers: { 'cache-control': 'no-store' } });
	} catch (error: any) {
		if (error instanceof ActivityError) {
			return json({ error: error.code, message: error.message }, { status: error.status });
		}
		log.error('[Activity] session failed:', error);
		return json({ error: 'server_error' }, { status: 500 });
	}
}
