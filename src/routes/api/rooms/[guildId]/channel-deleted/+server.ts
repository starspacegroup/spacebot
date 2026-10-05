/**
 * Close the ownership row for a room whose channel was deleted in Discord.
 *
 * Without this a hand-deleted room stays `active` forever: it counts against
 * its owner's cap, and the reaper retries a channel that no longer exists.
 */

import { json } from '@sveltejs/kit';
import { closeManagedChannel, getManagedChannel } from '$lib/db/managed-channels.js';
import { releaseUserCategory } from '$lib/automation/managed-channels.js';
import { createDiscordRestClient } from '$lib/discord/rest-client.js';

function checkIsBotRequest(request, platform) {
	const authHeader = request.headers.get('Authorization');
	const botToken = (platform as any)?.env?.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;
	return Boolean(botToken) && authHeader === `Bot ${botToken}`;
}

export async function POST({ request, params, platform }) {
	if (!checkIsBotRequest(request, platform)) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const db = (platform as any)?.env?.DB;
	if (!db) return json({ error: 'Database not available' }, { status: 503 });

	let body;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const channelId = body?.channel_id;
	if (!channelId) return json({ error: 'channel_id is required' }, { status: 400 });

	const room = await getManagedChannel(db, channelId);
	// Most deleted channels are not rooms at all.
	if (!room || String(room.guild_id) !== String(params.guildId)) {
		return json({ closed: false });
	}

	const result = await closeManagedChannel(db, channelId, 'channel_deleted');

	// A member's own category goes with their last room, however it closed.
	if (room.user_category_id) {
		const botToken = (platform as any)?.env?.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;
		await releaseUserCategory({
			db,
			discord: createDiscordRestClient(botToken),
			guildId: params.guildId,
			categoryId: room.user_category_id,
		});
	}
	return json({ closed: Boolean(result.closed) });
}
