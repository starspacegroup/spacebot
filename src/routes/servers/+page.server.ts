import {
	LISTING_CATEGORIES,
	LISTING_SORTS,
	PAGE_SIZE,
	browsePublicListings,
	getCategoryCounts,
	getListedGuildIds,
} from '$lib/db/server-listings.js';
import { getManageableGuilds } from '$lib/server/manageable-guilds.js';
import { countableRequest, recordBrowseUse, recordImpressions } from '$lib/server/browser-stats.js';

/**
 * Public server browser.
 *
 * Everything shown here comes from `browsePublicListings`, which only returns
 * guilds an admin explicitly opted in. No auth required.
 *
 * Deliberately sets no cache header: `hooks.server.ts` forces `no-store` on
 * every HTML response, and it should stay that way here — this page renders
 * inside the app shell, which contains the signed-in user's menu, so a shared
 * cache would serve one visitor's header to another.
 */
export async function load({ platform, url, cookies, request }) {
	const db = (platform as any)?.env?.DB;

	const q = (url.searchParams.get('q') || '').slice(0, 80);
	const requestedCategory = url.searchParams.get('category') || '';
	const category = LISTING_CATEGORIES.some((c) => c.value === requestedCategory)
		? requestedCategory
		: '';
	const requestedSort = url.searchParams.get('sort') || 'recent';
	const sort = (LISTING_SORTS as readonly string[]).includes(requestedSort)
		? requestedSort
		: 'recent';
	const page = Math.max(1, Math.min(200, Math.floor(Number(url.searchParams.get('page')) || 1)));
	const includeNsfw = url.searchParams.get('nsfw') === '1';

	const [result, categoryCounts] = await Promise.all([
		browsePublicListings(db, { q, category, sort, page, includeNsfw }),
		getCategoryCounts(db, includeNsfw),
	]);

	// Counters for the superadmin's Server browser stats: the cards shown, and whether a
	// category or a search was used (never the words). Off the request path, and a failure
	// costs nobody a page.
	if (db && countableRequest(request)) {
		const write = Promise.all([
			recordImpressions(
				db,
				result.listings.map((l: any) => l.guild_id)
			),
			recordBrowseUse(db, { category, searched: Boolean(q) }),
		]).catch(() => {});
		const ctx = (platform as any)?.context;
		if (ctx?.waitUntil) ctx.waitUntil(write);
		else await write;
	}

	return {
		...result,
		// Streamed: the page renders first, the manage button appears when Discord answers.
		manageable: getManageableGuilds(cookies, platform).then(async (guilds) => {
			const listed = await getListedGuildIds(
				db,
				guilds.map((guild) => guild.id)
			);
			// Live listings first, then the rest by name.
			return guilds
				.map((guild) => ({ ...guild, listed: listed.has(guild.id) }))
				.sort(
					(a, b) => Number(b.listed) - Number(a.listed) || a.name.localeCompare(b.name)
				);
		}),
		q,
		category,
		sort,
		includeNsfw,
		categories: LISTING_CATEGORIES,
		categoryCounts,
		pageSize: PAGE_SIZE,
	};
}
