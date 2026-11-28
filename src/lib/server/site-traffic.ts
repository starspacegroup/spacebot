/**
 * First-party traffic counters for SpaceBot's public marketing pages.
 *
 * Ported from NebulaKit's page-views stack (NebulaKit/planning/ADMIN_STATS.md),
 * narrowed to what a marketing site needs. Daily AGGREGATE counters only: no raw
 * request rows, no cookies, no identifiers, no IP addresses. The User-Agent and
 * client hints are read in the hook, mapped to a small fixed vocabulary, and
 * dropped; only the bucket is stored. That is why there is no consent banner.
 *
 * The bucketing functions are pure so they test without a browser or a database.
 */

type Db = any;

/**
 * The public pages worth measuring, by SvelteKit route id. An allowlist, not a
 * blocklist: a new dashboard, API or Activity route is never counted by accident,
 * and nothing a signed-in member does inside the product lands here.
 */
export const MARKETING_ROUTES = new Set([
	'/',
	'/docs',
	'/docs/dev',
	'/docs/dev/[slug]',
	'/invite',
	'/leaderboards',
	'/login',
	'/privacy',
	'/servers',
	'/servers/[guildId]',
	'/support',
	'/terms',
	'/vote',
]);

export const BOT_UA =
	/bot|crawler|spider|preview|facebookexternalhit|lighthouse|headless|monitor|uptime|curl|wget/i;

/** Days of counters kept. A year and a bit, so year-on-year reads work. */
export const RETENTION_DAYS = 400;

/** Hourly totals only back the 24-bucket "1 day" window, so they need far less. */
export const HOURLY_RETENTION_DAYS = 30;

export type ViewDimension = 'os' | 'browser' | 'device' | 'language';
export type SiteEvent = 'login_start' | 'install_start' | 'install_done';
export const SITE_EVENTS: SiteEvent[] = ['login_start', 'install_start', 'install_done'];

export interface PageViewRecord {
	day: string;
	hour: number;
	pathKey: string;
	signedIn: boolean;
	referrerHost?: string;
	country?: string;
	os?: string;
	browser?: string;
	device?: string;
	language?: string;
}

// --- bucketing ----------------------------------------------------------------------

/** Cloudflare's country values are ISO alpha-2 plus specials ('T1' Tor, 'XX'
 *  unknown). Anything else collapses to '(unknown)' so cardinality stays bounded. */
export function normalizeCountry(country: string | null | undefined): string {
	if (typeof country === 'string' && /^[A-Z0-9]{2}$/.test(country)) return country;
	return '(unknown)';
}

