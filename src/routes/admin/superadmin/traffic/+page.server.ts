import { redirect } from '@sveltejs/kit';
import { TABS, type Tab } from '$lib/traffic-tabs.js';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';
import {
	LISTING_SORT_KEYS,
	browserCounts,
	browserSeries,
	browserTotals,
	categoryTable,
	listingTable,
	type ListingSortKey,
} from '$lib/server/browser-stats.js';
import {
	dailySeries,
	dimension,
	funnel,
	hourlySeries,
	parseWindow,
	sinceDay,
	sum,
	topCountries,
	topPages,
	topReferrers,
	utcDay,
} from '$lib/server/site-traffic.js';

/**
 * Only the tab on screen is loaded. The three tabs read different tables, so opening the
 * page costs the queries of one tab, not all of them.
 */
/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform, url }) {
	const userId = cookies.get('discord_user_id');
	if (!checkIsSuperAdmin(userId, platform)) {
		throw redirect(302, '/admin');
	}

	const requested = url.searchParams.get('tab') as Tab;
	const tab: Tab = (TABS as readonly string[]).includes(requested) ? requested : 'overview';
	const db = (platform as any)?.env?.DB;
	const window = parseWindow(url.searchParams.get('window'));
	if (!db) return { tab, window, available: false as const };

	const since = sinceDay(window);
	// The window just before this one, the same length, for "up 12%" comparisons.
	const prevUntil = utcDay(new Date(Date.parse(`${since}T00:00:00Z`) - 86_400_000));
	const prevSince = sinceDay(window * 2);
	const base = { tab, window, available: true as const };

	if (tab === 'audience') {
		const [referrers, countries, os, browser, device, language] = await Promise.all([
			topReferrers(db, since),
			topCountries(db, since),
			dimension(db, 'os', since),
			dimension(db, 'browser', since),
			dimension(db, 'device', since),
			dimension(db, 'language', since),
		]);
		return { ...base, referrers, countries, audience: { os, browser, device, language } };
	}

	if (tab === 'browser') {
		const requestedSort = url.searchParams.get('sort') as ListingSortKey;
		const sort: ListingSortKey = (LISTING_SORT_KEYS as readonly string[]).includes(
			requestedSort
		)
			? requestedSort
			: 'joins';
		// A day is shown as days here: listing counters are daily, not hourly.
		const days = Math.max(window, 7);
		const [counts, totals, previous, series, listings, categories] = await Promise.all([
			browserCounts(db, since),
			browserTotals(db, since),
			browserTotals(db, prevSince, prevUntil),
			browserSeries(db, days),
			listingTable(db, since, sort),
			categoryTable(db, since),
		]);
		return {
			...base,
			sort,
			chartDays: days,
			counts,
			totals,
			previous,
			series,
			listings,
			categories,
		};
	}

	const hourly = window === 1;
	const [series, previousSeries, pages, steps] = await Promise.all([
		// One day is drawn as 24 hours: two day-bars would say nothing.
		hourly ? hourlySeries(db) : dailySeries(db, window),
		hourly ? Promise.resolve(null) : dailySeries(db, window * 2),
		topPages(db, since),
		funnel(db, since),
	]);
	// dailySeries(window*2) ends today, so its first half is the previous window.
	const previousTotal = previousSeries ? sum(previousSeries.slice(0, window)) : null;
	return {
		...base,
		hourly,
		series,
		total: sum(series),
		previousTotal,
		signedIn: series.reduce((n, b) => n + (b.signedIn ?? 0), 0),
		pages,
		funnel: steps,
	};
}
