/**
 * Public server browser listings.
 *
 * A guild is only ever visible in the public browser when an administrator has
 * opted in (`listed = 1`) AND the operator hasn't hidden it (`review_status`).
 * Both halves are enforced in SQL here rather than in the page loads, so a new
 * caller can't accidentally publish an unlisted server.
 *
 * Public copy is admin-authored and rendered escaped by Svelte — nothing in this
 * module should ever be handed to `{@html}`.
 */

export interface GuildListing {
	guild_id: string;
	listed: number;
	headline: string | null;
	description: string | null;
	category: string | null;
	tags: string;
	invite_url: string | null;
	show_member_count: number;
	nsfw: number;
	review_status: string;
	review_note: string | null;
	listed_at: string | null;
	submitted_by: string | null;
	created_at?: string;
	updated_at?: string;
}

/** Categories offered in the admin picker and the browser's filter bar. */
export const LISTING_CATEGORIES = [
	{ value: 'community', label: 'Community' },
	{ value: 'gaming', label: 'Gaming' },
	{ value: 'tech', label: 'Tech & Programming' },
	{ value: 'creative', label: 'Art & Creative' },
	{ value: 'music', label: 'Music' },
	{ value: 'education', label: 'Education' },
	{ value: 'business', label: 'Business' },
	{ value: 'science', label: 'Science' },
	{ value: 'support', label: 'Support & Help' },
	{ value: 'other', label: 'Other' },
] as const;

export const LISTING_CATEGORY_VALUES = LISTING_CATEGORIES.map((c) => c.value) as string[];

export const LISTING_SORTS = ['recent', 'members', 'name'] as const;
export type ListingSort = (typeof LISTING_SORTS)[number];

/**
 * How stale a guild's Discord metadata may be before its listing is hidden.
 *
 * This is what actually enforces "the bot is still in this server". Nothing
 * deletes `guild_metadata` rows — the daily refresh walks `getBotGuilds()` and
 * *upserts*, stamping `fetched_at = datetime('now')` — so row existence alone is
 * never false, and a server that removed SpaceBot would otherwise stay listed
 * forever with stale data and a live invite link. A guild the bot has left stops
 * being refreshed, so its `fetched_at` freezes and the listing ages out.
 *
 * The window is generous on purpose. The refresh runs daily, so this tolerates a
 * week of consecutive Discord outages or cron failures before anything is
 * delisted — a transient failure must not empty the directory, and a real
 * removal must not stay published.
 */
export const LISTING_FRESHNESS_DAYS = 7;

export const MAX_TAGS = 8;
export const MAX_HEADLINE = 120;
export const MAX_DESCRIPTION = 1000;
export const MAX_TAG_LENGTH = 24;
export const PAGE_SIZE = 24;

/** A brand-new guild's listing state: opted out, nothing published. */
export const DEFAULT_LISTING = {
	listed: false,
	headline: '',
	description: '',
	category: 'community',
	tags: [] as string[],
	invite_url: '',
	show_member_count: true,
	nsfw: false,
	review_status: 'approved',
	review_note: null as string | null,
	listed_at: null as string | null,
};

/**
 * Discord invite links only.
 *
 * The browser renders this as an outbound link on a page we host, so an
 * unconstrained URL would turn the directory into a redirector for whatever an
 * admin pastes. Accept `discord.gg/<code>` and `discord.com/invite/<code>`
 * (plus the ptb/canary hosts) and nothing else.
 */
export function normalizeInviteUrl(value: string | null | undefined): string | null {
	const raw = String(value || '').trim();
	if (!raw) return null;

	const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
	let url: URL;
	try {
		url = new URL(withScheme);
	} catch {
		return null;
	}

	const host = url.hostname.toLowerCase().replace(/^www\./, '');
	const path = url.pathname.replace(/\/+$/, '');
	let code: string | null = null;

	if (host === 'discord.gg' || host === 'discord.com' || host === 'discordapp.com') {
		const inviteMatch = path.match(/^\/invite\/([A-Za-z0-9-]+)$/);
		if (inviteMatch) code = inviteMatch[1];
		else if (host === 'discord.gg') {
			const shortMatch = path.match(/^\/([A-Za-z0-9-]+)$/);
			if (shortMatch) code = shortMatch[1];
		}
	}

	if (!code || code.length > 64) return null;
	// Normalize every accepted form to one canonical shape.
	return `https://discord.gg/${code}`;
}

