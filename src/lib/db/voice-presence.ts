/**
 * Who starts voice chats, who starts big ones, and who kills them, for a server owner.
 * Worked out from the voice sessions the bot already records, so it covers history, not
 * only what happens from now on. One read of the period's sessions, then the rest is done here.
 *
 *  - STARTS CHATS: a member joined a channel with no other person in it. Counted, with how
 *    many of those starts got company.
 *  - STARTS BIG CHATS: a start that grew to BIG_CHAT people in the channel together at once
 *    (the starter included) while the starter was still there. The peak is a true "at the
 *    same time" count, not a count of everyone who ever dropped in.
 *  - KILLS CHATS: a member joined a channel that had at least two other people in it, and
 *    they all left within two minutes. Often a coincidence once; a member who does it again
 *    and again is the point. People who left within two minutes but not everyone are counted
 *    separately as "people who left".
 *
 * Bots never count, either as the member or as another person. A bot is known from the event
 * that opened its session; a session made by the repair pass has no event and counts as a
 * person. A session still open after 12 hours is taken as a missed leave and ends at 12 hours.
 */

type Db = any;

/** People together in one channel, at once, for a start to count as a big chat. */
export const BIG_CHAT = 4;
/** How soon after someone joins another person's leaving is held against the joiner. */
export const CLEAR_WINDOW_SECONDS = 120;
/** A chat needs at least this many people there to be "killed" rather than just left. */
export const KILL_MIN_PRESENT = 2;
const STALE_MS = 12 * 3600_000;
const MAX_SESSIONS = 20_000;

export interface Person {
	id: string;
	name: string;
	avatar: string | null;
	discriminator: string;
}
export interface StarterLeader extends Person {
	starts: number;
	/** Starts that someone joined. */
	with_company: number;
	/** Starts that grew to a big chat. */
	big: number;
	/** The most people together in one of their starts, themselves included. */
	peak: number;
}
export interface Start extends Person {
	channel_name: string | null;
	joined_at: string;
	left_at: string | null;
	/** Different people who joined them while they were there. */
	joined: number;
	/** The most people together at once, them included. */
	peak: number;
	/** Seconds until the first person joined them, or null. */
	alone_seconds: number | null;
}
export interface KillerLeader extends Person {
	/** Joins after which everyone there left within the window. */
	kills: number;
	/** Joins after which some, not all, left. */
	partial: number;
	/** Different people who left within the window, summed. */
	people_left: number;
}
export interface Clear extends Person {
	channel_name: string | null;
	joined_at: string;
	left: number;
	present: number;
	emptied: boolean;
}
export interface VoicePresence {
	period: string;
	thresholds: { big_chat: number; clear_seconds: number; kill_min_present: number };
	starters: { leaders: StarterLeader[]; recent: Start[]; total: number };
	big: StarterLeader[];
	killers: { leaders: KillerLeader[]; recent: Clear[]; total: number };
}

interface Row {
	user_id: string;
	channel_id: string;
	channel_name: string | null;
	start: number;
	end: number;
	closed: boolean;
	joined_at: string;
	left_at: string | null;
	name: string | null;
	avatar: string | null;
	discriminator: string | null;
}

const ms = (sql: string) => Date.parse(sql.replace(' ', 'T') + 'Z');

function periodDays(period: string, fallback = 30): number {
	if (period === '24h') return 1;
	const m = typeof period === 'string' ? period.match(/^(\d+)d$/) : null;
	const n = m ? Number.parseInt(m[1], 10) : NaN;
	return Number.isFinite(n) && n >= 1 ? n : fallback;
}

const EMPTY = (period: string): VoicePresence => ({
	period,
	thresholds: {
		big_chat: BIG_CHAT,
		clear_seconds: CLEAR_WINDOW_SECONDS,
		kill_min_present: KILL_MIN_PRESENT,
	},
	starters: { leaders: [], recent: [], total: 0 },
	big: [],
	killers: { leaders: [], recent: [], total: 0 },
});

/** Highest number of sessions overlapping at once, from their start and end times. */
export function peakTogether(spans: Array<[number, number]>): number {
	const points: Array<[number, number]> = [];
	for (const [a, b] of spans) {
		points.push([a, 1], [b, -1]);
	}
	// an end at the same instant as a start is not "together": ends first
	points.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
	let now = 0;
	let best = 0;
	for (const [, d] of points) {
		now += d;
		best = Math.max(best, now);
	}
	return best;
}

/**
 * The pure part: sessions in, the three views out. `from` is where the period begins;
 * earlier sessions are only there to know who was already in a channel.
 */
