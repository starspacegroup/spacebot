/**
 * External API v1 — who is in voice right now
 *
 * GET /api/v1/voice
 * GET /api/v1/voice?channel=Ten%20Forward
 * GET /api/v1/voice?channel=123456789012345678
 * GET /api/v1/voice?include_bots=true
 *
 * The same live snapshot the dashboard's voice panel draws, from
 * `live_voice_states` — the gateway rewrites it on every voice state change, so
 * this is current rather than polled from Discord on demand.
 *
 * `channel` filters to one channel, by id or by name (case-insensitive). A name
 * that matches nothing returns an empty `channels` array, not a 404: "nobody is
 * in there" and "that channel is empty right now" are the same answer to a
 * caller drawing a panel, and a 404 would make a quiet evening look like a
 * broken integration.
 *
 * Bots are excluded by default. A music bot sitting in a channel is not company,
 * and a caller drawing faces on a page does not want one. Pass
 * `include_bots=true` for the raw occupancy.
 *
 * Requires scope: voice:read
 * Auth: Bearer <api_key>
 */

import { json } from '@sveltejs/kit';
import { authenticateApiKey, hasScope } from '$lib/api-auth.js';
import { getLiveVoiceChannels } from '$lib/db/live-voice.js';
import { log } from '$lib/db/logger.js';

/** Discord snowflakes are 17-20 digits; anything else is treated as a name. */
const SNOWFLAKE = /^\d{17,20}$/;

/** @type {import('./$types').RequestHandler} */
export async function GET({ request, platform, url }) {
	const auth = await authenticateApiKey(request, platform);
	if (!auth.authenticated) {
		return json({ error: auth.error }, { status: auth.status });
	}

	if (!hasScope(auth, 'voice:read')) {
		return json({ error: 'Insufficient scope. Required: voice:read' }, { status: 403 });
	}

	const db = (platform as any)?.env?.DB;
	if (!db) {
		return json({ error: 'Database not available' }, { status: 500 });
	}

	const channelQuery = (url.searchParams.get('channel') || '').trim();
	const includeBots = url.searchParams.get('include_bots') === 'true';

	try {
		const snapshot = await getLiveVoiceChannels(db, auth.guildId);

		let channels = snapshot.channels || [];

		if (!includeBots) {
			channels = channels
				.map((channel) => {
					const members = (channel.members || []).filter((member) => !member.isBot);
					return { ...channel, members, memberCount: members.length };
				})
				// A channel holding nothing but bots is an empty channel.
				.filter((channel) => channel.memberCount > 0);
		}

		if (channelQuery) {
			const wanted = channelQuery.toLowerCase();
			channels = channels.filter((channel) =>
				SNOWFLAKE.test(channelQuery)
					? String(channel.channelId) === channelQuery
					: String(channel.channelName || '').toLowerCase() === wanted
			);
		}

		const totalUsers = channels.reduce((sum, channel) => sum + channel.memberCount, 0);

		return json({
			guild_id: auth.guildId,
			channels,
			totalChannels: channels.length,
			totalUsers,
			updatedAt: snapshot.updatedAt,
		});
	} catch (error) {
		log.error('[API v1] Voice snapshot failed:', error);
		return json({ error: 'Failed to read voice state' }, { status: 500 });
	}
}
