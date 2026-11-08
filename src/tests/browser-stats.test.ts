import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSqliteD1 } from './helpers/sqlite-d1.js';
import {
	browserCounts,
	browserSeries,
	browserTotals,
	categoryTable,
	countableRequest,
	listingTable,
	recordBrowseUse,
	recordImpressions,
	recordJoin,
	recordListingView,
} from '../lib/server/browser-stats.js';
import { pruneSiteTraffic, recordPageView } from '../lib/server/site-traffic.js';

const migration = (file: string) =>
	readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8');

const NOW = new Date('2026-11-05T12:00:00Z');
const day = (offset: number) =>
	new Date(NOW.getTime() - offset * 86_400_000).toISOString().slice(0, 10);

let db: ReturnType<typeof createSqliteD1>;
const listing = (id: string, name: string, category: string, over = '') =>
	db.exec(`INSERT INTO guild_metadata (guild_id, name, approximate_member_count) VALUES ('${id}', '${name}', 100);
		INSERT INTO guild_listings (guild_id, listed, category, review_status${over ? ', ' + over.split('=')[0] : ''})
		VALUES ('${id}', 1, '${category}', 'approved'${over ? ", '" + over.split('=')[1] + "'" : ''});`);

beforeEach(() => {
	db = createSqliteD1(
		migration('0022_guild_metadata.sql') +
			migration('0059_public_server_listings.sql') +
			migration('0084_site_traffic.sql') +
			migration('0091_site_listing_daily.sql')
	);
});

describe('countableRequest', () => {
	const req = (headers: Record<string, string>) => new Request('https://x.test/', { headers });
	it('counts a browser and skips bots and prefetches', () => {
		expect(countableRequest(req({ 'user-agent': 'Mozilla/5.0 Firefox/130' }))).toBe(true);
		expect(countableRequest(req({ 'user-agent': 'Googlebot/2.1' }))).toBe(false);
		expect(
			countableRequest(req({ 'user-agent': 'Mozilla/5.0', 'sec-purpose': 'prefetch' }))
		).toBe(false);
		expect(countableRequest(req({}))).toBe(true);
	});
});

describe('recording', () => {
	it('adds impressions, views and joins to one row per listing per day', async () => {
		await recordImpressions(db, ['a', 'b', 'a'], NOW); // duplicate ids count once
		await recordImpressions(db, ['a'], NOW);
		await recordListingView(db, 'a', NOW);
		await recordJoin(db, 'a', NOW);
		await recordJoin(db, 'a', NOW);
		const rows = (await db.prepare('SELECT * FROM site_listing_daily ORDER BY guild_id').all())
			.results;
		expect(rows).toEqual([
			{ day: day(0), guild_id: 'a', impressions: 2, views: 1, joins: 2 },
			{ day: day(0), guild_id: 'b', impressions: 1, views: 0, joins: 0 },
		]);
	});

	it('counts category use and searches, and stores no search words', async () => {
		await recordBrowseUse(db, { category: 'gaming', searched: true }, NOW);
		await recordBrowseUse(db, { category: 'gaming' }, NOW);
		await recordBrowseUse(db, {}, NOW); // nothing to count
		const cat = await db
			.prepare(
				`SELECT value, views FROM site_dimension_daily WHERE dimension = 'browse_category'`
			)
			.first();
		expect(cat).toEqual({ value: 'gaming', views: 2 });
		const search = await db
			.prepare(`SELECT count FROM site_event_daily WHERE event = 'browse_search'`)
			.first();
		expect(search).toEqual({ count: 1 });
	});

	it('is pruned with the other counters', async () => {
		await recordListingView(db, 'a', new Date(NOW.getTime() - 500 * 86_400_000));
		await recordListingView(db, 'a', NOW);
		await pruneSiteTraffic(db, NOW);
		expect((await db.prepare('SELECT COUNT(*) AS c FROM site_listing_daily').first())?.c).toBe(
			1
		);
	});
});

describe('reading', () => {
	it('totals a range and builds a dense daily series', async () => {
		await recordImpressions(db, ['a', 'b'], new Date(NOW.getTime() - 2 * 86_400_000));
		await recordListingView(db, 'a', NOW);
		await recordJoin(db, 'a', NOW);
		expect(await browserTotals(db, day(6))).toEqual({ impressions: 2, views: 1, joins: 1 });
		// an earlier range for comparison
		expect(await browserTotals(db, day(13), day(7))).toEqual({
			impressions: 0,
			views: 0,
			joins: 0,
		});
		const series = await browserSeries(db, 7, NOW);
		expect(series).toHaveLength(7);
		expect(series.at(-1)).toMatchObject({ label: day(0), views: 1, joins: 1 });
		expect(series.at(-3)).toMatchObject({ label: day(2), impressions: 2 });
	});

	it('ranks listings, includes live ones with no traffic, and works out the join rate', async () => {
		listing('a', 'Alpha', 'gaming');
		listing('b', 'Bravo', 'tech');
		listing('c', 'Quiet', 'music');
		await recordListingView(db, 'a', NOW);
		await recordListingView(db, 'a', NOW);
		await recordJoin(db, 'a', NOW);
		await recordListingView(db, 'b', NOW);
		const byJoins = await listingTable(db, day(6), 'joins');
		expect(byJoins.map((r) => r.guildId)).toEqual(['a', 'b', 'c']);
		expect(byJoins[0]).toMatchObject({
			name: 'Alpha',
			views: 2,
			joins: 1,
			joinRate: 0.5,
			live: true,
		});
		expect(byJoins[2]).toMatchObject({ views: 0, joinRate: null });
		const byViews = await listingTable(db, day(6), 'views');
		expect(byViews[0].guildId).toBe('a');
	});

	it('shows a listing that has since been hidden, marked as not live', async () => {
		listing('a', 'Alpha', 'gaming');
		db.exec(`UPDATE guild_listings SET review_status = 'rejected' WHERE guild_id = 'a'`);
		await recordListingView(db, 'a', NOW);
		const rows = await listingTable(db, day(6));
		expect(rows).toHaveLength(1);
		expect(rows[0].live).toBe(false);
	});

	it('rolls up by category, with filter use', async () => {
		listing('a', 'Alpha', 'gaming');
		listing('b', 'Bravo', 'gaming');
		listing('c', 'Cee', 'tech');
		await recordJoin(db, 'a', NOW);
		await recordListingView(db, 'c', NOW);
		await recordBrowseUse(db, { category: 'tech' }, NOW);
		const cats = await categoryTable(db, day(6));
		expect(cats.find((c) => c.category === 'gaming')).toMatchObject({
			listings: 2,
			joins: 1,
			filtered: 0,
		});
		expect(cats.find((c) => c.category === 'tech')).toMatchObject({
			listings: 1,
			views: 1,
			filtered: 1,
		});
		expect(cats[0].category).toBe('gaming'); // most joins first
	});

	it('counts live, waiting and hidden listings and the page-level numbers', async () => {
		listing('a', 'Alpha', 'gaming');
		listing('b', 'Bravo', 'gaming');
		db.exec(`UPDATE guild_listings SET review_status = 'rejected' WHERE guild_id = 'b'`);
		await recordBrowseUse(db, { searched: true }, NOW);
		await recordPageView(db, {
			day: day(0),
			hour: 12,
			pathKey: '/servers',
			signedIn: false,
		});
		const counts = await browserCounts(db, day(6));
		expect(counts).toMatchObject({
			live: 1,
			hidden: 1,
			searches: 1,
			browsePageViews: 1,
			listingPageViews: 0,
		});
	});
});
