/**
 * External API v1 — one member's own figures.
 *
 * GET /api/v1/members/:userId?days=30
 *
 * Counts only, and only for the member asked about: messages, voice time,
 * commands, and where those put them among everyone else in the window. No
 * message text, no channel ids, no names, and never a word about who else is
 * ahead of them. `/api/v1/stats` is the whole-server view and needs no user id;
 * this is the one endpoint that answers about a person.
 *
 * **It is a separate scope on purpose.** `members:read` is not implied by
 * `stats:read`, because a key that may graph the member count has no business
 * reading what one named account did. An owner grants it deliberately, and a
 * key issued before this endpoint existed does not carry it.
 *
 * The caller is trusted to have established that the person asking owns the
 * account being asked about — this endpoint cannot verify that, so a key with
 * this scope can ask about any member. That is the trust being granted. The
 * intended shape is a site that got the Discord id from its own OAuth session
 * and never from a query parameter.
 *
 * A user who is not in the server answers `member: false` with empty counts.
 * That is a 200, not a 404: "not a member" is the answer, and a 404 would let
 * a caller probe ids for existence with a different status.
 *
 * Requires scope: members:read
 * Auth: Bearer <api_key>
 */

import { json } from '@sveltejs/kit';
import { authenticateApiKey, hasScope } from '$lib/api-auth.js';
import { getMemberActivity, normalizeWindowDays } from '$lib/db/member-activity.js';
import { log } from '$lib/db/logger.js';

/** Discord snowflakes are decimal digits. Anything else is not an id. */
const SNOWFLAKE = /^\d{5,32}$/;

const window = (value: {
	messages: number;
	channels: number;
	lastMessageAt: string | null;
	voiceSeconds: number;
	voiceSessions: number;
	voiceChannels: number;
	lastVoiceAt: string | null;
	commands: number;
}) => ({
	messages: value.messages,
	channels: value.channels,
	last_message_at: value.lastMessageAt,
	voice_seconds: value.voiceSeconds,
	voice_sessions: value.voiceSessions,
	voice_channels: value.voiceChannels,
	last_voice_at: value.lastVoiceAt,
	commands: value.commands,
});

/** @type {import('./$types').RequestHandler} */
export async function GET({ request, platform, params, url }) {
	const auth = await authenticateApiKey(request, platform);
	if (!auth.authenticated) {
		return json({ error: auth.error }, { status: auth.status });
	}

	if (!hasScope(auth, 'members:read')) {
		return json({ error: 'Insufficient scope. Required: members:read' }, { status: 403 });
	}

	const userId = String(params.userId || '');
	if (!SNOWFLAKE.test(userId)) {
		return json({ error: 'Invalid user id' }, { status: 400 });
	}

	const db = (platform as any)?.env?.DB;
	if (!db) {
		return json({ error: 'Database not available' }, { status: 503 });
	}

	try {
		const days = normalizeWindowDays(url.searchParams.get('days'));
		const activity = await getMemberActivity(db, auth.guildId, userId, days);

		return json(
			{
				guild_id: auth.guildId,
				user_id: userId,
				member: activity.member,
				joined_at: activity.joinedAt,
				bot: activity.bot,
				days: activity.days,
				retention_days: activity.retentionDays,
				unrecorded_channels: activity.unrecordedChannels,
				activity: window(activity.activity),
				recorded: window(activity.recorded),
				standing: {
					message_rank: activity.standing.messageRank,
					message_population: activity.standing.messagePopulation,
					voice_rank: activity.standing.voiceRank,
					voice_population: activity.standing.voicePopulation,
				},
			},
			// `private` and short: this is one person's data, so no shared cache
			// may hold it, and the caller is expected to key its own cache by the
			// session it already has.
			{ headers: { 'cache-control': 'private, max-age=60' } }
		);
	} catch (error) {
		log.error('[API v1] Error fetching member activity:', error);
		return json({ error: 'Failed to fetch member activity' }, { status: 500 });
	}
}
