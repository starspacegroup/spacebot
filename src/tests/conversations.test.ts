import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createSqliteD1 } from './helpers/sqlite-d1.js';
import {
	analyse,
	fillMissingAvatars,
	getVoicePresence,
	peakTogether,
	BIG_CHAT,
} from '$lib/db/voice-presence.js';
import {
	analyseText,
	getTextConversations,
	BIG_CONVO,
	CONVO_GAP_MS,
} from '$lib/db/text-conversations.js';

const T0 = Date.parse('2026-11-08T12:00:00Z');
const MIN = 60_000;
const sql = (t: number) => new Date(t).toISOString().slice(0, 19).replace('T', ' ');

// ---- voice -------------------------------------------------------------------------------

/** A voice session: user, channel, minutes after T0 they joined, and left (null = still there). */
const v = (
	user: string,
	channel: string,
	join: number,
	leave: number | null,
	now = T0 + 600 * MIN
) => ({
	user_id: user,
	channel_id: channel,
	channel_name: `#${channel}`,
	start: T0 + join * MIN,
	end: leave === null ? now : T0 + leave * MIN,
	closed: leave !== null,
	joined_at: sql(T0 + join * MIN),
	left_at: leave === null ? null : sql(T0 + leave * MIN),
	name: user.toUpperCase(),
	avatar: null,
	discriminator: '0',
});
const FROM = T0 - 60 * MIN;