export function parseTags(value: unknown): string[] {
	let list: unknown[] = [];
	if (Array.isArray(value)) list = value;
	else if (typeof value === 'string') {
		const trimmed = value.trim();
		if (!trimmed) return [];
		if (trimmed.startsWith('[')) {
			try {
				const parsed = JSON.parse(trimmed);
				list = Array.isArray(parsed) ? parsed : [];
			} catch {
				list = trimmed.split(',');
			}
		} else {
			list = trimmed.split(',');
		}
	}

	const seen = new Set<string>();
	const tags: string[] = [];
	for (const entry of list) {
		const tag = String(entry ?? '')
			.trim()
			.replace(/\s+/g, ' ')
			.slice(0, MAX_TAG_LENGTH);
		if (!tag) continue;
		const key = tag.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		tags.push(tag);
		if (tags.length >= MAX_TAGS) break;
	}
	return tags;
}

/**
 * Validate an admin's listing submission.
 *
 * Publishing has a higher bar than saving: a draft can be blank, but a listing
 * that goes public needs a headline and a working invite, otherwise the browser
 * fills up with empty cards nobody can join.
 */
export function validateListing(input: Record<string, any>) {
	const errors: Record<string, string> = {};
	const listed = Boolean(input.listed);

	const headline = String(input.headline || '')
		.trim()
		.slice(0, MAX_HEADLINE);
	const description = String(input.description || '')
		.trim()
		.slice(0, MAX_DESCRIPTION);
	const rawCategory = String(input.category || '').trim();
	const category = LISTING_CATEGORY_VALUES.includes(rawCategory) ? rawCategory : 'community';
	const tags = parseTags(input.tags);

	const rawInvite = String(input.invite_url || '').trim();
	const invite_url = normalizeInviteUrl(rawInvite);
	if (rawInvite && !invite_url) {
		errors.invite_url = 'Use a Discord invite link (discord.gg/… or discord.com/invite/…).';
	}

	if (listed && !headline) {
		errors.headline = 'Add a short headline before publishing to the server browser.';
	}
	if (listed && !invite_url) {
		errors.invite_url =
			errors.invite_url || 'A Discord invite link is required to publish your server.';
	}

	return {
		ok: Object.keys(errors).length === 0,
		errors,
		value: {
			listed,
			headline: headline || null,
			description: description || null,
			category,
			tags,
			invite_url,
			show_member_count: Boolean(input.show_member_count),
			nsfw: Boolean(input.nsfw),
		},
	};
}

/** Row → the shape the admin form and public pages consume. */
export function mergeListing(row: GuildListing | null | undefined) {
	if (!row) return { ...DEFAULT_LISTING, tags: [] as string[] };
	return {
		listed: Boolean(row.listed),
		headline: row.headline || '',
		description: row.description || '',
		category: LISTING_CATEGORY_VALUES.includes(String(row.category))
			? String(row.category)
			: 'community',
		tags: parseTags(row.tags),
		invite_url: row.invite_url || '',
		show_member_count:
			row.show_member_count === undefined ? true : Boolean(row.show_member_count),
		nsfw: Boolean(row.nsfw),
		review_status: row.review_status || 'approved',
		review_note: row.review_note || null,
		listed_at: row.listed_at || null,
	};
}

export async function getGuildListing(db: any, guildId: string): Promise<GuildListing | null> {
	if (!db || !guildId) return null;
	try {
		return await db
			.prepare('SELECT * FROM guild_listings WHERE guild_id = ?')
			.bind(guildId)
			.first();
	} catch {
		return null;
	}
}

