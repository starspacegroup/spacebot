/**
 * Everything the server recorded about one member, for that server's admins.
 *
 * `member-activity.ts` is the member's OWN view (counts only, nobody else's names). This is
 * the admin's view, so it names the people they spent voice time with and lists recent
 * events. It reads only what the gateway already stores; it adds no new data. Message text is
 * never shown here (the logs page is where an admin reads that).
 *
 * Every part is read on its own and flagged when it fails (`failedParts`), so a slow database
 * shows a gap, not a made-up zero. Raw rows are kept 90 days, so no window is longer.
 */

import { getMemberActivity, normalizeWindowDays, RETENTION_DAYS } from './member-activity.js';
import { log } from './logger.js';

type Db = any;

const MAX_SESSIONS = 20_000;
const STALE_MS = 12 * 3600_000;

export interface MemberIdentity {
	id: string;
	name: string;
	username: string | null;
	nickname: string | null;
	avatar: string | null;
	discriminator: string;
	bot: boolean;
	owner: boolean;
	inServer: boolean;
	joinedAt: string | null;
	createdAt: string | null;
	boostingSince: string | null;
	timeoutUntil: string | null;
	roles: Array<{ id: string; name: string; color: number }>;
}

export interface MemberAdminProfile {
	days: number;
	retentionDays: number;
	identity: MemberIdentity;
	activity: Awaited<ReturnType<typeof getMemberActivity>> | null;
	voiceChannels: Array<{ channel: string; seconds: number; visits: number }>;
	voiceRecent: Array<{
		channel: string;
		joined_at: string;
		left_at: string | null;
		seconds: number;
	}>;
	withPeople: Array<{
		id: string;
		name: string;
		avatar: string | null;
		discriminator: string;
		seconds: number;
	}>;
	messageChannels: Array<{ channel: string; messages: number }>;
	hours: { messages: number[]; voice: number[] };
	commands: Array<{ command: string; uses: number; last: string }>;
	recentEvents: Array<{
		id: number;
		type: string;
		channel: string | null;
		at: string;
		as: 'actor' | 'target';
		other: string | null;
	}>;
	moderation: Array<{ id: number; type: string; at: string; by: string | null }>;
	failedParts: string[];
}

/** Discord ids carry their creation time: (id >> 22) + the Discord epoch. */
export function accountCreatedAt(id: string): string | null {
	try {
		const ms = Number((BigInt(id) >> 22n) + 1420070400000n);
		return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
	} catch {
		return null;
	}
}

const MOD_EVENTS = [
	'MEMBER_BAN',
	'MEMBER_UNBAN',
	'MEMBER_KICK',
	'MEMBER_TIMEOUT',
	'MEMBER_UPDATE_TIMEOUT',
	'GUILD_BAN_ADD',
	'GUILD_BAN_REMOVE',
];

/** SQL times are UTC without a zone; the members cache stores ISO strings that carry one. */
const ms = (sql: string) =>
	Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(sql) ? sql : sql.replace(' ', 'T') + 'Z');
const sqlTime = (t: number) => new Date(t).toISOString().slice(0, 19).replace('T', ' ');

