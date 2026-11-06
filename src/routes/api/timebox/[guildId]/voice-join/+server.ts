/**
 * A member joined voice: lift any timebox deafen/mute that outlived their session.
 *
 * Discord refuses to change a server mute or deafen while the member is not in
 * voice, so a member who left before the timebox ended keeps it until they
 * come back. The gateway calls this on every join; with nothing held it is one
 * indexed read.
 */

import { json } from '@sveltejs/kit';
import { liftOnVoiceJoin } from '$lib/server/timebox.js';
import { createDiscordRestClient } from '$lib/discord/rest-client.js';

export async function POST({ request, params, platform }) {
	const botToken = (platform as any)?.env?.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;
	if (!botToken || request.headers.get('Authorization') !== `Bot ${botToken}`) {
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
	const userId = body?.user_id;
	if (!userId) return json({ error: 'user_id is required' }, { status: 400 });

	const lifted = await liftOnVoiceJoin(
		db,
		createDiscordRestClient(botToken),
		params.guildId,
		String(userId)
	);
	return json({ lifted });
}