describe('voice: who starts chats, big chats, and kills them', () => {
	it('counts a join into an empty channel as a start, and who joined them', () => {
		const out = analyse(
			[v('a', 'c1', 0, 60), v('b', 'c1', 5, 20), v('c', 'c1', 10, 30), v('b', 'c1', 40, 50)],
			FROM,
			'30d'
		);
		const a = out.starters.leaders.find((l) => l.id === 'a')!;
		expect(a).toMatchObject({ starts: 1, with_company: 1 });
		expect(out.starters.recent.find((r) => r.id === 'a')).toMatchObject({
			joined: 2, // b and c, b's second visit is the same person
			alone_seconds: 300,
		});
		// b and c joined people, so they did not start anything
		expect(out.starters.leaders.map((l) => l.id)).toEqual(['a']);
	});

	it('a big chat is people together at once, not people who dropped in one after another', () => {
		const together = analyse(
			[v('a', 'c1', 0, 60), v('b', 'c1', 1, 50), v('c', 'c1', 2, 50), v('d', 'c1', 3, 50)],
			FROM,
			'30d'
		);
		expect(together.starters.recent[0].peak).toBe(4);
		expect(together.big.map((l) => l.id)).toEqual(['a']);

		const oneByOne = analyse(
			[v('a', 'c1', 0, 60), v('b', 'c1', 1, 5), v('c', 'c1', 10, 15), v('d', 'c1', 20, 25)],
			FROM,
			'30d'
		);
		expect(oneByOne.starters.recent[0]).toMatchObject({ joined: 3, peak: 2 });
		expect(oneByOne.big).toEqual([]);
		expect(BIG_CHAT).toBe(4);
	});

	it('ignores a visit that ends before it begins, so one join is not listed twice', () => {
		const out = analyse([v('a', 'c1', 0, 30), v('a', 'c1', 0, -5)], FROM, '30d');
		expect(out.starters.total).toBe(1);
		expect(out.starters.recent).toHaveLength(1);
	});

	it('does not call it a start when someone was already there, and ignores a stale session', () => {
		const out = analyse([v('a', 'c1', -30, 100), v('b', 'c1', 0, 10)], FROM, '30d');
		expect(out.starters.leaders.map((l) => l.id)).not.toContain('b');
		// a session open for more than 12 hours is a missed leave, so b is alone
		const stale = analyse(
			[v('a', 'c1', -20 * 60, null), v('b', 'c1', 0, 10)],
			T0 - 40 * 60 * MIN,
			'30d'
		);
		expect(stale.starters.leaders.map((l) => l.id)).toContain('b');
	});

	it('a start in another channel at the same time is its own start', () => {
		const out = analyse([v('a', 'c1', 0, 30), v('b', 'c2', 1, 30)], FROM, '30d');
		expect(out.starters.leaders.map((l) => l.id).sort()).toEqual(['a', 'b']);
	});

	it('kills a chat when everyone leaves within two minutes of a join', () => {
		const out = analyse(
			[v('a', 'c1', -20, 31), v('b', 'c1', -15, 31), v('k', 'c1', 30, 60)],
			FROM,
			'30d'
		);
		expect(out.killers.leaders[0]).toMatchObject({
			id: 'k',
			kills: 1,
			partial: 0,
			people_left: 2,
		});
		expect(out.killers.recent[0]).toMatchObject({ left: 2, present: 2, emptied: true });
	});

	it('is only partial when some stay, and not a kill when a lone person leaves', () => {
		const partial = analyse(
			[v('a', 'c1', -20, 31), v('b', 'c1', -15, 90), v('k', 'c1', 30, 60)],
			FROM,
			'30d'
		);
		// a partial clear is recorded, but it does not make anyone a killer
		expect(partial.killers.leaders).toEqual([]);
		expect(partial.killers.recent[0]).toMatchObject({ left: 1, emptied: false });
		const lone = analyse([v('a', 'c1', -20, 31), v('k', 'c1', 30, 60)], FROM, '30d');
		expect(lone.killers.leaders).toEqual([]);
		expect(lone.killers.recent[0]).toMatchObject({ left: 1, present: 1 });
	});

	describe('what does not count as killing a chat', () => {
		const S = (n: number) => n / 60; // seconds, as the minutes the helper takes
		const kill = (rows: any[]) => analyse(rows, FROM, '30d').killers.leaders;

		it('a leave more than a minute after the join is not held against the joiner', () => {
			expect(
				kill([
					v('a', 'c1', -20, 30 + S(90)),
					v('b', 'c1', -15, 30 + S(90)),
					v('k', 'c1', 30, 60),
				])
			).toEqual([]);
		});

		it('a leave too fast to be a reaction is a coincidence', () => {
			expect(
				kill([
					v('a', 'c1', -20, 30 + S(3)),
					v('b', 'c1', -15, 30 + S(3)),
					v('k', 'c1', 30, 60),
				])
			).toEqual([]);
		});

		it('people who had only just arrived are passing through, not a chat', () => {
			expect(
				kill([v('a', 'c1', 29, 30.5), v('b', 'c1', 29, 30.5), v('k', 'c1', 30, 60)])
			).toEqual([]);
		});

		it('a call that ends with the joiner leaving too did not end because of them', () => {
			expect(
				kill([v('a', 'c1', -20, 30.5), v('b', 'c1', -15, 30.5), v('k', 'c1', 30, 31)])
			).toEqual([]);
		});

		it('people who moved to another channel, or came back, did not leave', () => {
			expect(
				kill([
					v('a', 'c1', -20, 30.5),
					v('b', 'c1', -15, 30.5),
					v('a', 'c2', 30.5, 60),
					v('b', 'c2', 31, 60),
					v('k', 'c1', 30, 60),
				])
			).toEqual([]);
		});

		it('still counts a real one: an established chat empties right after, and they stay', () => {
			expect(
				kill([v('a', 'c1', -20, 30.5), v('b', 'c1', -15, 30.5), v('k', 'c1', 30, 60)])[0]
			).toMatchObject({ id: 'k', kills: 1 });
		});
	});

	it('does not hold a later leave against the joiner', () => {
		const out = analyse([v('a', 'c1', -20, 40), v('k', 'c1', 30, 60)], FROM, '30d');
		expect(out.killers.leaders).toEqual([]);
	});

	it('peakTogether does not count an end and a start at the same instant as together', () => {
		expect(
			peakTogether([
				[0, 10],
				[10, 20],
			])
		).toBe(1);
		expect(
			peakTogether([
				[0, 10],
				[5, 20],
				[6, 7],
			])
		).toBe(3);
	});

	it('reads real sessions and leaves bots out', async () => {
		const sqlText = fs.readFileSync(
			path.resolve(__dirname, '../../migrations/0010_aggregated_stats.sql'),
			'utf8'
		);
		const db = createSqliteD1(
			sqlText +
				`CREATE TABLE event_logs (id INTEGER PRIMARY KEY, guild_id TEXT, event_type TEXT, actor_id TEXT, target_id TEXT, actor_name TEXT, target_name TEXT, actor_avatar TEXT, target_avatar TEXT, actor_discriminator TEXT, actor_is_bot INTEGER DEFAULT 0, channel_id TEXT, channel_name TEXT, created_at TEXT);`
		);
		const now = Date.now();
		const at = (m: number) => sql(now - m * MIN);
		db.exec(`
			INSERT INTO event_logs (id, guild_id, actor_id, actor_name, actor_is_bot) VALUES
			  (1, 'g', 'ann', 'Ann', 0), (2, 'g', 'music', 'Music', 1), (3, 'g', 'bo', 'Bo', 0);
			INSERT INTO voice_sessions (guild_id, user_id, channel_id, channel_name, joined_at, left_at, join_event_id) VALUES
			  ('g', 'music', 'c1', 'General', '${at(300)}', NULL, 2),
			  ('g', 'ann', 'c1', 'General', '${at(200)}', '${at(100)}', 1),
			  ('g', 'bo', 'c1', 'General', '${at(190)}', '${at(150)}', 3);
		`);
		const out = await getVoicePresence(db, 'g', '7d');
		// the bot was in the channel the whole time, and did not stop Ann starting it
		expect(out.starters.leaders.map((l) => [l.name, l.starts])).toEqual([['Ann', 1]]);
		expect(out.starters.recent[0]).toMatchObject({ joined: 1, name: 'Ann' });
	});
});