export async function getMemberAdminProfile(
	db: Db,
	guildId: string,
	userId: string,
	requestedDays: number = 30
): Promise<MemberAdminProfile> {
	const days = normalizeWindowDays(requestedDays);
	const since = sqlTime(Date.now() - days * 86_400_000);
	const now = Date.now();
	const failedLabels = new Set<string>();
	/** Read one part; if it throws, say so (failedParts) instead of showing a made-up zero. */
	async function safe<T>(label: string, fallback: T, run: () => Promise<T>): Promise<T> {
		try {
			return await run();
		} catch (error) {
			log.warn(`[MemberProfile] ${label} could not be read:`, error);
			failedLabels.add(label);
			return fallback;
		}
	}

	const [cacheRow, lastEvent, activity, sessions, msgChannels, msgHours, commands, events, mod] =
		await Promise.all([
			safe<any>('member', null, async () =>
				db
					.prepare(
						`SELECT username, global_name, nickname, avatar, guild_avatar, discriminator, is_bot,
						        is_owner, joined_at, premium_since, communication_disabled_until, roles
						   FROM guild_members_cache WHERE guild_id = ? AND user_id = ?`
					)
					.bind(guildId, userId)
					.first()
			),
			safe<any>('last event', null, async () =>
				db
					.prepare(
						`SELECT actor_name, actor_avatar, actor_discriminator, actor_is_bot
						   FROM event_logs WHERE guild_id = ? AND actor_id = ? AND actor_name IS NOT NULL
						  ORDER BY id DESC LIMIT 1`
					)
					.bind(guildId, userId)
					.first()
			),
			safe<any>('activity', null, () => getMemberActivity(db, guildId, userId, days)),
			safe<any[]>('voice sessions', [], async () => {
				const res = await db
					.prepare(
						`SELECT user_id, channel_id, channel_name, joined_at, left_at, COALESCE(is_bot, 0) AS is_bot
						   FROM voice_sessions
						  WHERE guild_id = ? AND joined_at >= ? AND joined_at <= datetime('now')
						  ORDER BY joined_at ASC LIMIT ?`
					)
					.bind(guildId, since, MAX_SESSIONS)
					.all();
				return res?.results ?? [];
			}),
			safe<any[]>('message channels', [], async () => {
				const res = await db
					.prepare(
						`SELECT COALESCE(channel_name, channel_id) AS channel, COUNT(*) AS messages
						   FROM event_logs
						  WHERE guild_id = ? AND actor_id = ? AND event_type = 'MESSAGE_CREATE' AND created_at >= ?
						  GROUP BY channel_id ORDER BY messages DESC LIMIT 10`
					)
					.bind(guildId, userId, since)
					.all();
				return res?.results ?? [];
			}),
			safe<any[]>('message hours', [], async () => {
				const res = await db
					.prepare(
						`SELECT CAST(strftime('%H', created_at) AS INTEGER) AS h, COUNT(*) AS n
						   FROM event_logs
						  WHERE guild_id = ? AND actor_id = ? AND event_type = 'MESSAGE_CREATE' AND created_at >= ?
						  GROUP BY h`
					)
					.bind(guildId, userId, since)
					.all();
				return res?.results ?? [];
			}),
			safe<any[]>('commands', [], async () => {
				const res = await db
					.prepare(
						`SELECT COALESCE(c.name, '#' || l.command_id) AS command, COUNT(*) AS uses, MAX(l.created_at) AS last
						   FROM command_logs l LEFT JOIN commands c ON c.id = l.command_id
						  WHERE l.guild_id = ? AND l.user_id = ? AND l.created_at >= ?
						  GROUP BY l.command_id ORDER BY uses DESC LIMIT 8`
					)
					.bind(guildId, userId, since)
					.all();
				return res?.results ?? [];
			}),
			safe<any[]>('recent events', [], async () => {
				const res = await db
					.prepare(
						`SELECT id, event_type, channel_name, created_at, actor_id, actor_name, target_name
						   FROM event_logs
						  WHERE guild_id = ? AND (actor_id = ? OR target_id = ?)
						    AND event_type <> 'MESSAGE_CREATE' AND created_at >= ?
						  ORDER BY id DESC LIMIT 30`
					)
					.bind(guildId, userId, userId, since)
					.all();
				return res?.results ?? [];
			}),
			safe<any[]>('moderation', [], async () => {
				const res = await db
					.prepare(
						`SELECT id, event_type, created_at, actor_name
						   FROM event_logs
						  WHERE guild_id = ? AND target_id = ? AND event_type IN (${MOD_EVENTS.map(() => '?').join(', ')})
						  ORDER BY id DESC LIMIT 20`
					)
					.bind(guildId, userId, ...MOD_EVENTS)
					.all();
				return res?.results ?? [];
			}),
		]);

	// ---- identity -------------------------------------------------------------------------
	const roleIds: string[] = (() => {
		try {
			const parsed = JSON.parse(cacheRow?.roles || '[]');
			return Array.isArray(parsed) ? parsed.map(String).slice(0, 60) : [];
		} catch {
			return [];
		}
	})();
	const roles = roleIds.length
		? await safe<any[]>('roles', [], async () => {
				const res = await db
					.prepare(
						`SELECT role_id, name, color FROM guild_roles_cache
						  WHERE guild_id = ? AND role_id IN (${roleIds.map(() => '?').join(', ')})
						  ORDER BY position DESC`
					)
					.bind(guildId, ...roleIds)
					.all();
				return res?.results ?? [];
			})
		: [];
	const name =
		cacheRow?.nickname ||
		cacheRow?.global_name ||
		cacheRow?.username ||
		lastEvent?.actor_name ||
		'Unknown member';
	const guildAvatar =
		cacheRow?.guild_avatar &&
		`https://cdn.discordapp.com/guilds/${guildId}/users/${userId}/avatars/${cacheRow.guild_avatar}.${String(cacheRow.guild_avatar).startsWith('a_') ? 'gif' : 'png'}?size=128`;
	const identity: MemberIdentity = {
		id: userId,
		name,
		username: cacheRow?.username ?? lastEvent?.actor_name ?? null,
		nickname: cacheRow?.nickname ?? null,
		avatar: guildAvatar || cacheRow?.avatar || lastEvent?.actor_avatar || null,
		discriminator: cacheRow?.discriminator ?? lastEvent?.actor_discriminator ?? '0',
		bot: Boolean(cacheRow?.is_bot ?? lastEvent?.actor_is_bot),
		owner: Boolean(cacheRow?.is_owner),
		inServer: Boolean(cacheRow),
		joinedAt: cacheRow?.joined_at ?? null,
		createdAt: accountCreatedAt(userId),
		boostingSince: cacheRow?.premium_since ?? null,
		timeoutUntil:
			cacheRow?.communication_disabled_until &&
			ms(cacheRow.communication_disabled_until) > now
				? cacheRow.communication_disabled_until
				: null,
		roles: roles.map((r: any) => ({
			id: String(r.role_id),
			name: r.name,
			color: r.color || 0,
		})),
	};

	// ---- voice (from the sessions already read) ----------------------------------------------
	const mine = sessions.filter((s) => s.user_id === userId);
	const endOf = (s: any) =>
		s.left_at ? ms(s.left_at) : Math.min(now, ms(s.joined_at) + STALE_MS);
	const perChannel = new Map<string, { seconds: number; visits: number }>();
	const voiceHours = new Array(24).fill(0);
	for (const s of mine) {
		const a = ms(s.joined_at);
		const b = endOf(s);
		if (!(b > a)) continue;
		const key = s.channel_name || s.channel_id;
		const c = perChannel.get(key) ?? { seconds: 0, visits: 0 };
		c.seconds += (b - a) / 1000;
		c.visits++;
		perChannel.set(key, c);
		// spread the time over the hours it covered
		for (let t = a; t < b;) {
			const next = Math.min(b, (Math.floor(t / 3_600_000) + 1) * 3_600_000);
			voiceHours[new Date(t).getUTCHours()] += (next - t) / 1000;
			t = next;
		}
	}
	const voiceChannels = [...perChannel.entries()]
		.map(([channel, v]) => ({ channel, seconds: Math.round(v.seconds), visits: v.visits }))
		.sort((x, y) => y.seconds - x.seconds)
		.slice(0, 8);
	const voiceRecent = mine
		.slice(-12)
		.reverse()
		.map((s) => ({
			channel: s.channel_name || s.channel_id,
			joined_at: s.joined_at,
			left_at: s.left_at ?? null,
			seconds: Math.max(0, Math.round((endOf(s) - ms(s.joined_at)) / 1000)),
		}));

	// who they were in voice with: overlap in the same channel, bots left out
	const together = new Map<string, number>();
	const byChannel = new Map<string, any[]>();
	for (const s of sessions) {
		if (!byChannel.has(s.channel_id)) byChannel.set(s.channel_id, []);
		byChannel.get(s.channel_id)!.push(s);
	}
	for (const s of mine) {
		const a = ms(s.joined_at);
		const b = endOf(s);
		for (const o of byChannel.get(s.channel_id) ?? []) {
			if (o.user_id === userId || o.is_bot) continue;
			const overlap = Math.min(b, endOf(o)) - Math.max(a, ms(o.joined_at));
			if (overlap > 0)
				together.set(o.user_id, (together.get(o.user_id) ?? 0) + overlap / 1000);
		}
	}
	const topIds = [...together.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8);
	const people = topIds.length
		? await safe<any[]>('people', [], async () => {
				const res = await db
					.prepare(
						`SELECT user_id, username, global_name, nickname, avatar, guild_avatar, discriminator
						   FROM guild_members_cache
						  WHERE guild_id = ? AND user_id IN (${topIds.map(() => '?').join(', ')})`
					)
					.bind(guildId, ...topIds.map(([id]) => id))
					.all();
				return res?.results ?? [];
			})
		: [];
	const personById = new Map(people.map((p: any) => [String(p.user_id), p]));
	const withPeople = topIds.map(([id, seconds]) => {
		const p: any = personById.get(id);
		return {
			id,
			name: p?.nickname || p?.global_name || p?.username || id,
			avatar: p?.avatar ?? null,
			discriminator: p?.discriminator ?? '0',
			seconds: Math.round(seconds),
		};
	});

	const messageHours = new Array(24).fill(0);
	for (const r of msgHours) messageHours[Number(r.h) % 24] = Number(r.n) || 0;

	const failedParts = [...failedLabels];

	return {
		days,
		retentionDays: RETENTION_DAYS,
		identity,
		activity: activity ?? null,
		voiceChannels,
		voiceRecent,
		withPeople,
		messageChannels: msgChannels.map((r: any) => ({
			channel: r.channel || 'unknown',
			messages: Number(r.messages) || 0,
		})),
		hours: { messages: messageHours, voice: voiceHours.map((s) => Math.round(s)) },
		commands: commands.map((r: any) => ({
			command: r.command,
			uses: Number(r.uses) || 0,
			last: r.last,
		})),
		recentEvents: events.map((r: any) => ({
			id: r.id,
			type: r.event_type,
			channel: r.channel_name ?? null,
			at: r.created_at,
			as: String(r.actor_id) === userId ? 'actor' : 'target',
			other: String(r.actor_id) === userId ? (r.target_name ?? null) : (r.actor_name ?? null),
		})),
		moderation: mod.map((r: any) => ({
			id: r.id,
			type: r.event_type,
			at: r.created_at,
			by: r.actor_name ?? null,
		})),
		failedParts,
	};
}
