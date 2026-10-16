import { json } from '@sveltejs/kit';
import { getEnv } from '$lib/env.js';
import { createDiscordRestClient } from '$lib/discord/rest-client.js';
import { sessionFromRequest } from '$lib/server/activity.js';
import { QuorumAccessError, quorumAct, quorumViewForViewer } from '$lib/server/activity-quorum.js';
import { log } from '$lib/log.js';

/**
 * The Quorum tab. `{ guild_id }` reads the open and settled questions the viewer
 * may see; `{ guild_id, action, ... }` votes or asks and answers with
 * `{ ok: true }` or `{ error }`. Authenticated by the signed session token from
 * /api/activity/session, not a cookie.
 */
export async function POST({ request, platform }) {
	const secret = getEnv('DISCORD_CLIENT_SECRET', platform);
	const db = (platform as any)?.env?.DB;
	if (!secret || !db) return json({ error: 'not_configured' }, { status: 503 });

	const claims = await sessionFromRequest(request, secret);
	if (!claims) return json({ error: 'bad_session', message: 'Sign in again.' }, { status: 401 });

	const token = getEnv('DISCORD_BOT_TOKEN', platform) ?? null;
	const deps = { db, discord: token ? createDiscordRestClient(token) : null, botToken: token };

	try {
		const body: any = await request.json().catch(() => ({}));
		const headers = { 'cache-control': 'no-store' };
		if (body?.action) {
			const out = await quorumAct(deps, claims, body.guild_id, body);
			return json(out, { status: 'error' in out ? 400 : 200, headers });
		}
		return json(await quorumViewForViewer(deps, claims, body?.guild_id), { headers });
	} catch (error: any) {
		if (error instanceof QuorumAccessError) {
			return json({ error: 'forbidden', message: error.message }, { status: error.status });
		}
		log.error('[Activity] quorum failed:', error);
		return json({ error: 'server_error' }, { status: 500 });
	}
}