export function analyse(
	rows: Row[],
	from: number,
	period: string,
	recentLimit = 12,
	leaderLimit = 10
): VoicePresence {
	const out = EMPTY(period);
	const byChannel = new Map<string, Row[]>();
	for (const r of rows) {
		// A visit that ends before it begins is a leftover, not a visit.
		if (r.closed && r.end < r.start) continue;
		if (!byChannel.has(r.channel_id)) byChannel.set(r.channel_id, []);
		byChannel.get(r.channel_id)!.push(r);
	}

	const starters = new Map<string, StarterLeader>();
	const killers = new Map<string, KillerLeader>();
	const starts: Start[] = [];
	const clears: Clear[] = [];
	const who = (r: Row): Person => ({
		id: r.user_id,
		name: r.name || 'Unknown member',
		avatar: r.avatar,
		discriminator: r.discriminator ?? '0',
	});

	for (const list of byChannel.values()) {
		list.sort((a, b) => a.start - b.start);
		for (let i = 0; i < list.length; i++) {
			const s = list[i];
			if (s.start < from) continue;

			// who was there when they joined
			const there = new Set<string>();
			for (let j = i - 1; j >= 0 && list[j].start >= s.start - STALE_MS; j--) {
				const o = list[j];
				if (o.user_id !== s.user_id && o.end > s.start) there.add(o.user_id);
			}
			// ties: someone who joined the same instant, listed after, counts as there too
			for (let j = i + 1; j < list.length && list[j].start === s.start; j++) {
				if (list[j].user_id !== s.user_id) there.add(list[j].user_id);
			}

			if (there.size === 0) {
				const joined = new Set<string>();
				let first: number | null = null;
				const spans: Array<[number, number]> = [[s.start, s.end]];
				for (let j = i + 1; j < list.length && list[j].start <= s.end; j++) {
					const o = list[j];
					if (o.user_id === s.user_id) continue;
					joined.add(o.user_id);
					if (first === null) first = o.start;
					spans.push([o.start, Math.min(o.end, s.end)]);
				}
				const peak = peakTogether(spans);
				starts.push({
					...who(s),
					channel_name: s.channel_name,
					joined_at: s.joined_at,
					left_at: s.left_at,
					joined: joined.size,
					peak,
					alone_seconds: first === null ? null : Math.round((first - s.start) / 1000),
				});
				const lead =
					starters.get(s.user_id) ??
					({ ...who(s), starts: 0, with_company: 0, big: 0, peak: 0 } as StarterLeader);
				lead.starts++;
				if (joined.size > 0) lead.with_company++;
				if (peak >= BIG_CHAT) lead.big++;
				lead.peak = Math.max(lead.peak, peak);
				starters.set(s.user_id, lead);
				continue;
			}

			// someone was there: did they leave soon after this join?
			const left = new Set<string>();
			const window = s.start + CLEAR_WINDOW_SECONDS * 1000;
			for (let j = i - 1; j >= 0 && list[j].start >= s.start - STALE_MS; j--) {
				const o = list[j];
				if (o.user_id === s.user_id || !o.closed) continue;
				if (o.start < s.start && o.end > s.start && o.end <= window) left.add(o.user_id);
			}
			if (left.size === 0) continue;
			const emptied = left.size >= there.size;
			clears.push({
				...who(s),
				channel_name: s.channel_name,
				joined_at: s.joined_at,
				left: left.size,
				present: there.size,
				emptied,
			});
			const k =
				killers.get(s.user_id) ??
				({ ...who(s), kills: 0, partial: 0, people_left: 0 } as KillerLeader);
			if (emptied && there.size >= KILL_MIN_PRESENT) k.kills++;
			else k.partial++;
			k.people_left += left.size;
			killers.set(s.user_id, k);
		}
	}

	const newest = <T extends { joined_at: string }>(a: T, b: T) =>
		b.joined_at.localeCompare(a.joined_at);
	starts.sort(newest);
	clears.sort(newest);
	const all = [...starters.values()];
	out.starters = {
		leaders: all
			.sort((a, b) => b.starts - a.starts || b.with_company - a.with_company)
			.slice(0, leaderLimit),
		recent: starts.slice(0, recentLimit),
		total: starts.length,
	};
	out.big = all
		.filter((l) => l.big > 0)
		.sort((a, b) => b.big - a.big || b.peak - a.peak)
		.slice(0, leaderLimit);
	out.killers = {
		leaders: [...killers.values()]
			.filter((k) => k.kills > 0 || k.partial > 0)
			.sort((a, b) => b.kills - a.kills || b.people_left - a.people_left)
			.slice(0, leaderLimit),
		recent: clears.slice(0, recentLimit),
		total: clears.length,
	};
	return out;
}