/**
 * Upsert a listing.
 *
 * `listed_at` is stamped the first time a server actually goes public and kept
 * afterwards, so the browser's "recently added" ordering doesn't reshuffle every
 * time an admin fixes a typo. `review_status` is operator state and is never
 * written here — an admin editing their listing can't clear a takedown.
 */
export async function saveGuildListing(
	db: any,
	guildId: string,
	listing: ReturnType<typeof validateListing>['value'],
	updatedBy: string
) {
	if (!db || !guildId) return { success: false, error: 'Missing database or guild ID' };

	const now = new Date().toISOString();
	const existing = await getGuildListing(db, guildId);
	const listedAt = listing.listed ? existing?.listed_at || now : existing?.listed_at || null;

	try {
		await db
			.prepare(
				`INSERT INTO guild_listings (
					guild_id, listed, headline, description, category, tags, invite_url,
					show_member_count, nsfw, listed_at, submitted_by, created_at, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(guild_id) DO UPDATE SET
					listed = excluded.listed,
					headline = excluded.headline,
					description = excluded.description,
					category = excluded.category,
					tags = excluded.tags,
					invite_url = excluded.invite_url,
					show_member_count = excluded.show_member_count,
					nsfw = excluded.nsfw,
					listed_at = excluded.listed_at,
					submitted_by = excluded.submitted_by,
					updated_at = excluded.updated_at`
			)
			.bind(
				guildId,
				listing.listed ? 1 : 0,
				listing.headline,
				listing.description,
				listing.category,
				JSON.stringify(listing.tags),
				listing.invite_url,
				listing.show_member_count ? 1 : 0,
				listing.nsfw ? 1 : 0,
				listedAt,
				updatedBy,
				now,
				now
			)
			.run();
		return { success: true };
	} catch (error: any) {
		return { success: false, error: error?.message || 'Failed to save listing' };
	}
}

/**
 * Shape a joined listing + metadata row for public display.
 *
 * This is the single choke point where "what the admin opted into" becomes
 * "what a visitor sees": member counts are dropped unless `show_member_count`
 * is on, and nothing outside this projection reaches the public pages.
 */
export function toPublicListing(row: Record<string, any>) {
	const showMembers = Boolean(row.show_member_count);
	const iconHash = row.icon || null;
	const bannerHash = row.banner || null;

	return {
		guild_id: String(row.guild_id),
		name: row.name || 'Discord server',
		icon_url: iconHash
			? `https://cdn.discordapp.com/icons/${row.guild_id}/${iconHash}.${iconHash.startsWith('a_') ? 'gif' : 'webp'}?size=128`
			: null,
		banner_url: bannerHash
			? `https://cdn.discordapp.com/banners/${row.guild_id}/${bannerHash}.webp?size=480`
			: null,
		headline: row.headline || '',
		description: row.description || '',
		category: row.category || 'community',
		tags: parseTags(row.tags),
		invite_url: row.invite_url || null,
		member_count: showMembers ? Number(row.approximate_member_count || 0) || null : null,
		online_count: showMembers ? Number(row.approximate_presence_count || 0) || null : null,
		nsfw: Boolean(row.nsfw),
		boost_tier: Number(row.premium_tier || 0),
		listed_at: row.listed_at || null,
	};
}

const PUBLIC_COLUMNS = `
	l.guild_id, l.headline, l.description, l.category, l.tags, l.invite_url,
	l.show_member_count, l.nsfw, l.listed_at,
	m.name, m.icon, m.banner, m.approximate_member_count, m.approximate_presence_count,
	m.premium_tier`;

