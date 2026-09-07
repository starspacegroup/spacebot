/**
 * POST /api/channels/sync — the gateway hands over a guild's public channels.
 *
 * Bot-token authenticated, like `/api/voice/reconcile`: the gateway is a
 * separate long-running process and cannot reach D1 itself, so it posts what it
 * sees and this route stores it.
 *
 * Two filters make the stored directory safe to serve publicly, and they live
 * in different places for the same reason — each belongs where its data is:
 *
 * - **Private channels** are dropped by the gateway, which is where the
 *   permission overwrites are. A channel `@everyone` cannot view is never sent.
 * - **Member rooms** are dropped here, which is where `managed_channels` is.
 *   A room somebody made with `/room` is public in Discord's eyes but is not
 *   part of the server's directory, and listing it on a website would publish
 *   who is sitting in what.
 */

import { json } from '@sveltejs/kit';
import { replaceGuildChannels } from '$lib/db/guild-channels.js';
import { listActiveManagedChannels } from '$lib/db/managed-channels.js';
import { log } from '$lib/log.js';

function checkIsBotRequest(request, platform) {
	const authHeader = request.headers.get('Authorization');
	const botToken = platform?.env?.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;
	return Boolean(botToken) && authHeader === `Bot ${botToken}`;
}

export async function POST({ request, platform }) {
	if (!checkIsBotRequest(request, platform)) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const db = (platform as any)?.env?.DB;
	if (!db) {
		return json({ error: 'Database not available' }, { status: 503 });
	}

	let body;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const guildId = body?.guild_id ? String(body.guild_id) : '';
	if (!guildId) {
		return json({ error: 'guild_id is required' }, { status: 400 });
	}

	// An absent `channels` key is a malformed post, not an empty guild. An
	// explicit empty array is the latter and is allowed to clear the table.
	if (!Array.isArray(body?.channels)) {
		return json({ error: 'channels must be an array' }, { status: 400 });
	}

	// A room a member created with `/room` is not part of the directory.
	const managed = await listActiveManagedChannels(db, guildId);
	const managedIds = new Set(managed.map((room) => String(room.channel_id)));
	const channels = body.channels.filter(
		(channel) => !managedIds.has(String(channel?.channel_id ?? ''))
	);

	const result = await replaceGuildChannels(db, guildId, channels);
	if (!result.success) {
		log.warn(`[Channels API] Failed to store directory for guild ${guildId}: ${result.error}`);
		return json({ error: 'Failed to store channels' }, { status: 500 });
	}

	log.info(
		`[Channels API] Stored ${result.stored} public channel(s) for guild ${guildId} (${body?.reason || 'unspecified'})`
	);
	return json({ success: true, stored: result.stored });
}
