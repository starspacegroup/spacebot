import { json } from '@sveltejs/kit';
import { getEnv } from '$lib/env.js';
import { sessionFromRequest } from '$lib/server/activity.js';
import { TimeboxAccessError, timeboxesForViewer } from '$lib/server/activity-timebox.js';
import { log } from '$lib/log.js';

/**
 * The Timebox tab's data: the timeboxes this viewer is part of in one server.
 * Authenticated by the signed session token from /api/activity/session, not a
 * cookie. Read-only.
 */
export async function POST({ request, platform }) {
	const secret = getEnv('DISCORD_CLIENT_SECRET', platform);
	const db = (platform as any)?.env?.DB;
	if (!secret || !db) return json({ error: 'not_configured' }, { status: 503 });

	const claims = await sessionFromRequest(request, secret);
	if (!claims) return json({ error: 'bad_session', message: 'Sign in again.' }, { status: 401 });

	try {
		const body: any = await request.json().catch(() => ({}));
		const timeboxes = await timeboxesForViewer(db, claims, body?.guild_id);
		return json({ timeboxes }, { headers: { 'cache-control': 'no-store' } });
	} catch (error: any) {
		if (error instanceof TimeboxAccessError) {
			return json({ error: 'forbidden', message: error.message }, { status: error.status });
		}
		log.error('[Activity] timebox view failed:', error);
		return json({ error: 'server_error' }, { status: 500 });
	}
}
