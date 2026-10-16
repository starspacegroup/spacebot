import { json } from '@sveltejs/kit';
import { getEnv } from '$lib/env.js';
import { createDiscordRestClient } from '$lib/discord/rest-client.js';
import { sessionFromRequest } from '$lib/server/activity.js';
import { GameAccessError, gameAct, gameViewForViewer } from '$lib/server/activity-game.js';
import { log } from '$lib/log.js';

/**
 * The Game tab. `{ guild_id }` reads the viewer's view of the round in their
 * voice channel; `{ guild_id, action, ... }` makes one move and answers with
 * `{ ok: true }` or `{ error }`. Authenticated by the signed session token from
 * /api/activity/session, not a cookie.
 */
export async function POST({ request, platform }) {
	const secret = getEnv('DISCORD_CLIENT_SECRET', platform);
	const db = (platform as any)?.env?.DB;
	if (!secret || !db) return json({ error: 'not_configured' }, { status: 503 });

	const claims = await sessionFromRequest(request, secret);
	if (!claims) return json({ error: 'bad_session', message: 'Sign in again.' }, { status: 401 });

	const token = getEnv('DISCORD_BOT_TOKEN', platform);
	const discord = token ? createDiscordRestClient(token) : null;

	try {
		const body: any = await request.json().catch(() => ({}));
		const headers = { 'cache-control': 'no-store' };
		if (body?.action) {
			const out = await gameAct(db, discord, claims, body.guild_id, body);
			return json(out, { status: 'error' in out ? 400 : 200, headers });
		}
		return json(await gameViewForViewer(db, discord, claims, body?.guild_id), { headers });
	} catch (error: any) {
		if (error instanceof GameAccessError) {
			return json({ error: 'forbidden', message: error.message }, { status: error.status });
		}
		log.error('[Activity] game failed:', error);
		return json({ error: 'server_error' }, { status: 500 });
	}
}
