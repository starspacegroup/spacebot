import { json } from '@sveltejs/kit';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';
import { filterAdminGuilds, getBotGuildIds, getUserGuilds } from '$lib/discord/guilds.js';
import { getTopVoiceUsers } from '$lib/db/statistics.js';

const PERIODS = new Set(['24h', '1d', '7d', '30d', '90d']);
/** More than any server has in a month; the roster is the whole list, not a top ten. */
const MAX_MEMBERS = 500;

/** Everyone who spent time in voice during the range, most time first. */
export async function GET({ params, cookies, platform, url }) {
	const { serverId } = params;
	if (!/^\d{17,20}$/.test(serverId || '')) {
		return json({ error: 'Invalid server id' }, { status: 400 });
	}

	const db = (platform as any)?.env?.DB;
	if (!db) return json({ error: 'Database not available' }, { status: 503 });

	const userId = cookies.get('discord_user_id');
	const accessToken = cookies.get('discord_access_token');
	if (!userId || !accessToken) return json({ error: 'Unauthorized' }, { status: 401 });

	if (!checkIsSuperAdmin(userId, platform)) {
		const botToken = (platform as any)?.env?.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;
		const [userGuilds, botGuildIds] = await Promise.all([
			getUserGuilds(accessToken, cookies),
			getBotGuildIds(botToken, cookies),
		]);
		const hasAccess =
			filterAdminGuilds(userGuilds).some((guild) => guild.id === serverId) &&
			botGuildIds.has(serverId);
		if (!hasAccess) return json({ error: 'Forbidden' }, { status: 403 });
	}

	const asked = url.searchParams.get('period') || '30d';
	const period = PERIODS.has(asked) ? asked : '30d';
	const rows = await getTopVoiceUsers(db, serverId, MAX_MEMBERS, period);

	return json(
		{
			period,
			members: rows.map((r: any) => ({
				id: String(r.actor_id),
				name: r.actor_name,
				avatar: r.actor_avatar ?? null,
				discriminator: r.actor_discriminator ?? '0',
				bot: Boolean(r.actor_is_bot),
				seconds: Number(r.total_seconds) || 0,
				last_active: r.last_active ?? null,
			})),
		},
		{ headers: { 'cache-control': 'no-store' } }
	);
}
