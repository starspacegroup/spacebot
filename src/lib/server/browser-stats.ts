/**
 * Server browser counters: how the public listings perform.
 *
 * Same rules as `site-traffic.ts`: daily aggregate counters, nothing per visitor.
 * One row per listing per UTC day (`site_listing_daily`, migration 0091) holds
 * impressions (a card was on a page that loaded), views (the listing's own page
 * loaded) and joins (the Join button was pressed). Category filters and searches
 * are counted in the existing dimension and event tables; the words someone typed
 * are never stored.
 *
 * Writes never throw into a request: callers hand them to `waitUntil` and a failed
 * counter costs nobody a page.
 */

import { BOT_UA, utcDay } from './site-traffic.js';

type Db = any;

/** Whether this request is a person: a bot or a browser prefetch must not move a count. */
export function countableRequest(request: Request): boolean {
	const headers = request.headers;
	if (BOT_UA.test(headers.get('user-agent') ?? '')) return false;
	const purpose = `${headers.get('sec-purpose') ?? ''} ${headers.get('purpose') ?? ''}`;
	return !/prefetch|prerender/i.test(purpose);
}

const bump = (db: Db, day: string, guildId: string, column: 'impressions' | 'views' | 'joins') =>
	db
		.prepare(
			`INSERT INTO site_listing_daily (day, guild_id, ${column}) VALUES (?, ?, 1)
			 ON CONFLICT (day, guild_id) DO UPDATE SET ${column} = ${column} + 1`
		)
		.bind(day, guildId);

/** Cards shown on a browser page: one impression each, in one batch. */
export async function recordImpressions(db: Db, guildIds: string[], now = new Date()) {
	const ids = [...new Set(guildIds)].slice(0, 100);
	if (!db || ids.length === 0) return;
	const day = utcDay(now);
	await db.batch(ids.map((id) => bump(db, day, id, 'impressions')));
}

export async function recordListingView(db: Db, guildId: string, now = new Date()) {
	if (!db) return;
	await bump(db, utcDay(now), guildId, 'views').run();
}

export async function recordJoin(db: Db, guildId: string, now = new Date()) {
	if (!db) return;
	await bump(db, utcDay(now), guildId, 'joins').run();
}

/**
 * A browser page that used a filter: the category (a closed list, so safe to store) and
 * whether a search was typed (a count only, never the words).
 */
export async function recordBrowseUse(
	db: Db,
	use: { category?: string; searched?: boolean },
	now = new Date()
) {
	if (!db || (!use.category && !use.searched)) return;
	const day = utcDay(now);
	const statements = [];
	if (use.category) {
		statements.push(
			db
				.prepare(
					`INSERT INTO site_dimension_daily (day, dimension, value, views) VALUES (?, 'browse_category', ?, 1)
					 ON CONFLICT (day, dimension, value) DO UPDATE SET views = views + 1`
				)
				.bind(day, use.category)
		);
	}
	if (use.searched) {
		statements.push(
			db
				.prepare(
					`INSERT INTO site_event_daily (day, event, count) VALUES (?, 'browse_search', 1)
					 ON CONFLICT (day, event) DO UPDATE SET count = count + 1`
				)
				.bind(day)
		);
	}
	await db.batch(statements);
}

// --- reads -----------------------------------------------------------------------------

const rows = (r: any): any[] => r?.results ?? [];
const n = (v: unknown) => Number(v) || 0;

export interface BrowserTotals {
	impressions: number;
	views: number;
	joins: number;
}

/** Totals for days in [since, until] (UTC, inclusive). `until` defaults to today onward. */
export async function browserTotals(db: Db, since: string, until = '9999-12-31') {
	const r: any = await db
		.prepare(
			`SELECT COALESCE(SUM(impressions), 0) AS impressions, COALESCE(SUM(views), 0) AS views,
			        COALESCE(SUM(joins), 0) AS joins
			   FROM site_listing_daily WHERE day >= ? AND day <= ?`
		)
		.bind(since, until)
		.first();
	return { impressions: n(r?.impressions), views: n(r?.views), joins: n(r?.joins) };
}

export interface BrowserDay extends BrowserTotals {
	label: string;
}

/** A dense series, one entry per UTC day, zeros for quiet days. */
export async function browserSeries(db: Db, days: number, now = new Date()) {
	const since = utcDay(new Date(now.getTime() - (days - 1) * 86_400_000));
	const found = rows(
		await db
			.prepare(
				`SELECT day, SUM(impressions) AS impressions, SUM(views) AS views, SUM(joins) AS joins
				   FROM site_listing_daily WHERE day >= ? GROUP BY day`
			)
			.bind(since)
			.all()
	);
	const byDay = new Map(found.map((r) => [r.day, r]));
	const out: BrowserDay[] = [];
	for (let i = days - 1; i >= 0; i--) {
		const day = utcDay(new Date(now.getTime() - i * 86_400_000));
		const r = byDay.get(day);
		out.push({
			label: day,
			impressions: n(r?.impressions),
			views: n(r?.views),
			joins: n(r?.joins),
		});
	}
	return out;
}

export const LISTING_SORT_KEYS = ['joins', 'views', 'impressions', 'rate', 'members'] as const;
export type ListingSortKey = (typeof LISTING_SORT_KEYS)[number];

export interface ListingRow extends BrowserTotals {
	guildId: string;
	name: string;
	icon: string | null;
	category: string | null;
	members: number | null;
	/** Live in the browser right now. */
	live: boolean;
	/** Joins as a share of the listing's own views; null with no views. */
	joinRate: number | null;
}

