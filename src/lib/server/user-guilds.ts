/**
 * Who is in which server, for the superadmin pages.
 *
 * The link comes from the guild list the dashboard already loads for a signed-in person
 * (Discord's /users/@me/guilds), kept only for servers the bot is in. It is refreshed at most
 * once an hour per person per server instance, and a server a person has left is dropped.
 */

const ADMINISTRATOR = 1n << 3n;
const MANAGE_GUILD = 1n << 5n;

export type Standing = 'owner' | 'admin' | 'manager' | 'member';

/** Strongest first. */
export const STANDINGS: Standing[] = ['owner', 'admin', 'manager', 'member'];

export interface GuildLike {
	id: string;
	owner?: boolean;
	permissions?: string | number | null;
}

/** What a person is in one server, from Discord's own flags. */
export function standingOf(guild: GuildLike): Standing {
	if (guild.owner === true) return 'owner';
	try {
		const bits = BigInt(String(guild.permissions ?? '0'));
		if ((bits & ADMINISTRATOR) === ADMINISTRATOR) return 'admin';
		if ((bits & MANAGE_GUILD) === MANAGE_GUILD) return 'manager';
	} catch {
		// Unreadable permissions grant nothing.
	}
	return 'member';
}

export const standingRank = (s: string) => {
	const i = STANDINGS.indexOf(s as Standing);
	return i === -1 ? STANDINGS.length : i;
};

const REFRESH_MS = 60 * 60 * 1000;
const seen = new Map<string, number>();

/** Test hook. */
export function clearRecordThrottle() {
	seen.clear();
}

type Db = any;

/**
 * Save a person's servers (only those the bot is in). Throttled per person. Never throws: this
 * is bookkeeping and must not slow or break a page.
 */
export async function recordUserGuilds(
	db: Db,
	userId: string | undefined,
	guilds: GuildLike[],
	botGuildIds: Set<string>,
	now: number = Date.now()
): Promise<{ written: number } | { skipped: true }> {
	if (!db || !userId || !/^\d{1,25}$/.test(userId)) return { skipped: true };
	const last = seen.get(userId);
	if (last !== undefined && now - last < REFRESH_MS) return { skipped: true };
	const mine = (guilds ?? []).filter((g) => g?.id && botGuildIds.has(g.id));
	// An empty list usually means Discord did not answer. Do not wipe what we know.
	if (mine.length === 0) return { skipped: true };
	try {
		const stamp = new Date(now).toISOString().replace('T', ' ').slice(0, 19);
		await db.batch([
			...mine.map((g) =>
				db
					.prepare(
						`INSERT INTO user_guilds (user_id, guild_id, standing, first_seen_at, seen_at)
						 VALUES (?, ?, ?, ?, ?)
						 ON CONFLICT(user_id, guild_id) DO UPDATE SET standing = excluded.standing, seen_at = excluded.seen_at`
					)
					.bind(userId, g.id, standingOf(g), stamp, stamp)
			),
			db
				.prepare(`DELETE FROM user_guilds WHERE user_id = ? AND seen_at < ?`)
				.bind(userId, stamp),
		]);
		seen.set(userId, now);
		return { written: mine.length };
	} catch {
		return { skipped: true };
	}
}

export interface UserServer {
	guild_id: string;
	standing: Standing;
	first_seen_at: string;
	seen_at: string;
	name: string | null;
	icon: string | null;
}

/** The servers one person is in, strongest standing first. */
export async function serversOfUser(db: Db, userId: string): Promise<UserServer[]> {
	if (!db) return [];
	const { results } = await db
		.prepare(
			`SELECT ug.guild_id, ug.standing, ug.first_seen_at, ug.seen_at, gm.name, gm.icon
			 FROM user_guilds ug LEFT JOIN guild_metadata gm ON gm.guild_id = ug.guild_id
			 WHERE ug.user_id = ?`
		)
		.bind(userId)
		.all();
	return sortByStanding((results ?? []) as UserServer[], (r) => r.name ?? r.guild_id);
}

export interface ServerPerson {
	user_id: string;
	standing: Standing;
	first_seen_at: string;
	seen_at: string;
	username: string | null;
	global_name: string | null;
	avatar: string | null;
	banned: number | null;
}

/** The people recorded in one server, strongest standing first. */
export async function peopleOfServer(db: Db, guildId: string): Promise<ServerPerson[]> {
	if (!db) return [];
	const { results } = await db
		.prepare(
			`SELECT ug.user_id, ug.standing, ug.first_seen_at, ug.seen_at,
			        u.username, u.global_name, u.avatar, u.banned
			 FROM user_guilds ug LEFT JOIN users u ON u.id = ug.user_id
			 WHERE ug.guild_id = ?`
		)
		.bind(guildId)
		.all();
	return sortByStanding(
		(results ?? []) as ServerPerson[],
		(r) => r.global_name ?? r.username ?? r.user_id
	);
}

/** How many people are recorded per server, for the server list. */
export async function peopleCounts(db: Db): Promise<Map<string, Record<Standing, number>>> {
	const out = new Map<string, Record<Standing, number>>();
	if (!db) return out;
	const { results } = await db
		.prepare(
			`SELECT guild_id, standing, COUNT(*) n FROM user_guilds GROUP BY guild_id, standing`
		)
		.all();
	for (const r of (results ?? []) as { guild_id: string; standing: Standing; n: number }[]) {
		const row = out.get(r.guild_id) ?? { owner: 0, admin: 0, manager: 0, member: 0 };
		if (r.standing in row) row[r.standing] = r.n;
		out.set(r.guild_id, row);
	}
	return out;
}

function sortByStanding<T extends { standing: string }>(rows: T[], label: (r: T) => string): T[] {
	return [...rows].sort(
		(a, b) =>
			standingRank(a.standing) - standingRank(b.standing) ||
			label(a).localeCompare(label(b), undefined, { sensitivity: 'base' })
	);
}
