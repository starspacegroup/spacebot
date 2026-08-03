import { describe, expect, it } from 'vitest';
import {
	LISTING_FRESHNESS_DAYS,
	MAX_TAGS,
	browsePublicListings,
	buildBrowseFilters,
	getCategoryCounts,
	getListingHealth,
	getPublicListing,
	mergeListing,
	normalizeInviteUrl,
	parseTags,
	toPublicListing,
	validateListing,
} from '../lib/db/server-listings.js';
import { createSqliteD1 } from './helpers/sqlite-d1.js';
import { formatMemberCount, serverHue, serverInitials } from '../lib/server-listing-display.js';

describe('normalizeInviteUrl', () => {
	it('accepts and canonicalizes the shapes admins actually paste', () => {
		expect(normalizeInviteUrl('https://discord.gg/abc123')).toBe('https://discord.gg/abc123');
		expect(normalizeInviteUrl('discord.gg/abc123')).toBe('https://discord.gg/abc123');
		expect(normalizeInviteUrl('http://www.discord.gg/abc123')).toBe(
			'https://discord.gg/abc123'
		);
		expect(normalizeInviteUrl('https://discord.com/invite/abc123')).toBe(
			'https://discord.gg/abc123'
		);
		expect(normalizeInviteUrl('  https://discord.gg/abc123/  ')).toBe(
			'https://discord.gg/abc123'
		);
	});

	it('rejects non-Discord destinations so the browser cannot become a redirector', () => {
		// The invite is rendered as an outbound link on a page we host — anything
		// that is not a Discord invite must not survive validation.
		expect(normalizeInviteUrl('https://evil.example.com/phish')).toBeNull();
		expect(normalizeInviteUrl('https://discord.gg.evil.example.com/abc')).toBeNull();
		expect(normalizeInviteUrl('javascript:alert(1)')).toBeNull();
		expect(normalizeInviteUrl('https://discord.com/channels/123/456')).toBeNull();
		expect(normalizeInviteUrl('')).toBeNull();
		expect(normalizeInviteUrl(null)).toBeNull();
	});
});

describe('parseTags', () => {
	it('parses comma strings and JSON arrays alike', () => {
		expect(parseTags('gaming, indie ,co-op')).toEqual(['gaming', 'indie', 'co-op']);
		expect(parseTags('["gaming","indie"]')).toEqual(['gaming', 'indie']);
		expect(parseTags(['gaming', 'indie'])).toEqual(['gaming', 'indie']);
	});

	it('drops blanks, dedupes case-insensitively, and caps the count', () => {
		expect(parseTags('a,,  ,b')).toEqual(['a', 'b']);
		expect(parseTags('Gaming, gaming, GAMING')).toEqual(['Gaming']);
		expect(parseTags(Array.from({ length: 30 }, (_, i) => `tag${i}`))).toHaveLength(MAX_TAGS);
	});
});

describe('validateListing', () => {
	it('defaults to unlisted and requires nothing while unlisted', () => {
		const result = validateListing({});
		expect(result.ok).toBe(true);
		expect(result.value.listed).toBe(false);
		expect(result.value.headline).toBeNull();
	});

	it('refuses to publish without a headline and an invite', () => {
		const result = validateListing({ listed: true });
		expect(result.ok).toBe(false);
		expect(result.errors.headline).toBeTruthy();
		expect(result.errors.invite_url).toBeTruthy();
	});

	it('publishes when the required copy is present', () => {
		const result = validateListing({
			listed: true,
			headline: 'A friendly place',
			invite_url: 'discord.gg/abc123',
			category: 'gaming',
			tags: 'a, b',
			show_member_count: true,
		});
		expect(result.ok).toBe(true);
		expect(result.value).toMatchObject({
			listed: true,
			headline: 'A friendly place',
			invite_url: 'https://discord.gg/abc123',
			category: 'gaming',
			tags: ['a', 'b'],
		});
	});

	it('falls back to a known category rather than storing an arbitrary value', () => {
		expect(validateListing({ category: 'not-a-category' }).value.category).toBe('community');
	});

	it('surfaces a bad invite even when the server stays unlisted', () => {
		const result = validateListing({ listed: false, invite_url: 'https://evil.example.com' });
		expect(result.ok).toBe(false);
		expect(result.errors.invite_url).toBeTruthy();
	});

	it('truncates over-long copy instead of rejecting the save', () => {
		const result = validateListing({
			headline: 'x'.repeat(500),
			description: 'y'.repeat(5000),
		});
		expect(result.value.headline).toHaveLength(120);
		expect(result.value.description).toHaveLength(1000);
	});
});