export async function getVoicePresence(
	db: Db,
	guildId: string,
	period = '30d'
): Promise<VoicePresence> {
	if (!db) return EMPTY(period);
	const hours = periodDays(period) * 24 + 12; // the extra 12 hours: who was already there
	const { results } = await db
		.prepare(
			`SELECT s.user_id, s.channel_id, s.channel_name, s.joined_at, s.left_at,
			        e.actor_name, e.actor_avatar, e.actor_discriminator,
			        COALESCE(e.actor_is_bot, 0) AS is_bot
			   FROM voice_sessions s
			   LEFT JOIN event_logs e ON e.id = s.join_event_id
			  WHERE s.guild_id = ? AND s.joined_at >= datetime('now', ?)
			  ORDER BY s.joined_at DESC LIMIT ?`
		)
		.bind(guildId, `-${hours} hours`, MAX_SESSIONS)
		.all();

	const now = Date.now();
	const rows: Row[] = [];
	for (const r of (results || []) as any[]) {
		if (r.is_bot) continue;
		const start = ms(r.joined_at);
		const closed = Boolean(r.left_at);
		rows.push({
			user_id: String(r.user_id),
			channel_id: String(r.channel_id),
			channel_name: r.channel_name ?? null,
			start,
			end: closed ? ms(r.left_at) : Math.min(now, start + STALE_MS),
			closed,
			joined_at: r.joined_at,
			left_at: r.left_at ?? null,
			name: r.actor_name ?? null,
			avatar: r.actor_avatar ?? null,
			discriminator: r.actor_discriminator ?? null,
		});
	}
	const out = analyse(rows, now - periodDays(period) * 86_400_000, period);
	await fillNames(db, guildId, out);
	await fillMissingAvatars(db, guildId, [
		...out.starters.leaders,
		...out.starters.recent,
		...out.big,
		...out.killers.leaders,
		...out.killers.recent,
	]);
	return out;
}

/** A session from the repair pass has no event to take a name from: look one up. */
async function fillNames(db: Db, guildId: string, out: VoicePresence) {
	const people = [
		...out.starters.leaders,
		...out.starters.recent,
		...out.big,
		...out.killers.leaders,
		...out.killers.recent,
	].filter((p) => p.name === 'Unknown member');
	const ids = [...new Set(people.map((p) => p.id))].slice(0, 40);
	const found = new Map<string, { name: string; avatar: string | null; d: string }>();
	for (const id of ids) {
		try {
			const r: any = await db
				.prepare(
					`SELECT COALESCE(NULLIF(actor_name, ''), NULLIF(target_name, '')) AS name,
					        COALESCE(actor_avatar, target_avatar) AS avatar,
					        COALESCE(actor_discriminator, '0') AS d
					   FROM event_logs
					  WHERE guild_id = ? AND COALESCE(actor_id, target_id) = ?
					    AND COALESCE(NULLIF(actor_name, ''), NULLIF(target_name, '')) IS NOT NULL
					  ORDER BY id DESC LIMIT 1`
				)
				.bind(guildId, id)
				.first();
			if (r?.name) found.set(id, { name: r.name, avatar: r.avatar ?? null, d: r.d });
		} catch {
			// a name is nice to have
		}
	}
	for (const p of people) {
		const f = found.get(p.id);
		if (f) {
			p.name = f.name;
			p.avatar = f.avatar;
			p.discriminator = f.d;
		}
	}
}

/**
 * A person whose newest event carried no avatar would show as the grey Discord default even
 * though they have a picture. Fill those from the member cache (server picture first).
 */
export async function fillMissingAvatars(
	db: Db,
	guildId: string,
	people: Array<{ id: string; avatar: string | null }>
) {
	const missing = people.filter((p) => !p.avatar);
	const ids = [...new Set(missing.map((p) => p.id))].slice(0, 80);
	if (!ids.length) return;
	try {
		const res: any = await db
			.prepare(
				`SELECT user_id, avatar, guild_avatar FROM guild_members_cache
				  WHERE guild_id = ? AND user_id IN (${ids.map(() => '?').join(', ')})`
			)
			.bind(guildId, ...ids)
			.all();
		const byId = new Map<string, string>();
		for (const m of res?.results ?? []) {
			if (m.guild_avatar) {
				const ext = String(m.guild_avatar).startsWith('a_') ? 'gif' : 'png';
				byId.set(
					String(m.user_id),
					`https://cdn.discordapp.com/guilds/${guildId}/users/${m.user_id}/avatars/${m.guild_avatar}.${ext}?size=64`
				);
			} else if (m.avatar) {
				byId.set(String(m.user_id), String(m.avatar));
			}
		}
		for (const p of missing) {
			const found = byId.get(p.id);
			if (found) p.avatar = found;
		}
	} catch {
		// a picture is nice to have
	}
}
