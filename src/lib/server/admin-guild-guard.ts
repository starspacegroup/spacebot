/**
 * The access rule the admin stats APIs share: a signed-in server admin whose server has the
 * bot, or a superadmin. Returns the error response to send, or null when the caller may go on.
 */

import { json } from '@sveltejs/kit';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';
import { filterAdminGuilds, getBotGuildIds, getUserGuilds } from '$lib/discord/guilds.js';

export const STATS_PERIODS = new Set(['24h', '1d', '7d', '30d', '90d']);

export function statsPeriod(url: URL): string {
	const asked = url.searchParams.get('period') || '30d';
	return STATS_PERIODS.has(asked) ? asked : '30d';
}

export async function guardGuildAdmin(event: {
	params: Record<string, string>;
	cookies: any;
	platform: any;
}): Promise<Response | null> {
	const { params, cookies, platform } = event;
	const serverId = params.serverId;
	if (!/^\d{17,20}$/.test(serverId || '')) {
		return json({ error: 'Invalid server id' }, { status: 400 });
	}
	if (!platform?.env?.DB) return json({ error: 'Database not available' }, { status: 503 });

	const userId = cookies.get('discord_user_id');
	const accessToken = cookies.get('discord_access_token');
	if (!userId || !accessToken) return json({ error: 'Unauthorized' }, { status: 401 });

	if (!checkIsSuperAdmin(userId, platform)) {
		const botToken = platform?.env?.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;
		const [userGuilds, botGuildIds] = await Promise.all([
			getUserGuilds(accessToken, cookies),
			getBotGuildIds(botToken, cookies),
		]);
		const hasAccess =
			filterAdminGuilds(userGuilds).some((guild) => guild.id === serverId) &&
			botGuildIds.has(serverId);
		if (!hasAccess) return json({ error: 'Forbidden' }, { status: 403 });
	}
	return null;
}