describe('mergeListing', () => {
	it('treats a missing row as opted out', () => {
		const merged = mergeListing(null);
		expect(merged.listed).toBe(false);
		expect(merged.tags).toEqual([]);
		expect(merged.show_member_count).toBe(true);
	});

	it('reads stored 0/1 columns back as booleans', () => {
		const merged = mergeListing({
			guild_id: '1',
			listed: 1,
			headline: 'hi',
			description: null,
			category: 'tech',
			tags: '["a"]',
			invite_url: 'https://discord.gg/abc',
			show_member_count: 0,
			nsfw: 1,
			review_status: 'approved',
			review_note: null,
			listed_at: null,
			submitted_by: null,
		});
		expect(merged.listed).toBe(true);
		expect(merged.show_member_count).toBe(false);
		expect(merged.nsfw).toBe(true);
		expect(merged.tags).toEqual(['a']);
	});
});

describe('toPublicListing', () => {
	const row = {
		guild_id: '123456789012345678',
		name: 'Test Server',
		icon: 'abc',
		banner: 'def',
		headline: 'hi',
		description: 'about',
		category: 'gaming',
		tags: '["a"]',
		invite_url: 'https://discord.gg/abc',
		approximate_member_count: 500,
		approximate_presence_count: 42,
		premium_tier: 2,
		nsfw: 0,
		listed_at: '2026-08-01T00:00:00Z',
	};

	it('publishes member counts only when the admin opted into them', () => {
		const shown = toPublicListing({ ...row, show_member_count: 1 });
		expect(shown.member_count).toBe(500);
		expect(shown.online_count).toBe(42);

		// The toggle is a privacy control: hiding it must drop the numbers
		// entirely, not just skip rendering them.
		const hidden = toPublicListing({ ...row, show_member_count: 0 });
		expect(hidden.member_count).toBeNull();
		expect(hidden.online_count).toBeNull();
	});

	it('builds Discord CDN URLs and picks gif for animated icons', () => {
		const shown = toPublicListing({ ...row, show_member_count: 1 });
		expect(shown.icon_url).toContain(`/icons/${row.guild_id}/abc.webp`);
		expect(shown.banner_url).toContain(`/banners/${row.guild_id}/def.webp`);

		const animated = toPublicListing({ ...row, icon: 'a_xyz', show_member_count: 1 });
		expect(animated.icon_url).toContain('a_xyz.gif');
	});

	it('handles servers with no icon or banner', () => {
		const bare = toPublicListing({ ...row, icon: null, banner: null, show_member_count: 1 });
		expect(bare.icon_url).toBeNull();
		expect(bare.banner_url).toBeNull();
	});
});

// ── Visibility rules, against real SQLite ────────────────────────────────────
//
// The three-part visibility rule lives in SQL (including `datetime('now', …)`
// arithmetic), so these run against a real engine rather than a fake that would
// only be testing itself.

