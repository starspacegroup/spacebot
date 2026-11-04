/**
 * POST — time out every Shiritori round whose turn is overdue. The gateway
 * calls it when the state poll shows a deadline has passed; the minute sweep
 * does the same if the gateway is down.
 */
import { json } from '@sveltejs/kit';
import { tickRounds } from '$lib/server/shiritori-game.js';
import { botAuthorized, discordFor } from '$lib/server/shiritori-api.js';

export async function POST({ request, platform }) {
	if (!botAuthorized(request, platform)) return json({ error: 'Unauthorized' }, { status: 401 });
	const db = (platform as any)?.env?.DB;
	if (!db) return json({ error: 'Database not available' }, { status: 500 });
	return json({ timedOut: await tickRounds(db, discordFor(platform)) });
}
