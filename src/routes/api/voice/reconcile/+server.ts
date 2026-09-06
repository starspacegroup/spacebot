import { json } from '@sveltejs/kit';
import { replaceLiveVoiceSnapshot } from '$lib/db/live-voice.js';
import { reconcileVoiceSessions } from '$lib/db/stats-aggregation.js';
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

	try {
		const body = await request.json();
		const guildId = body?.guild_id;
		const reason = body?.reason || 'unspecified';
		const activeSessions = Array.isArray(body?.active_sessions)
			? body.active_sessions
					.filter((session) => session?.user_id && session?.channel_id)
					.map((session) => ({
						user_id: String(session.user_id),
						channel_id: String(session.channel_id),
						channel_name: session.channel_name ? String(session.channel_name) : null,
						user_name: session.user_name ? String(session.user_name) : null,
						display_name: session.display_name ? String(session.display_name) : null,
						avatar_url: session.avatar_url ? String(session.avatar_url) : null,
						self_mute: Boolean(session.self_mute),
						self_deaf: Boolean(session.self_deaf),
						server_mute: Boolean(session.server_mute),
						server_deaf: Boolean(session.server_deaf),
						streaming: Boolean(session.streaming),
						self_video: Boolean(session.self_video),
						suppress: Boolean(session.suppress),
						is_bot: Boolean(session.is_bot),
					}))
			: [];

		if (!guildId) {
			return json({ error: 'guild_id is required' }, { status: 400 });
		}

		const [result, liveSnapshotResult] = await Promise.all([
			reconcileVoiceSessions(db, String(guildId), activeSessions),
			replaceLiveVoiceSnapshot(db, String(guildId), activeSessions),
		]);

		if (!liveSnapshotResult.success) {
			log.warn(
				`[VoiceSessions API] Failed to store live snapshot for guild ${guildId}: ${liveSnapshotResult.error}`
			);
		}

		if (
			result.closedSessions > 0 ||
			result.createdSessions > 0 ||
			result.duplicateSessionsClosed > 0
		) {
			log.info(
				`[VoiceSessions API] Reconciled guild ${guildId} (${reason}): closed=${result.closedSessions}, created=${result.createdSessions}, duplicates_closed=${result.duplicateSessionsClosed}`
			);
		}

		return json({ success: true, ...result, liveMembers: liveSnapshotResult.memberCount || 0 });
	} catch (error) {
		log.error('[VoiceSessions API] Reconciliation failed:', error);
		return json({ error: 'Invalid request body' }, { status: 400 });
	}
}