const SCHEMA = `
	CREATE TABLE guild_listings (
		guild_id TEXT PRIMARY KEY,
		listed INTEGER NOT NULL DEFAULT 0,
		headline TEXT, description TEXT, category TEXT,
		tags TEXT NOT NULL DEFAULT '[]',
		invite_url TEXT,
		show_member_count INTEGER NOT NULL DEFAULT 1,
		nsfw INTEGER NOT NULL DEFAULT 0,
		review_status TEXT NOT NULL DEFAULT 'approved',
		review_note TEXT, listed_at DATETIME, submitted_by TEXT
	);
	CREATE TABLE guild_metadata (
		guild_id TEXT PRIMARY KEY,
		name TEXT NOT NULL, icon TEXT, banner TEXT,
		approximate_member_count INTEGER, approximate_presence_count INTEGER,
		premium_tier INTEGER DEFAULT 0,
		fetched_at DATETIME
	);
`;

/** Seed one guild. `daysStale` moves its metadata refresh into the past. */
function seed(
	db: any,
	guildId: string,
	{ listed = 1, review = 'approved', daysStale = 0, nsfw = 0, hasMetadata = true } = {}
) {
	db.prepare(
		`INSERT INTO guild_listings (guild_id, listed, headline, category, tags, invite_url, show_member_count, nsfw, review_status, listed_at)
		 VALUES (?, ?, 'Headline', 'community', '[]', 'https://discord.gg/abc', 1, ?, ?, '2026-01-01')`
	)
		.bind(guildId, listed, nsfw, review)
		.run();

	if (hasMetadata) {
		db.prepare(
			`INSERT INTO guild_metadata (guild_id, name, approximate_member_count, fetched_at)
			 VALUES (?, ?, 100, datetime('now', ?))`
		)
			.bind(guildId, `Guild ${guildId}`, `-${daysStale} days`)
			.run();
	}
}

