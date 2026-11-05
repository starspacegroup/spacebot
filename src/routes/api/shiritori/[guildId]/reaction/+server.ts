/**
 * POST — someone reacted ❓ in a channel Shiritori listens to. If the message carries a word the
 * game accepted, the bot replies with its definition. The gateway has already checked the
 * emoji and the channel; this checks the rest.
 */
import { json } from '@sveltejs/kit';
import { handleDefineReaction } from '$lib/server/shiritori-game.js';
import { botAuthorized, discordFor } from '$lib/server/shiritori-api.js';

export async function POST({ request, platform, params }) {
	if (!botAuthorized(request, platform)) return json({ error: 'Unauthorized' }, { status: 401 });
	const db = (platform as any)?.env?.DB;
	if (!db) return json({ error: 'Database not available' }, { status: 500 });

	const body = await request.json().catch(() => null);
	const { channelId, messageId, userId } = body ?? {};
	if (
		typeof channelId !== 'string' ||
		typeof messageId !== 'string' ||
		typeof userId !== 'string'
	) {
		return json({ error: 'Missing required fields' }, { status: 400 });
	}
	const outcome = await handleDefineReaction(db, discordFor(platform), {
		guildId: params.guildId,
		channelId,
		messageId,
		userId,
	});
	return json(outcome);
}
