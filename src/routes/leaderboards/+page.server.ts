import { verifyGuildAdmin } from '$lib/discord/guilds.js';

export async function load({ platform, url, cookies }) {
	const guildId = url.searchParams.get('guild') || '';
	const window = url.searchParams.get('window') || '30d';
	const db = (platform as any)?.env?.DB;
	let rows: any[] = [];
	let authorized = false;

	// Privacy: voice leaderboards expose per-user activity for a guild. Only
	// serve them to an admin of that guild — otherwise any guild id could be
	// enumerated for member voice data (same IDOR class as the profile page).
	if (db && guildId) {
		const accessToken = cookies.get('discord_access_token');
		const auth = await verifyGuildAdmin(guildId, accessToken, cookies);
		authorized = Boolean(auth?.authorized);
	}

	if (db && guildId && authorized) {
		rows =
			(
				await db
					.prepare(
						`SELECT user_id, COALESCE(SUM(duration_seconds), 0) AS voice_seconds
					 FROM voice_sessions
					 WHERE guild_id = ?
					 GROUP BY user_id
					 ORDER BY voice_seconds DESC
					 LIMIT 25`
					)
					.bind(guildId)
					.all()
			).results || [];
	}

	return { guildId, window, rows, authorized };
}