/** OS from Sec-CH-UA-Platform (quoted, like `"Windows"`) with a coarse UA fallback. */
export function osBucket(platformHint: string | null, ua: string | null): string {
	const hint = (platformHint ?? '').replace(/"/g, '').trim();
	if (hint) {
		const known = ['Windows', 'macOS', 'Android', 'iOS', 'Linux', 'Chrome OS', 'Chromium OS'];
		const match = known.find((k) => k.toLowerCase() === hint.toLowerCase());
		if (match) return match === 'Chromium OS' ? 'Chrome OS' : match;
		return '(other)';
	}
	const agent = ua ?? '';
	if (/iPhone|iPad|iPod/.test(agent)) return 'iOS';
	if (/Android/.test(agent)) return 'Android';
	if (/Windows NT/.test(agent)) return 'Windows';
	if (/CrOS/.test(agent)) return 'Chrome OS';
	if (/Mac OS X/.test(agent)) return 'macOS';
	if (/Linux/.test(agent)) return 'Linux';
	return '(unknown)';
}

/** Browser from Sec-CH-UA brands (the real brand, not "Chromium") with a UA fallback. */
export function browserBucket(uaHint: string | null, ua: string | null): string {
	const hint = uaHint ?? '';
	if (hint) {
		const brands = [...hint.matchAll(/"([^"]+)";v=/g)].map((m) => m[1]);
		const named = ['Google Chrome', 'Microsoft Edge', 'Opera', 'Brave', 'Samsung Internet'];
		for (const brand of brands) {
			const match = named.find((n) => n.toLowerCase() === brand.toLowerCase());
			if (match) return match === 'Google Chrome' ? 'Chrome' : match;
		}
		if (brands.some((b) => /Chromium/i.test(b))) return 'Chromium';
	}
	const agent = ua ?? '';
	if (/Edg(e|A|iOS)?\//.test(agent)) return 'Microsoft Edge';
	if (/OPR\/|Opera/.test(agent)) return 'Opera';
	if (/SamsungBrowser\//.test(agent)) return 'Samsung Internet';
	if (/Firefox\/|FxiOS\//.test(agent)) return 'Firefox';
	if (/CriOS\//.test(agent)) return 'Chrome';
	if (/Chrome\//.test(agent)) return 'Chrome';
	if (/Safari\//.test(agent)) return 'Safari';
	return '(unknown)';
}

/** Device class from Sec-CH-UA-Mobile ('?1' / '?0') with a UA fallback. */
export function deviceBucket(mobileHint: string | null, ua: string | null): string {
	const agent = ua ?? '';
	if (/iPad|Tablet/i.test(agent)) return 'tablet';
	if (mobileHint === '?1') return 'mobile';
	if (mobileHint === '?0') return 'desktop';
	if (/Mobi/.test(agent)) return 'mobile';
	if (agent) return 'desktop';
	return '(unknown)';
}

/** First Accept-Language tag, normalised to `xx` / `xx-XX`. */
export function languageBucket(acceptLanguage: string | null): string {
	const first = (acceptLanguage ?? '').split(',')[0]?.split(';')[0]?.trim() ?? '';
	const m = first.match(/^([a-zA-Z]{2,3})(?:-([a-zA-Z0-9]{2,8}))?$/);
	if (!m) return '(unknown)';
	const primary = m[1].toLowerCase();
	return m[2] ? `${primary}-${m[2].toUpperCase()}` : primary;
}

export const utcDay = (date: Date) => date.toISOString().slice(0, 10);
export const utcHour = (date: Date) => date.getUTCHours();
export const utcHourKey = (date: Date) =>
	`${utcDay(date)}T${String(utcHour(date)).padStart(2, '0')}`;

/** A bare host from a Referer value; null for same-site, unparseable or absent. */
export function referrerHostFrom(referrer: string | null, ownHost: string): string | null {
	if (!referrer) return null;
	try {
		const host = new URL(referrer).hostname.toLowerCase();
		if (!host || host === ownHost.toLowerCase()) return null;
		return host;
	} catch {
		return null;
	}
}

/** Whether a request should be counted at all. */
export function shouldCount(opts: {
	method: string;
	status: number;
	routeId: string | null | undefined;
	contentType: string | null;
	userAgent: string | null;
}): boolean {
	return (
		opts.method === 'GET' &&
		opts.status === 200 &&
		Boolean(opts.routeId && MARKETING_ROUTES.has(opts.routeId)) &&
		(opts.contentType ?? '').includes('text/html') &&
		!BOT_UA.test(opts.userAgent ?? '')
	);
}

// --- writes -----------------------------------------------------------------------------

/** One page view as a batch of counter upserts. */
export async function recordPageView(db: Db, view: PageViewRecord): Promise<void> {
	const signed = view.signedIn ? 1 : 0;
	const statements = [
		db
			.prepare(
				`INSERT INTO site_view_daily (day, path_key, views, signed_in) VALUES (?, ?, 1, ?)
				 ON CONFLICT (day, path_key) DO UPDATE SET views = views + 1, signed_in = signed_in + excluded.signed_in`
			)
			.bind(view.day, view.pathKey, signed),
		db
			.prepare(
				`INSERT INTO site_view_hourly (day, hour, views, signed_in) VALUES (?, ?, 1, ?)
				 ON CONFLICT (day, hour) DO UPDATE SET views = views + 1, signed_in = signed_in + excluded.signed_in`
			)
			.bind(view.day, view.hour, signed),
		db
			.prepare(
				`INSERT INTO site_referrer_daily (day, referrer_host, views) VALUES (?, ?, 1)
				 ON CONFLICT (day, referrer_host) DO UPDATE SET views = views + 1`
			)
			.bind(view.day, view.referrerHost ?? '(direct)'),
		db
			.prepare(
				`INSERT INTO site_country_daily (day, country, views) VALUES (?, ?, 1)
				 ON CONFLICT (day, country) DO UPDATE SET views = views + 1`
			)
			.bind(view.day, normalizeCountry(view.country)),
	];
	const dimensions: Array<[ViewDimension, string | undefined]> = [
		['os', view.os],
		['browser', view.browser],
		['device', view.device],
		['language', view.language],
	];
	for (const [dimension, value] of dimensions) {
		statements.push(
			db
				.prepare(
					`INSERT INTO site_dimension_daily (day, dimension, value, views) VALUES (?, ?, ?, 1)
					 ON CONFLICT (day, dimension, value) DO UPDATE SET views = views + 1`
				)
				.bind(view.day, dimension, value || '(unknown)')
		);
	}
	await db.batch(statements);
}

/** One funnel step (sign-in started, install started, install finished). */
export async function recordSiteEvent(db: Db, event: SiteEvent, now = new Date()): Promise<void> {
	await db
		.prepare(
			`INSERT INTO site_event_daily (day, event, count) VALUES (?, ?, 1)
			 ON CONFLICT (day, event) DO UPDATE SET count = count + 1`
		)
		.bind(utcDay(now), event)
		.run();
}

/** Delete counters older than the retention window. */
export async function pruneSiteTraffic(db: Db, now = new Date()): Promise<void> {
	const before = utcDay(new Date(now.getTime() - RETENTION_DAYS * 86_400_000));
	const hourlyBefore = utcDay(new Date(now.getTime() - HOURLY_RETENTION_DAYS * 86_400_000));
	await db.batch([
		db.prepare(`DELETE FROM site_view_hourly WHERE day < ?`).bind(hourlyBefore),
		...[
			'site_view_daily',
			'site_referrer_daily',
			'site_country_daily',
			'site_dimension_daily',
			'site_event_daily',
			'site_listing_daily',
		].map((table) => db.prepare(`DELETE FROM ${table} WHERE day < ?`).bind(before)),
	]);
}

// --- reads ----------------------------------------------------------------------------------

export const WINDOWS = [1, 7, 30, 90] as const;
export type Window = (typeof WINDOWS)[number];

export function parseWindow(raw: string | null | undefined): Window {
	const n = Number(raw);
	return (WINDOWS as readonly number[]).includes(n) ? (n as Window) : 30;
}

/** First UTC day included in a window of `days` ending today. */
export function sinceDay(days: number, now = new Date()): string {
	return utcDay(new Date(now.getTime() - (days - 1) * 86_400_000));
}

export interface Bucket {
	label: string;
	views: number;
	/** Signed-in views, where the table carries them. */
	signedIn?: number;
}

const rows = (r: any): any[] => r?.results ?? [];

/** A dense series of daily totals; days with no traffic are zero, not missing. */
export async function dailySeries(db: Db, days: number, now = new Date()): Promise<Bucket[]> {
	const since = sinceDay(days, now);
	const found = rows(
		await db
			.prepare(
				`SELECT day, SUM(views) AS views, SUM(signed_in) AS signed_in
				 FROM site_view_daily WHERE day >= ? GROUP BY day`
			)
			.bind(since)
			.all()
	);
	const byDay = new Map(found.map((r) => [r.day, r]));
	const out: Bucket[] = [];
	for (let i = days - 1; i >= 0; i--) {
		const day = utcDay(new Date(now.getTime() - i * 86_400_000));
		const r = byDay.get(day);
		out.push({ label: day, views: r?.views ?? 0, signedIn: r?.signed_in ?? 0 });
	}
	return out;
}

/** 24 hourly buckets, ending with the current hour. */
export async function hourlySeries(db: Db, now = new Date()): Promise<Bucket[]> {
	const startMs = now.getTime() - 23 * 3_600_000;
	const startKey = utcHourKey(new Date(startMs));
	const found = rows(
		await db
			.prepare(
				`SELECT day, hour, views, signed_in FROM site_view_hourly
				 WHERE day >= ? AND (day || 'T' || substr('0' || hour, -2)) >= ?`
			)
			.bind(startKey.slice(0, 10), startKey)
			.all()
	);
	const byKey = new Map(found.map((r) => [`${r.day}T${String(r.hour).padStart(2, '0')}`, r]));
	const out: Bucket[] = [];
	for (let i = 0; i < 24; i++) {
		const key = utcHourKey(new Date(startMs + i * 3_600_000));
		const r = byKey.get(key);
		out.push({ label: key, views: r?.views ?? 0, signedIn: r?.signed_in ?? 0 });
	}
	return out;
}

export async function topPages(db: Db, since: string, limit = 20): Promise<Bucket[]> {
	return rows(
		await db
			.prepare(
				`SELECT path_key AS label, SUM(views) AS views, SUM(signed_in) AS signed_in
				 FROM site_view_daily WHERE day >= ? GROUP BY path_key ORDER BY views DESC LIMIT ?`
			)
			.bind(since, limit)
			.all()
	).map((r) => ({ label: r.label, views: r.views, signedIn: r.signed_in }));
}

export async function topReferrers(db: Db, since: string, limit = 15): Promise<Bucket[]> {
	return rows(
		await db
			.prepare(
				`SELECT referrer_host AS label, SUM(views) AS views FROM site_referrer_daily
				 WHERE day >= ? GROUP BY referrer_host ORDER BY views DESC LIMIT ?`
			)
			.bind(since, limit)
			.all()
	).map((r) => ({ label: r.label, views: r.views }));
}

export async function topCountries(db: Db, since: string, limit = 15): Promise<Bucket[]> {
	return rows(
		await db
			.prepare(
				`SELECT country AS label, SUM(views) AS views FROM site_country_daily
				 WHERE day >= ? GROUP BY country ORDER BY views DESC LIMIT ?`
			)
			.bind(since, limit)
			.all()
	).map((r) => ({ label: r.label, views: r.views }));
}

export async function dimension(
	db: Db,
	name: ViewDimension,
	since: string,
	limit = 10
): Promise<Bucket[]> {
	return rows(
		await db
			.prepare(
				`SELECT value AS label, SUM(views) AS views FROM site_dimension_daily
				 WHERE dimension = ? AND day >= ? GROUP BY value ORDER BY views DESC LIMIT ?`
			)
			.bind(name, since, limit)
			.all()
	).map((r) => ({ label: r.label, views: r.views }));
}

export interface Funnel {
	/** Views of the home page. */
	visits: number;
	/** Views of the invite page. */
	invitePage: number;
	loginStarts: number;
	installStarts: number;
	installs: number;
}

/** The marketing funnel for the window: home page, then each step toward an install. */
export async function funnel(db: Db, since: string): Promise<Funnel> {
	const pages = rows(
		await db
			.prepare(
				`SELECT path_key, SUM(views) AS views FROM site_view_daily
				 WHERE day >= ? AND path_key IN ('/', '/invite') GROUP BY path_key`
			)
			.bind(since)
			.all()
	);
	const events = rows(
		await db
			.prepare(
				`SELECT event, SUM(count) AS count FROM site_event_daily WHERE day >= ? GROUP BY event`
			)
			.bind(since)
			.all()
	);
	const page = (k: string) => pages.find((r) => r.path_key === k)?.views ?? 0;
	const event = (k: string) => events.find((r) => r.event === k)?.count ?? 0;
	return {
		visits: page('/'),
		invitePage: page('/invite'),
		loginStarts: event('login_start'),
		installStarts: event('install_start'),
		installs: event('install_done'),
	};
}

export const sum = (buckets: Bucket[]) => buckets.reduce((n, b) => n + b.views, 0);