/**
 * Every listing with traffic in the window, plus every live listing with none (a listing
 * nobody opened is information too). Names come from the metadata the browser itself uses.
 */
export async function listingTable(
	db: Db,
	since: string,
	sort: ListingSortKey = 'joins',
	limit = 100
): Promise<ListingRow[]> {
	const found = rows(
		await db
			.prepare(
				`SELECT g.guild_id AS guild_id,
				        COALESCE(SUM(d.impressions), 0) AS impressions,
				        COALESCE(SUM(d.views), 0) AS views, COALESCE(SUM(d.joins), 0) AS joins,
				        m.name AS name, m.icon AS icon, m.approximate_member_count AS members,
				        l.category AS category,
				        CASE WHEN l.listed = 1 AND l.review_status = 'approved' THEN 1 ELSE 0 END AS live
				   FROM (SELECT guild_id FROM site_listing_daily WHERE day >= ?
				         UNION SELECT guild_id FROM guild_listings
				                WHERE listed = 1 AND review_status = 'approved') g
				   LEFT JOIN site_listing_daily d ON d.guild_id = g.guild_id AND d.day >= ?
				   LEFT JOIN guild_listings l ON l.guild_id = g.guild_id
				   LEFT JOIN guild_metadata m ON m.guild_id = g.guild_id
				  GROUP BY g.guild_id`
			)
			.bind(since, since)
			.all()
	);
	const out: ListingRow[] = found.map((r) => ({
		guildId: String(r.guild_id),
		name: r.name || 'A server',
		icon: r.icon ? String(r.icon) : null,
		category: r.category ?? null,
		members: r.members == null ? null : n(r.members),
		live: Boolean(r.live),
		impressions: n(r.impressions),
		views: n(r.views),
		joins: n(r.joins),
		joinRate: n(r.views) > 0 ? n(r.joins) / n(r.views) : null,
	}));
	const key: Record<ListingSortKey, (r: ListingRow) => number> = {
		joins: (r) => r.joins,
		views: (r) => r.views,
		impressions: (r) => r.impressions,
		rate: (r) => r.joinRate ?? -1,
		members: (r) => r.members ?? -1,
	};
	const by = key[sort] ?? key.joins;
	return out
		.sort(
			(a, b) =>
				by(b) - by(a) ||
				b.joins - a.joins ||
				b.views - a.views ||
				a.name.localeCompare(b.name)
		)
		.slice(0, limit);
}

export interface CategoryRow extends BrowserTotals {
	category: string;
	listings: number;
	/** Times the category filter was used in the browser. */
	filtered: number;
}

/** Per category: live listings, their traffic, and how often people filtered by it. */
export async function categoryTable(db: Db, since: string): Promise<CategoryRow[]> {
	const [traffic, filters] = await Promise.all([
		db
			.prepare(
				`SELECT COALESCE(l.category, 'other') AS category, COUNT(DISTINCT l.guild_id) AS listings,
				        COALESCE(SUM(d.impressions), 0) AS impressions,
				        COALESCE(SUM(d.views), 0) AS views, COALESCE(SUM(d.joins), 0) AS joins
				   FROM guild_listings l
				   LEFT JOIN site_listing_daily d ON d.guild_id = l.guild_id AND d.day >= ?
				  WHERE l.listed = 1 AND l.review_status = 'approved'
				  GROUP BY COALESCE(l.category, 'other')`
			)
			.bind(since)
			.all(),
		db
			.prepare(
				`SELECT value, SUM(views) AS views FROM site_dimension_daily
				  WHERE dimension = 'browse_category' AND day >= ? GROUP BY value`
			)
			.bind(since)
			.all(),
	]);
	const filtered = new Map(rows(filters).map((r) => [String(r.value), n(r.views)]));
	return rows(traffic)
		.map((r) => ({
			category: String(r.category),
			listings: n(r.listings),
			impressions: n(r.impressions),
			views: n(r.views),
			joins: n(r.joins),
			filtered: filtered.get(String(r.category)) ?? 0,
		}))
		.sort((a, b) => b.joins - a.joins || b.views - a.views || b.listings - a.listings);
}

export interface BrowserCounts {
	live: number;
	waiting: number;
	hidden: number;
	searches: number;
	/** Views of the browser pages themselves (the list and a listing's page). */
	browsePageViews: number;
	listingPageViews: number;
}

/** Live listings, how many wait for review or were hidden, and the page-level numbers. */
export async function browserCounts(db: Db, since: string): Promise<BrowserCounts> {
	const [status, searches, pages] = await Promise.all([
		db
			.prepare(
				`SELECT review_status AS status, COUNT(*) AS c FROM guild_listings
				  WHERE listed = 1 GROUP BY review_status`
			)
			.all(),
		db
			.prepare(
				`SELECT COALESCE(SUM(count), 0) AS c FROM site_event_daily WHERE event = 'browse_search' AND day >= ?`
			)
			.bind(since)
			.first(),
		db
			.prepare(
				`SELECT path_key, SUM(views) AS views FROM site_view_daily
				  WHERE day >= ? AND path_key IN ('/servers', '/servers/[guildId]') GROUP BY path_key`
			)
			.bind(since)
			.all(),
	]);
	const by = new Map(rows(status).map((r) => [String(r.status), n(r.c)]));
	const page = (k: string) => n(rows(pages).find((r) => r.path_key === k)?.views);
	return {
		live: by.get('approved') ?? 0,
		waiting: by.get('pending') ?? 0,
		hidden: (by.get('rejected') ?? 0) + (by.get('hidden') ?? 0),
		searches: n((searches as any)?.c),
		browsePageViews: page('/servers'),
		listingPageViews: page('/servers/[guildId]'),
	};
}
