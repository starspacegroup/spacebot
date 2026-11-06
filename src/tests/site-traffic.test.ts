import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSqliteD1 } from './helpers/sqlite-d1.js';
import {
	MARKETING_ROUTES,
	browserBucket,
	dailySeries,
	deviceBucket,
	dimension,
	funnel,
	hourlySeries,
	languageBucket,
	normalizeCountry,
	osBucket,
	parseWindow,
	pruneSiteTraffic,
	recordPageView,
	recordSiteEvent,
	referrerHostFrom,
	shouldCount,
	sinceDay,
	topCountries,
	topPages,
	topReferrers,
} from '../lib/server/site-traffic.js';
import { siteTrafficHandle } from '../hooks.server.js';

const schema =
	readFileSync(new URL('../../migrations/0084_site_traffic.sql', import.meta.url), 'utf8') +
	readFileSync(new URL('../../migrations/0091_site_listing_daily.sql', import.meta.url), 'utf8');
const NOW = new Date('2026-11-02T15:30:00Z');

const view = (over: any = {}) => ({
	day: '2026-11-02',
	hour: 15,
	pathKey: '/',
	signedIn: false,
	referrerHost: undefined,
	country: 'US',
	os: 'Linux',
	browser: 'Firefox',
	device: 'desktop',
	language: 'en-US',
	...over,
});

