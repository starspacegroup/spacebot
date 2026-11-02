import { redirect } from '@sveltejs/kit';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';
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
} from '$lib/server/site-traffic.js';

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform, url }) {
	const userId = cookies.get('discord_user_id');
	if (!checkIsSuperAdmin(userId, platform)) {
		throw redirect(302, '/admin');
	}

	const db = (platform as any)?.env?.DB;
	const window = parseWindow(url.searchParams.get('window'));
	if (!db) return { window, available: false as const };

	const since = sinceDay(window);
	const [series, pages, referrers, countries, os, browser, device, language, steps] =
		await Promise.all([
			// One day is drawn as 24 hours: two day-bars would say nothing.
			window === 1 ? hourlySeries(db) : dailySeries(db, window),
			topPages(db, since),
			topReferrers(db, since),
			topCountries(db, since),
			dimension(db, 'os', since),
			dimension(db, 'browser', since),
			dimension(db, 'device', since),
			dimension(db, 'language', since),
			funnel(db, since),
		]);

	return {
		window,
		available: true as const,
		hourly: window === 1,
		series,
		total: sum(series),
		signedIn: series.reduce((n, b) => n + (b.signedIn ?? 0), 0),
		pages,
		referrers,
		countries,
		audience: { os, browser, device, language },
		funnel: steps,
	};
}