describe('public visibility rules (real SQLite)', () => {
	async function visibleIds(db: any) {
		const { listings } = await browsePublicListings(db);
		return listings.map((l) => l.guild_id);
	}

	it('shows a guild that is opted in, approved, and freshly refreshed', async () => {
		const db = createSqliteD1(SCHEMA);
		seed(db, '111111111111111111');
		expect(await visibleIds(db)).toEqual(['111111111111111111']);
		expect(await getPublicListing(db, '111111111111111111')).not.toBeNull();
		db.close();
	});

	it('hides a guild whose metadata went stale — i.e. the bot was removed', async () => {
		// Nothing deletes guild_metadata rows, so this staleness window is the
		// ONLY thing that delists a server that removed SpaceBot. Without it the
		// listing would stay public forever with a working invite link.
		const db = createSqliteD1(SCHEMA);
		seed(db, '111111111111111111', { daysStale: LISTING_FRESHNESS_DAYS + 1 });
		expect(await visibleIds(db)).toEqual([]);
		expect(await getPublicListing(db, '111111111111111111')).toBeNull();
		expect(await getCategoryCounts(db)).toEqual({});
		db.close();
	});

	it('keeps a guild visible through a refresh gap shorter than the window', async () => {
		// A Discord outage or a few failed cron runs must not empty the directory.
		const db = createSqliteD1(SCHEMA);
		seed(db, '111111111111111111', { daysStale: LISTING_FRESHNESS_DAYS - 1 });
		expect(await visibleIds(db)).toEqual(['111111111111111111']);
		db.close();
	});

	it('hides a guild that never opted in, even with fresh metadata', async () => {
		const db = createSqliteD1(SCHEMA);
		seed(db, '111111111111111111', { listed: 0 });
		expect(await visibleIds(db)).toEqual([]);
		expect(await getPublicListing(db, '111111111111111111')).toBeNull();
		db.close();
	});

	it('hides a guild an operator has taken down, without touching its opt-in', async () => {
		const db = createSqliteD1(SCHEMA);
		seed(db, '111111111111111111', { review: 'rejected' });
		expect(await visibleIds(db)).toEqual([]);

		const row = await db
			.prepare('SELECT listed FROM guild_listings WHERE guild_id = ?')
			.bind('111111111111111111')
			.first();
		expect(row.listed).toBe(1); // the admin's own opt-in is untouched
		db.close();
	});

	it('hides a guild with no metadata row at all', async () => {
		const db = createSqliteD1(SCHEMA);
		seed(db, '111111111111111111', { hasMetadata: false });
		expect(await visibleIds(db)).toEqual([]);
		db.close();
	});

	it('hides 18+ listings unless the visitor opts in', async () => {
		const db = createSqliteD1(SCHEMA);
		seed(db, '111111111111111111', { nsfw: 1 });
		expect(await visibleIds(db)).toEqual([]);
		const { listings } = await browsePublicListings(db, { includeNsfw: true });
		expect(listings.map((l) => l.guild_id)).toEqual(['111111111111111111']);
		db.close();
	});

	it('treats LIKE wildcards in a search term as literal characters', async () => {
		// Regression: escaping `%`/`_` with a backslash does nothing in SQLite
		// unless the query also says ESCAPE '\'. Without it, searching for
		// anything containing a wildcard silently returned zero rows.
		const db = createSqliteD1(SCHEMA);
		seed(db, '111111111111111111');
		seed(db, '222222222222222222');
		db.prepare('UPDATE guild_listings SET headline = ? WHERE guild_id = ?')
			.bind('Now 100% free', '111111111111111111')
			.run();
		db.prepare('UPDATE guild_listings SET headline = ? WHERE guild_id = ?')
			.bind('snake_case fans', '222222222222222222')
			.run();

		// The literal must be found...
		const pct = await browsePublicListings(db, { q: '100%' });
		expect(pct.listings.map((l: any) => l.guild_id)).toEqual(['111111111111111111']);
		const underscore = await browsePublicListings(db, { q: 'snake_case' });
		expect(underscore.listings.map((l: any) => l.guild_id)).toEqual(['222222222222222222']);

		// ...and must not behave as a wildcard: `_` matches any single char, so
		// an unescaped 'snake_case' query would still match 'snakeXcase'.
		db.prepare('UPDATE guild_listings SET headline = ? WHERE guild_id = ?')
			.bind('snakeXcase fans', '222222222222222222')
			.run();
		expect((await browsePublicListings(db, { q: 'snake_case' })).total).toBe(0);

		// A bare '%' searches for a literal percent sign — it matches only the
		// row that actually contains one, not every row.
		const bare = await browsePublicListings(db, { q: '%' });
		expect(bare.listings.map((l: any) => l.guild_id)).toEqual(['111111111111111111']);
		db.close();
	});

	it('paginates without losing or duplicating rows', async () => {
		const db = createSqliteD1(SCHEMA);
		for (let i = 0; i < 5; i++) seed(db, `11111111111111111${i}`);
		const page1 = await browsePublicListings(db, { pageSize: 2, page: 1 });
		const page2 = await browsePublicListings(db, { pageSize: 2, page: 2 });
		expect(page1.total).toBe(5);
		expect(page1.totalPages).toBe(3);
		expect(page1.listings).toHaveLength(2);
		expect(new Set([...page1.listings, ...page2.listings].map((l) => l.guild_id)).size).toBe(4);
		db.close();
	});
});

describe('buildBrowseFilters', () => {
	it('hides 18+ listings unless the visitor opted in', () => {
		expect(buildBrowseFilters({}).sql).toContain('l.nsfw = 0');
		expect(buildBrowseFilters({ includeNsfw: true }).sql).not.toContain('l.nsfw');
	});

	it('binds the search term instead of interpolating it', () => {
		const filters = buildBrowseFilters({ q: "o'brien" });
		expect(filters.sql).toContain('LIKE ?');
		expect(filters.sql).not.toContain("o'brien");
		expect(filters.binds).toEqual(Array(4).fill("%o'brien%"));
	});

	it('escapes LIKE wildcards so a "%" search cannot match everything', () => {
		expect(buildBrowseFilters({ q: '100%' }).binds[0]).toBe('%100\\%%');
	});

	it('ignores an unknown category rather than filtering on it', () => {
		expect(buildBrowseFilters({ category: 'bogus' }).sql).not.toContain('l.category');
		expect(buildBrowseFilters({ category: 'gaming' }).sql).toContain('l.category = ?');
	});
});