describe('bucketing', () => {
	it('maps headers to a small closed vocabulary', () => {
		expect(osBucket('"Windows"', null)).toBe('Windows');
		expect(osBucket(null, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17)')).toBe('iOS');
		expect(osBucket('"Plan9"', null)).toBe('(other)');
		expect(osBucket(null, null)).toBe('(unknown)');
		expect(browserBucket('"Google Chrome";v="130", "Chromium";v="130"', null)).toBe('Chrome');
		expect(browserBucket(null, 'Mozilla/5.0 Firefox/130.0')).toBe('Firefox');
		expect(deviceBucket('?1', null)).toBe('mobile');
		expect(deviceBucket(null, 'Mozilla/5.0 (iPad)')).toBe('tablet');
		expect(languageBucket('pt-br,en;q=0.8')).toBe('pt-BR');
		expect(languageBucket('*')).toBe('(unknown)');
		expect(normalizeCountry('us')).toBe('(unknown)');
		expect(normalizeCountry('US')).toBe('US');
	});

	it('keeps only a host from a referrer, and drops our own', () => {
		expect(
			referrerHostFrom('https://Reddit.com/r/discordapp?x=1', 'spacebot.starspace.group')
		).toBe('reddit.com');
		expect(
			referrerHostFrom('https://spacebot.starspace.group/', 'spacebot.starspace.group')
		).toBeNull();
		expect(referrerHostFrom('nonsense', 'x')).toBeNull();
	});
});

describe('what is counted', () => {
	const base = {
		method: 'GET',
		status: 200,
		routeId: '/',
		contentType: 'text/html; charset=utf-8',
		userAgent: 'Mozilla/5.0 Firefox/130.0',
	};

	it('counts the public pages and nothing inside the product', () => {
		expect(shouldCount(base)).toBe(true);
		for (const id of [
			'/admin/[serverId]',
			'/activity',
			'/api/auth/discord',
			'/account',
			'/profile/[guildId]/[userId]',
			'/connect',
		]) {
			expect(MARKETING_ROUTES.has(id), id).toBe(false);
			expect(shouldCount({ ...base, routeId: id }), id).toBe(false);
		}
	});

	it('skips bots, non-HTML, non-GET and non-200', () => {
		expect(shouldCount({ ...base, userAgent: 'Googlebot/2.1' })).toBe(false);
		expect(shouldCount({ ...base, contentType: 'application/json' })).toBe(false);
		expect(shouldCount({ ...base, method: 'POST' })).toBe(false);
		expect(shouldCount({ ...base, status: 302 })).toBe(false);
		expect(shouldCount({ ...base, routeId: null })).toBe(false);
	});
});

describe('counters', () => {
	it('adds up views, referrers, countries and audience', async () => {
		const db = createSqliteD1(schema);
		await recordPageView(db, view());
		await recordPageView(
			db,
			view({ signedIn: true, referrerHost: 'reddit.com', country: 'CA' })
		);
		await recordPageView(db, view({ pathKey: '/invite', os: 'Windows' }));
		const since = '2026-11-01';
		expect(await topPages(db, since)).toEqual([
			{ label: '/', views: 2, signedIn: 1 },
			{ label: '/invite', views: 1, signedIn: 0 },
		]);
		expect(await topReferrers(db, since)).toEqual([
			{ label: '(direct)', views: 2 },
			{ label: 'reddit.com', views: 1 },
		]);
		expect((await topCountries(db, since))[0]).toEqual({ label: 'US', views: 2 });
		expect(await dimension(db, 'os', since)).toEqual([
			{ label: 'Linux', views: 2 },
			{ label: 'Windows', views: 1 },
		]);
	});

	it('gap-fills the daily and hourly series', async () => {
		const db = createSqliteD1(schema);
		await recordPageView(db, view({ day: '2026-10-31', hour: 3 }));
		await recordPageView(db, view());
		const daily = await dailySeries(db, 7, NOW);
		expect(daily).toHaveLength(7);
		expect(daily.map((d) => d.views)).toEqual([0, 0, 0, 0, 1, 0, 1]);
		const hourly = await hourlySeries(db, NOW);
		expect(hourly).toHaveLength(24);
		expect(hourly[hourly.length - 1]).toMatchObject({ label: '2026-11-02T15', views: 1 });
		expect(hourly.reduce((n, h) => n + h.views, 0)).toBe(1);
	});

	it('reads the funnel from page views and event counts', async () => {
		const db = createSqliteD1(schema);
		for (let i = 0; i < 4; i++) await recordPageView(db, view());
		await recordPageView(db, view({ pathKey: '/invite' }));
		await recordSiteEvent(db, 'install_start', NOW);
		await recordSiteEvent(db, 'install_start', NOW);
		await recordSiteEvent(db, 'install_done', NOW);
		expect(await funnel(db, '2026-11-01')).toEqual({
			visits: 4,
			invitePage: 1,
			loginStarts: 0,
			installStarts: 2,
			installs: 1,
		});
	});

	it('prunes only what is past retention', async () => {
		const db = createSqliteD1(schema);
		await recordPageView(db, view({ day: '2025-01-01' }));
		await recordPageView(db, view());
		await recordSiteEvent(db, 'login_start', new Date('2025-01-01T00:00:00Z'));
		await pruneSiteTraffic(db, NOW);
		const left: any = await db.prepare('SELECT COUNT(*) AS n FROM site_view_daily').first();
		expect(left.n).toBe(1);
		const ev: any = await db.prepare('SELECT COUNT(*) AS n FROM site_event_daily').first();
		expect(ev.n).toBe(0);
	});

	it('picks a known window and defaults to 30', () => {
		expect(parseWindow('7')).toBe(7);
		expect(parseWindow('1')).toBe(1);
		expect(parseWindow('365')).toBe(30);
		expect(parseWindow(null)).toBe(30);
		expect(sinceDay(1, NOW)).toBe('2026-11-02');
		expect(sinceDay(7, NOW)).toBe('2026-10-27');
	});
});

describe('siteTrafficHandle', () => {
	function run(opts: { routeId: string; ua?: string; status?: number; headers?: any }) {
		const db = createSqliteD1(schema);
		const waited: Promise<any>[] = [];
		const response = new Response('<html></html>', {
			status: opts.status ?? 200,
			headers: { 'content-type': 'text/html' },
		});
		const event: any = {
			request: new Request('https://spacebot.starspace.group/', {
				headers: {
					'user-agent': opts.ua ?? 'Mozilla/5.0 Firefox/130.0',
					'accept-language': 'en-US,en;q=0.9',
					referer: 'https://reddit.com/r/x',
					...opts.headers,
				},
			}),
			url: new URL('https://spacebot.starspace.group/'),
			route: { id: opts.routeId },
			cookies: { get: (n: string) => (n === 'sb_session' ? 'x' : undefined) },
			platform: {
				env: { DB: db },
				cf: { country: 'US' },
				context: { waitUntil: (p: any) => waited.push(p) },
			},
		};
		return {
			db,
			waited,
			go: () => siteTrafficHandle({ event, resolve: async () => response } as any),
		};
	}

	it('counts a marketing page view with the audience buckets and nothing else', async () => {
		const t = run({ routeId: '/' });
		await t.go();
		await Promise.all(t.waited);
		expect(await topPages(t.db, '2000-01-01')).toEqual([{ label: '/', views: 1, signedIn: 1 }]);
		expect(await topReferrers(t.db, '2000-01-01')).toEqual([{ label: 'reddit.com', views: 1 }]);
		expect(await dimension(t.db, 'language', '2000-01-01')).toEqual([
			{ label: 'en-US', views: 1 },
		]);
		// no table holds a raw UA, IP or URL
		const cols: any = await t.db
			.prepare(
				`SELECT group_concat(name) AS c FROM pragma_table_info('site_dimension_daily')`
			)
			.first();
		expect(cols.c).not.toMatch(/ip|agent|url/i);
	});

	it('leaves the dashboard, bots and failures uncounted', async () => {
		for (const o of [
			{ routeId: '/admin/[serverId]' },
			{ routeId: '/', ua: 'Googlebot/2.1' },
			{ routeId: '/', status: 404 },
		]) {
			const t = run(o);
			await t.go();
			await Promise.all(t.waited);
			expect(await topPages(t.db, '2000-01-01')).toEqual([]);
		}
	});

	it('never breaks the page when the counters fail', async () => {
		const t = run({ routeId: '/' });
		t.db.exec('DROP TABLE site_view_daily');
		const response = await t.go();
		await Promise.all(t.waited);
		expect(response.status).toBe(200);
	});
});
