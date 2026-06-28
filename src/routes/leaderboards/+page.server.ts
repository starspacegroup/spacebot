export async function load({ platform, url }) {
	const guildId = url.searchParams.get('guild') || '';
	const window = url.searchParams.get('window') || '30d';
	const db = (platform as any)?.env?.DB;
	let rows: any[] = [];

	if (db && guildId) {
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

	return { guildId, window, rows };
}