describe('display helpers', () => {
	it('takes initials by code point so emoji names do not render as U+FFFD', () => {
		// Regression: `'🎮 Gaming'[0]` is a lone high surrogate. Discord server
		// names lead with an emoji constantly, so this hit the fallback avatar
		// for a large share of icon-less servers.
		expect(serverInitials('🎮 Gaming Hub')).toBe('🎮G');
		expect([...serverInitials('🎮 Gaming Hub')][0]).toBe('🎮');
		expect(serverInitials('Orbital Workshop')).toBe('OW');
		expect(serverInitials('  spaced   out  ')).toBe('SO');
		expect(serverInitials('')).toBe('');
	});

	it('gives a stable in-range hue per guild', () => {
		expect(serverHue('111111111111111111')).toBe(serverHue('111111111111111111'));
		const hue = serverHue('222222222222222222');
		expect(hue).toBeGreaterThanOrEqual(0);
		expect(hue).toBeLessThan(360);
	});

	it('formats member counts compactly, including millions', () => {
		expect(formatMemberCount(0)).toBeNull();
		expect(formatMemberCount(null)).toBeNull();
		expect(formatMemberCount(950)).toBe('950');
		expect(formatMemberCount(4821)).toBe('4.8k');
		expect(formatMemberCount(45000)).toBe('45k');
		// Previously produced the nonsense "1000k".
		expect(formatMemberCount(1_300_000)).toBe('1.3M');
	});
});

describe('getListingHealth (operator visibility)', () => {
	it('separates "nobody opted in" from "the refresh cron died"', async () => {
		// These two states look identical at /servers — an empty page. The health
		// check is the only thing that tells them apart, so it must.
		const empty = createSqliteD1(SCHEMA);
		const noListings = await getListingHealth(empty);
		expect(noListings.optedIn).toBe(0);
		expect(noListings.visible).toBe(0);
		expect(noListings.refreshStale).toBe(true); // no metadata at all
		empty.close();

		const dead = createSqliteD1(SCHEMA);
		seed(dead, '111111111111111111', { daysStale: LISTING_FRESHNESS_DAYS + 5 });
		seed(dead, '222222222222222222', { daysStale: LISTING_FRESHNESS_DAYS + 5 });
		const health = await getListingHealth(dead);
		expect(health.optedIn).toBe(2);
		expect(health.visible).toBe(0);
		expect(health.hiddenByStaleness).toBe(2);
		expect(health.refreshStale).toBe(true);
		expect(health.lastRefresh).toBeTruthy();
		dead.close();
	});

	it('reports a healthy directory without a warning', async () => {
		const db = createSqliteD1(SCHEMA);
		seed(db, '111111111111111111');
		seed(db, '222222222222222222');
		const health = await getListingHealth(db);
		expect(health).toMatchObject({
			optedIn: 2,
			visible: 2,
			hiddenByStaleness: 0,
			takenDown: 0,
			refreshStale: false,
		});
		db.close();
	});

	it('counts operator takedowns separately from staleness', async () => {
		const db = createSqliteD1(SCHEMA);
		seed(db, '111111111111111111');
		seed(db, '222222222222222222', { review: 'rejected' });
		seed(db, '333333333333333333', { daysStale: LISTING_FRESHNESS_DAYS + 1 });
		const health = await getListingHealth(db);
		expect(health).toMatchObject({
			optedIn: 3,
			visible: 1,
			takenDown: 1,
			hiddenByStaleness: 1,
			refreshStale: false,
		});
		db.close();
	});

	it('does not count servers that never opted in', async () => {
		const db = createSqliteD1(SCHEMA);
		seed(db, '111111111111111111', { listed: 0 });
		const health = await getListingHealth(db);
		expect(health.optedIn).toBe(0);
		expect(health.hiddenByStaleness).toBe(0);
		db.close();
	});
});