/**
 * The three conditions that make a guild public, in one place so no caller can
 * publish an unlisted server by forgetting one:
 *
 *  1. `l.listed = 1`               — the admin opted in
 *  2. `l.review_status`            — the operator hasn't taken it down
 *  3. fresh `guild_metadata` row   — SpaceBot is still in the guild
 *
 * (3) is a freshness check, not just a join: `fetched_at` is stamped by
 * SQLite's `datetime('now')` on every metadata upsert, and only the bot-token
 * refresh paths (which iterate the guilds the bot is actually in) ever write it.
 * The OAuth callback deliberately does not. So a frozen `fetched_at` means
 * Discord has stopped confirming the bot's membership — see
 * LISTING_FRESHNESS_DAYS.
 */
const PUBLIC_FROM = `
	FROM guild_listings l
	JOIN guild_metadata m ON m.guild_id = l.guild_id
	WHERE l.listed = 1 AND l.review_status = 'approved'
		AND m.fetched_at >= datetime('now', '-${LISTING_FRESHNESS_DAYS} days')`;

export function buildBrowseFilters({
	q,
	category,
	includeNsfw,
}: {
	q?: string | null;
	category?: string | null;
	includeNsfw?: boolean;
}) {
	const clauses: string[] = [];
	const binds: any[] = [];

	const term = String(q || '')
		.trim()
		.slice(0, 80);
	if (term) {
		// The ESCAPE clause is required, not decorative: SQLite's LIKE has no
		// default escape character, so without it the `\` below is matched as a
		// literal backslash and the `%`/`_` stay live wildcards — which silently
		// returned zero results for any search containing one (e.g. "100%").
		clauses.push(
			`(m.name LIKE ? ESCAPE '\\' OR l.headline LIKE ? ESCAPE '\\'` +
				` OR l.description LIKE ? ESCAPE '\\' OR l.tags LIKE ? ESCAPE '\\')`
		);
		// Escape the escape character itself first, or a literal `\` in the term
		// would swallow the character after it.
		const like = `%${term.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
		binds.push(like, like, like, like);
	}

	const cat = String(category || '').trim();
	if (cat && LISTING_CATEGORY_VALUES.includes(cat)) {
		clauses.push('l.category = ?');
		binds.push(cat);
	}

	if (!includeNsfw) clauses.push('l.nsfw = 0');

	return {
		sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '',
		binds,
		term,
		category: cat,
	};
}

function orderClause(sort: string) {
	switch (sort) {
		case 'members':
			// Servers that hide their member count sort as 0 rather than jumping
			// the queue on a NULL.
			return 'ORDER BY (CASE WHEN l.show_member_count = 1 THEN COALESCE(m.approximate_member_count, 0) ELSE 0 END) DESC, l.listed_at DESC';
		case 'name':
			return 'ORDER BY m.name COLLATE NOCASE ASC';
		case 'recent':
		default:
			return 'ORDER BY l.listed_at DESC, m.name COLLATE NOCASE ASC';
	}
}

/** One page of public listings plus the total for pagination. */
export async function browsePublicListings(
	db: any,
	{
		q = '',
		category = '',
		sort = 'recent',
		page = 1,
		includeNsfw = false,
		pageSize = PAGE_SIZE,
	}: {
		q?: string;
		category?: string;
		sort?: string;
		page?: number;
		includeNsfw?: boolean;
		pageSize?: number;
	} = {}
) {
	const empty = { listings: [], total: 0, page: 1, pageSize, totalPages: 0 };
	if (!db) return empty;

	const safeSort = (LISTING_SORTS as readonly string[]).includes(sort) ? sort : 'recent';
	const safePage = Math.max(1, Math.min(200, Math.floor(Number(page) || 1)));
	// Clamp the row cap too — a caller passing a huge pageSize would turn one
	// request into a whole-table read, which is how the last D1 blowout started.
	const safePageSize = Math.max(1, Math.min(100, Math.floor(Number(pageSize) || PAGE_SIZE)));
	const filters = buildBrowseFilters({ q, category, includeNsfw });

	try {
		const countRow = await db
			.prepare(`SELECT COUNT(*) AS total ${PUBLIC_FROM}${filters.sql}`)
			.bind(...filters.binds)
			.first();
		const total = Number(countRow?.total || 0);

		const offset = (safePage - 1) * safePageSize;
		const rows =
			(
				await db
					.prepare(
						`SELECT ${PUBLIC_COLUMNS} ${PUBLIC_FROM}${filters.sql} ${orderClause(safeSort)} LIMIT ? OFFSET ?`
					)
					.bind(...filters.binds, safePageSize, offset)
					.all()
			).results || [];

		return {
			listings: rows.map(toPublicListing),
			total,
			page: safePage,
			pageSize: safePageSize,
			totalPages: Math.ceil(total / safePageSize),
		};
	} catch {
		return empty;
	}
}

/** Category counts for the browser's filter bar (respects the NSFW preference). */
export async function getCategoryCounts(db: any, includeNsfw = false) {
	if (!db) return {} as Record<string, number>;
	try {
		const filters = buildBrowseFilters({ includeNsfw });
		const rows =
			(
				await db
					.prepare(
						`SELECT l.category AS category, COUNT(*) AS count ${PUBLIC_FROM}${filters.sql} GROUP BY l.category`
					)
					.bind(...filters.binds)
					.all()
			).results || [];
		const counts: Record<string, number> = {};
		for (const row of rows) counts[String(row.category || 'other')] = Number(row.count || 0);
		return counts;
	} catch {
		return {} as Record<string, number>;
	}
}

/**
 * Operator health check for the browser.
 *
 * The freshness gate means the directory silently depends on the daily metadata
 * refresh actually running: if that job stops, every listing ages out within
 * LISTING_FRESHNESS_DAYS and the browser empties with no error anywhere. That is
 * the correct fail-closed direction — with no refresh we have no evidence any
 * bot is still installed — but it must not be *invisible*, or a broken cron
 * looks identical to "nobody has opted in yet".
 *
 * `optedIn` counts admins who asked to be listed; `visible` counts those who
 * actually are. A widening gap, or a stale `lastRefresh`, means check the cron
 * before you go looking at the listings.
 */
export async function getListingHealth(db: any) {
	const empty = {
		optedIn: 0,
		visible: 0,
		hiddenByStaleness: 0,
		takenDown: 0,
		lastRefresh: null as string | null,
		refreshStale: false,
	};
	if (!db) return empty;

	try {
		const counts = await db
			.prepare(
				`SELECT
					COUNT(*) AS opted_in,
					SUM(CASE WHEN review_status <> 'approved' THEN 1 ELSE 0 END) AS taken_down
				 FROM guild_listings WHERE listed = 1`
			)
			.first();

		const visibleRow = await db.prepare(`SELECT COUNT(*) AS visible ${PUBLIC_FROM}`).first();

		// MAX over an indexed column (idx_guild_metadata_fetched) — cheap.
		const refreshRow = await db
			.prepare(
				`SELECT MAX(fetched_at) AS last_refresh,
					MAX(fetched_at) >= datetime('now', '-${LISTING_FRESHNESS_DAYS} days') AS fresh
				 FROM guild_metadata`
			)
			.first();

		const optedIn = Number(counts?.opted_in || 0);
		const takenDown = Number(counts?.taken_down || 0);
		const visible = Number(visibleRow?.visible || 0);

		return {
			optedIn,
			visible,
			hiddenByStaleness: Math.max(0, optedIn - takenDown - visible),
			takenDown,
			lastRefresh: refreshRow?.last_refresh || null,
			refreshStale: !refreshRow?.fresh,
		};
	} catch {
		return empty;
	}
}

/** A single public listing, or null when the guild isn't published. */
export async function getPublicListing(db: any, guildId: string) {
	if (!db || !/^\d{17,20}$/.test(String(guildId || ''))) return null;
	try {
		const row = await db
			.prepare(`SELECT ${PUBLIC_COLUMNS} ${PUBLIC_FROM} AND l.guild_id = ?`)
			.bind(guildId)
			.first();
		return row ? toPublicListing(row) : null;
	} catch {
		return null;
	}
}
