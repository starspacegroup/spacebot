/**
 * GET — what the gateway should forward to Shiritori: the Chain channels, and
 * the channels of running rounds with their turn deadline. The gateway polls it
 * every few seconds; it is one cheap read, and it doubles as the round clock.
 */
import { json } from '@sveltejs/kit';
import { listActive } from '$lib/server/shiritori-game.js';
import { botAuthorized } from '$lib/server/shiritori-api.js';

export async function GET({ request, platform }) {
	if (!botAuthorized(request, platform)) return json({ error: 'Unauthorized' }, { status: 401 });
	const db = (platform as any)?.env?.DB;
	if (!db) return json({ error: 'Database not available' }, { status: 500 });
	return json(await listActive(db));
}
