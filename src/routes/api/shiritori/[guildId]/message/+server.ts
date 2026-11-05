/**
 * POST — a message the gateway saw in a channel Shiritori listens to. The game
 * reads it as a word, reacts and replies through the REST client, and returns
 * what it did (for the gateway's log).
 */
import { json } from '@sveltejs/kit';
import { handleMessage } from '$lib/server/shiritori-game.js';
import { botAuthorized, discordFor } from '$lib/server/shiritori-api.js';

export async function POST({ request, platform, params }) {
	if (!botAuthorized(request, platform)) return json({ error: 'Unauthorized' }, { status: 401 });
	const db = (platform as any)?.env?.DB;
	if (!db) return json({ error: 'Database not available' }, { status: 500 });

	const body = await request.json().catch(() => null);
	const { channelId, messageId, userId, userName, content, sentAt, addressed } = body ?? {};
	if (
		typeof channelId !== 'string' ||
		typeof messageId !== 'string' ||
		typeof userId !== 'string' ||
		typeof content !== 'string'
	) {
		return json({ error: 'Missing required fields' }, { status: 400 });
	}
	const outcome = await handleMessage(db, discordFor(platform), {
		guildId: params.guildId,
		channelId,
		messageId,
		userId,
		userName,
		content: content.slice(0, 200),
		addressed: addressed === true,
		sentAt: typeof sentAt === 'string' ? sentAt : undefined,
	});
	return json(outcome);
}
