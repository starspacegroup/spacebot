import { json } from '@sveltejs/kit';
import { filterAdminGuilds, getBotGuildIds, getUserGuilds } from '$lib/discord/guilds.js';
import { getGuildTimezone } from '$lib/db/settings.js';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';
import {
	fetchStatsPageLiveData,
	getStatsCacheEntry,
	statsCacheKey,
} from '$lib/server/stats-page-data.js';

// Backs the per-server Statistics page's client-side hotload: see
// src/routes/admin/[serverId]/stats/+page.svelte for why this replaced
// goto(url, { invalidateAll: true }).

export async function GET({ params, cookies, platform, url }) {
	const { serverId } = params;

	if (!/^\d{17,20}$/.test(serverId || '')) {
		return json({ error: 'Invalid server id' }, { status: 400 });
	}

	const db = (platform as any)?.env?.DB;
	if (!db) {
		return json({ error: 'Database not available' }, { status: 503 });
	}

	const userId = cookies.get('discord_user_id');
	const accessToken = cookies.get('discord_access_token');

	if (!userId || !accessToken) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const botToken = (platform as any)?.env?.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;

	if (!checkIsSuperAdmin(userId, platform)) {
		const [userGuilds, botGuildIds] = await Promise.all([
			getUserGuilds(accessToken, cookies),
			getBotGuildIds(botToken, cookies),
		]);

		const adminGuilds = filterAdminGuilds(userGuilds);
		const hasAccess =
			adminGuilds.some((guild) => guild.id === serverId) && botGuildIds.has(serverId);

		if (!hasAccess) {
			return json({ error: 'Forbidden' }, { status: 403 });
		}
	}

	const selectedPeriod = url.searchParams.get('period') || '30d';
	const userTimezone = cookies.get('user_timezone') || null;
	const serverTimezone = await getGuildTimezone(db, serverId);
	const timezone = userTimezone || serverTimezone || null;

	const { cachedEntry, hasFreshCache } = getStatsCacheEntry(
		statsCacheKey(serverId, selectedPeriod, timezone)
	);
	if (hasFreshCache && cachedEntry?.data) {
		return json(cachedEntry.data, {
			headers: { 'cache-control': 'no-store' },
		});
	}

	const result = await fetchStatsPageLiveData(db, serverId, botToken, timezone, selectedPeriod);

	if (!result.success) {
		return json({ error: 'Failed to load statistics' }, { status: 502 });
	}

	return json(result.data, {
		headers: { 'cache-control': 'no-store' },
	});
}
