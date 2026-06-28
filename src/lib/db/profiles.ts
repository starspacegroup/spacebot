export function deriveBadges(stats: Record<string, any> = {}) {
	const badges: string[] = [];
	if (Number(stats.command_count || 0) >= 100) badges.push('Command regular');
	if (Number(stats.voice_seconds || 0) >= 36000) badges.push('Voice regular');
	if (Number(stats.automation_count || 0) > 0) badges.push('Automation user');
	return badges;
}

export async function getUserProfile(db: any, guildId: string, userId: string) {
	const preference = db
		? await db
				.prepare(
					'SELECT * FROM user_profile_preferences WHERE guild_id = ? AND user_id = ?'
				)
				.bind(guildId, userId)
				.first()
		: null;
	const commandStats = db
		? await db
				.prepare(
					'SELECT COUNT(*) AS command_count FROM command_logs WHERE guild_id = ? AND user_id = ?'
				)
				.bind(guildId, userId)
				.first()
		: { command_count: 0 };
	const voiceStats = db
		? await db
				.prepare(
					'SELECT COALESCE(SUM(duration_seconds), 0) AS voice_seconds FROM voice_sessions WHERE guild_id = ? AND user_id = ?'
				)
				.bind(guildId, userId)
				.first()
		: { voice_seconds: 0 };

	const stats = {
		command_count: Number(commandStats?.command_count || 0),
		voice_seconds: Number(voiceStats?.voice_seconds || 0),
	};
	const publicProfile = Boolean(preference?.public_profile);

	return {
		user_id: userId,
		guild_id: guildId,
		display_name: preference?.display_name || `User ${userId.slice(-4)}`,
		bio: preference?.bio || '',
		public_profile: publicProfile,
		show_command_stats: preference ? Boolean(preference.show_command_stats) : true,
		show_voice_stats: preference ? Boolean(preference.show_voice_stats) : false,
		badges: deriveBadges(stats),
		stats: {
			command_count:
				publicProfile && preference?.show_command_stats ? stats.command_count : null,
			voice_seconds:
				publicProfile && preference?.show_voice_stats ? stats.voice_seconds : null,
		},
	};
}
