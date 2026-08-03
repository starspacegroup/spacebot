import {
	LISTING_CATEGORIES,
	LISTING_SORTS,
	PAGE_SIZE,
	browsePublicListings,
	getCategoryCounts,
} from '$lib/db/server-listings.js';

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
export async function load({ platform, url }) {
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

	return {
		...result,
		q,
		category,
		sort,
		includeNsfw,
		categories: LISTING_CATEGORIES,
		categoryCounts,
		pageSize: PAGE_SIZE,
	};
}