// ---- text --------------------------------------------------------------------------------

const m = (user: string, channel: string, min: number) => ({
	user_id: user,
	channel_id: channel,
	channel_name: `#${channel}`,
	at: T0 + min * MIN,
	created_at: sql(T0 + min * MIN),
	name: user.toUpperCase(),
	avatar: null,
	discriminator: '0',
});
/** Messages from `users` in turn, one a minute, starting at `min`. */
const talk = (channel: string, min: number, users: string[]) =>
	users.map((u, i) => m(u, channel, min + i));

describe('text: who starts conversations, big ones, and kills them', () => {
	it('splits conversations at a ten minute quiet and credits the first speaker', () => {
		const out = analyseText(
			[...talk('c1', 0, ['a', 'b']), ...talk('c1', 30, ['c', 'a'])],
			T0 - 60 * MIN,
			'30d'
		);
		expect(out.starters.total).toBe(2);
		expect(out.starters.leaders.map((l) => [l.id, l.starts, l.answered]).sort()).toEqual([
			['a', 1, 1],
			['c', 1, 1],
		]);
		expect(CONVO_GAP_MS).toBe(10 * MIN);
	});

	it('a conversation of one voice is a start nobody answered', () => {
		const out = analyseText(talk('c1', 0, ['a', 'a', 'a']), T0 - 60 * MIN, '30d');
		expect(out.starters.leaders[0]).toMatchObject({ starts: 1, answered: 0, big: 0 });
	});

	it('big takes four different people, not a long monologue', () => {
		const big = analyseText(talk('c1', 0, ['a', 'b', 'c', 'd']), T0 - 60 * MIN, '30d');
		expect(big.big.map((l) => l.id)).toEqual(['a']);
		const long = analyseText(talk('c1', 0, Array(30).fill('a')), T0 - 60 * MIN, '30d');
		expect(long.big).toEqual([]);
		expect(BIG_CONVO).toBe(4);
	});

	it('the last word of a lively conversation is a kill; a quiet one is not', () => {
		// b, c, d talk for a while; k says the last thing and nobody answers
		const lively = analyseText(
			[...talk('c1', 0, ['b', 'c', 'd', 'b', 'c', 'd']), m('k', 'c1', 7)],
			T0 - 60 * MIN,
			'30d'
		);
		expect(lively.killers[0]).toMatchObject({ id: 'k', kills: 1, lively: 1 });
		// two people chatting, k answers last: not lively enough to count
		const quiet = analyseText(
			[...talk('c1', 0, ['b', 'c', 'b']), m('k', 'c1', 4)],
			T0 - 60 * MIN,
			'30d'
		);
		expect(quiet.killers).toEqual([]);
		// someone answers k, so k killed nothing: the last word is now b's
		const answered = analyseText(
			[...talk('c1', 0, ['b', 'c', 'd', 'b', 'c', 'd']), m('k', 'c1', 7), m('b', 'c1', 8)],
			T0 - 60 * MIN,
			'30d'
		);
		expect(answered.killers.map((k) => k.id)).toEqual(['b']);
	});

	it('skips a conversation that began before the window, and flags a cut read', () => {
		const out = analyseText(talk('c1', -100, ['a', 'b']), T0 - 100 * MIN + 30_000, '30d', true);
		expect(out.starters.total).toBe(0);
		expect(out.truncated).toBe(true);
	});

	it('summarises each channel', () => {
		const out = analyseText(
			[...talk('c1', 0, ['a', 'b', 'c', 'd']), ...talk('c2', 0, ['a'])],
			T0 - 60 * MIN,
			'30d'
		);
		const c1 = out.channels.find((c) => c.channel_id === 'c1')!;
		expect(c1).toMatchObject({ messages: 4, conversations: 1, big: 1, avg_people: 4 });
	});

	it('reads real events, leaves bots out, and counts only message events', async () => {
		const db = createSqliteD1(
			`CREATE TABLE event_logs (id INTEGER PRIMARY KEY, guild_id TEXT, event_type TEXT, actor_id TEXT, target_id TEXT, actor_name TEXT, actor_avatar TEXT, actor_discriminator TEXT, actor_is_bot INTEGER DEFAULT 0, channel_id TEXT, channel_name TEXT, created_at TEXT);`
		);
		const now = Date.now();
		const ins = (
			id: number,
			type: string,
			user: string,
			name: string,
			bot: number,
			min: number
		) =>
			db.exec(
				`INSERT INTO event_logs (id, guild_id, event_type, actor_id, actor_name, actor_is_bot, channel_id, channel_name, created_at) VALUES (${id}, 'g', '${type}', '${user}', '${name}', ${bot}, 'c1', 'general', '${sql(now - min * MIN)}')`
			);
		ins(1, 'MESSAGE_CREATE', 'ann', 'Ann', 0, 300);
		ins(2, 'MESSAGE_CREATE', 'bot', 'Bot', 1, 299);
		ins(3, 'MESSAGE_CREATE', 'bo', 'Bo', 0, 298);
		ins(4, 'MESSAGE_DELETE', 'bo', 'Bo', 0, 297);
		const out = await getTextConversations(db, 'g', '7d');
		expect(out.starters.leaders).toHaveLength(1);
		expect(out.starters.leaders[0]).toMatchObject({ name: 'Ann', starts: 1, answered: 1 });
		expect(out.channels[0]).toMatchObject({ channel_name: 'general', messages: 2 });
	});
});

describe('avatars the newest event did not carry', () => {
	it('fills them from the member cache, server picture first, and keeps the ones it has', async () => {
		const db = createSqliteD1(
			`CREATE TABLE guild_members_cache (guild_id TEXT, user_id TEXT, avatar TEXT, guild_avatar TEXT);
			 INSERT INTO guild_members_cache VALUES ('g','a','hashA',NULL), ('g','b','hashB','guildB'), ('g','c','hashC',NULL);`
		);
		const people = [
			{ id: 'a', avatar: null as string | null },
			{ id: 'b', avatar: null as string | null },
			{ id: 'c', avatar: 'https://kept' as string | null },
			{ id: 'z', avatar: null as string | null },
		];
		await fillMissingAvatars(db, 'g', people);
		expect(people[0].avatar).toBe('hashA');
		expect(people[1].avatar).toContain('/guilds/g/users/b/avatars/guildB.png');
		expect(people[2].avatar).toBe('https://kept');
		expect(people[3].avatar).toBeNull();
	});
});
