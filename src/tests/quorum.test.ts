import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSqliteD1 } from './helpers/sqlite-d1.js';
import {
	DEFAULT_PROTECTED,
	DEFAULTS,
	REMIND_BEFORE_MS,
	RESPOND_MESSAGE,
	RESPOND_UPDATE,
	STALE_AFTER_MS,
	bar,
	castVote,
	closeQuestion,
	createQuestion,
	getQuestion,
	latestOpenInChannel,
	getSettings,
	handleQuorumCommand,
	handleQuorumComponent,
	isCrew,
	parseDuration,
	sweepQuorum,
	tally,
	autoMet,
	channelName,
	upsertSettings,
	voterHash,
} from '../lib/server/quorum.js';

// The real schema, so the SQL (RETURNING, ON CONFLICT, the recount) is what is
// under test. The built-in command INSERT needs the commands table, which this
// test does not care about, so only the quorum statements are run.
const MIGRATION =
	readFileSync(new URL('../../migrations/0069_quorum.sql', import.meta.url), 'utf8').split(
		'-- /quorum as a built-in command family'
	)[0] +
	readFileSync(
		new URL('../../migrations/0072_quorum_auto_action.sql', import.meta.url),
		'utf8'
	).split('UPDATE commands')[0];

function db() {
	return createSqliteD1(MIGRATION);
}

/** A REST client that records what it was asked to do. */
function fakeDiscord(opts: { ownerId?: string; failCreate?: boolean } = {}) {
	let nextId = 1000;
	const calls: Array<{ op: string; args: any[] }> = [];
	const rec =
		(op: string) =>
		async (...args: any[]) => {
			calls.push({ op, args });
			return { id: String(nextId++) };
		};
	return {
		calls,
		channels: {
			send: rec('send'),
			editMessage: rec('editMessage'),
			pin: rec('pin'),
			unpin: rec('unpin'),
			fetch: async () => ({ parent_id: 'category-1' }),
		},
		users: { dm: rec('dm') },
		guilds: {
			fetch: async () => ({
				owner_id: opts.ownerId ?? 'owner-1',
				channels: {
					create: async (...args: any[]) => {
						calls.push({ op: 'createChannel', args });
						if (opts.failCreate) throw new Error('Missing Permissions');
						return { id: String(nextId++) };
					},
				},
			}),
		},
	};
}

const GUILD = 'g1';
const CHANNEL = 'c1';

async function openQuestion(
	d,
	overrides: Partial<Parameters<typeof createQuestion>[1]> = {},
	now = new Date('2026-10-12T10:00:00Z')
) {
	return createQuestion(
		d,
		{
			guild_id: GUILD,
			channel_id: CHANNEL,
			asker_id: 'asker',
			question: 'Move game night to Saturday?',
			class: null,
			quorum: 3,
			closes_minutes: 60,
			due_minutes: 7 * 24 * 60,
			owner_kind: 'user',
			owner_id: 'asker',
			...overrides,
		},
		now
	);
}

const member = (id: string, permissions = '0', roles: string[] = []) => ({
	user: { id, username: id },
	permissions,
	roles,
});

const CREW = String(1n << 13n); // MANAGE_MESSAGES

function askBody(opts: Record<string, any>, m = member('asker')): any {
	const options = Object.entries(opts).map(([name, value]) => ({ name, value }));
	return {
		type: 2,
		guild_id: GUILD,
		channel_id: CHANNEL,
		application_id: 'app',
		token: 'tok',
		member: m,
		data: { name: 'quorum', options: [{ name: 'ask', type: 1, options }] },
	};
}

function subBody(sub: string, opts: Record<string, any> = {}, m = member('asker')) {
	const options = Object.entries(opts).map(([name, value]) => ({ name, value }));
	return {
		type: 2,
		guild_id: GUILD,
		channel_id: CHANNEL,
		member: m,
		data: { name: 'quorum', options: [{ name: sub, type: 1, options }] },
	};
}

const press = (custom_id: string, m = member('voter-1')) => ({
	type: 3,
	guild_id: GUILD,
	channel_id: CHANNEL,
	member: m,
	data: { custom_id },
});

describe('durations', () => {
	it('reads the shapes the command describes', () => {
		expect(parseDuration('24h')).toBe(1440);
		expect(parseDuration('90m')).toBe(90);
		expect(parseDuration('2d')).toBe(2880);
		expect(parseDuration('1h30m')).toBe(90);
		expect(parseDuration(' 45 ')).toBe(45);
	});
	it('rejects what is not a duration', () => {
		expect(parseDuration('soon')).toBeNull();
		expect(parseDuration('0h')).toBeNull();
		expect(parseDuration('')).toBeNull();
		expect(parseDuration('3x')).toBeNull();
	});
});

describe('tally and bar', () => {
	it('declares no winner below quorum', () => {
		const t = tally({ yes_count: 2, no_count: 0, abstain_count: 0, quorum: 3 });
		expect(t.reached).toBe(false);
		expect(t.winner).toBeNull();
	});
	it('counts abstentions toward quorum but not the decision', () => {
		const t = tally({ yes_count: 1, no_count: 0, abstain_count: 2, quorum: 3 });
		expect(t.reached).toBe(true);
		expect(t.winner).toBe('yes');
		expect(t.total).toBe(3);
	});
	it('calls a tie a tie', () => {
		expect(tally({ yes_count: 2, no_count: 2, abstain_count: 0, quorum: 1 }).winner).toBe(
			'tie'
		);
	});
	it('fills twenty cells in proportion', () => {
		expect(bar({ yes_count: 0, no_count: 0, abstain_count: 0 })).toBe('⬜'.repeat(20));
		const b = bar({ yes_count: 63, no_count: 27, abstain_count: 10 });
		expect([...b]).toHaveLength(20);
		expect(b.startsWith('🟩'.repeat(13))).toBe(true);
	});
});

describe('voting', () => {
	it('one vote per member, a second press changes it, and the counts always sum', async () => {
		const d = db();
		const q = await openQuestion(d);
		let fresh = await castVote(d, q, 'alice', 'yes');
		fresh = await castVote(d, fresh!, 'bob', 'yes');
		fresh = await castVote(d, fresh!, 'alice', 'no'); // changed her mind
		expect(fresh!.yes_count).toBe(1);
		expect(fresh!.no_count).toBe(1);
		expect(fresh!.abstain_count).toBe(0);
		const rows = await d.prepare('SELECT COUNT(*) AS n FROM quorum_votes').bind().first();
		expect(rows.n).toBe(2);
	});

	it('never stores a user id with a choice', async () => {
		const d = db();
		const q = await openQuestion(d);
		await castVote(d, q, 'alice', 'yes');
		const row = await d.prepare('SELECT * FROM quorum_votes').bind().first();
		expect(row.voter_hash).not.toContain('alice');
		expect(row.voter_hash).toHaveLength(64);
		expect(await voterHash(q.salt!, 'alice')).toBe(row.voter_hash);
		// A different question's salt makes a different hash for the same person.
		const q2 = await openQuestion(d);
		expect(await voterHash(q2.salt!, 'alice')).not.toBe(row.voter_hash);
	});

	it('refuses a vote once closed', async () => {
		const d = db();
		const q = await openQuestion(d);
		await closeQuestion(d, null, q, { reason: 'early' });
		const closed = await getQuestion(d, q.id);
		expect(await castVote(d, closed!, 'alice', 'yes')).toBeNull();
	});
});

describe('closing', () => {
	it('posts a RESULT with a winner, an owner and a due date, and unpins the card', async () => {
		const d = db();
		const discord = fakeDiscord();
		let q = await openQuestion(d);
		await d
			.prepare('UPDATE quorum_questions SET message_id = ? WHERE id = ?')
			.bind('card-1', q.id)
			.run();
		for (const [who, choice] of [
			['a', 'yes'],
			['b', 'yes'],
			['c', 'no'],
			['e', 'abstain'],
		] as const) {
			q = (await castVote(d, (await getQuestion(d, q.id))!, who, choice))!;
		}
		const closed = await closeQuestion(d, discord, q, { reason: 'deadline' });
		expect(closed!.status).toBe('closed');
		expect(closed!.result).toBe('yes');
		expect(closed!.result_message_id).toBeTruthy();

		const result = discord.calls.find((c) => c.op === 'send')!;
		const embed = result.args[1].embeds[0];
		expect(embed.title).toBe('RESULT · Move game night to Saturday?');
		expect(embed.description).toContain('**Yes** wins, 50% of 4 votes');
		expect(embed.fields.map((f) => f.name)).toEqual(['Decision', 'Owner', 'Due']);
		expect(embed.fields[1].value).toBe('<@asker>');
		expect(embed.footer.text).toContain(DEFAULTS.footer);
		expect(discord.calls.some((c) => c.op === 'unpin' && c.args[1] === 'card-1')).toBe(true);
		// The retired card has its buttons disabled.
		const edit = discord.calls.find((c) => c.op === 'editMessage')!;
		expect(edit.args[2].components[0].components.every((b) => b.disabled)).toBe(true);
	});

	it('says no quorum and names no winner below the bar', async () => {
		const d = db();
		const discord = fakeDiscord();
		let q = await openQuestion(d, { quorum: 10 });
		q = (await castVote(d, q, 'a', 'yes'))!;
		const closed = await closeQuestion(d, discord, q, { reason: 'deadline' });
		expect(closed!.status).toBe('no_quorum');
		expect(closed!.result).toBeNull();
		const embed = discord.calls.find((c) => c.op === 'send')!.args[1].embeds[0];
		expect(embed.description).toContain('No quorum');
		expect(embed.fields[0].value).toBe('No quorum');
	});

	it('forgets the voters: votes gone, salt gone, counts kept', async () => {
		const d = db();
		let q = await openQuestion(d, { quorum: 1 });
		q = (await castVote(d, q, 'a', 'yes'))!;
		await d
			.prepare('INSERT INTO quorum_reminders (question_id, user_id) VALUES (?, ?)')
			.bind(q.id, 'a')
			.run();
		await closeQuestion(d, null, q, { reason: 'early' });
		const after = await getQuestion(d, q.id);
		expect(after!.salt).toBeNull();
		expect(after!.yes_count).toBe(1);
		expect((await d.prepare('SELECT COUNT(*) AS n FROM quorum_votes').bind().first()).n).toBe(
			0
		);
		expect(
			(await d.prepare('SELECT COUNT(*) AS n FROM quorum_reminders').bind().first()).n
		).toBe(0);
	});

	it('mirrors the result to the announce channel when one is set', async () => {
		const d = db();
		const discord = fakeDiscord();
		await upsertSettings(d, GUILD, '', { announce_channel_id: 'announce' });
		let q = await openQuestion(d, { quorum: 1 });
		q = (await castVote(d, q, 'a', 'no'))!;
		await closeQuestion(d, discord, q, { reason: 'deadline' });
		const sends = discord.calls.filter((c) => c.op === 'send').map((c) => c.args[0]);
		expect(sends).toEqual([CHANNEL, 'announce']);
	});
});

describe('the sweep', () => {
	it('closes at the deadline, not before', async () => {
		const d = db();
		const discord = fakeDiscord();
		const q = await openQuestion(d, { quorum: 1 }, new Date('2026-10-12T10:00:00Z'));
		await castVote(d, q, 'a', 'yes');
		const early = await sweepQuorum(d, discord, new Date('2026-10-12T10:30:00Z'));
		expect(early.closed).toBe(0);
		expect((await getQuestion(d, q.id))!.status).toBe('open');
		const onTime = await sweepQuorum(d, discord, new Date('2026-10-12T11:00:30Z'));
		expect(onTime.closed).toBe(1);
		expect((await getQuestion(d, q.id))!.status).toBe('closed');
	});

	it('DMs only the members who pressed Remind me, once, before the close', async () => {
		const d = db();
		const discord = fakeDiscord();
		const q = await openQuestion(d, {}, new Date('2026-10-12T10:00:00Z'));
		await d
			.prepare('INSERT INTO quorum_reminders (question_id, user_id) VALUES (?, ?)')
			.bind(q.id, 'keen')
			.run();
		const tooEarly = new Date(new Date(q.closes_at).getTime() - REMIND_BEFORE_MS - 60_000);
		expect((await sweepQuorum(d, discord, tooEarly)).reminded).toBe(0);
		const inWindow = new Date(new Date(q.closes_at).getTime() - REMIND_BEFORE_MS + 1000);
		expect((await sweepQuorum(d, discord, inWindow)).reminded).toBe(1);
		expect(discord.calls.filter((c) => c.op === 'dm').map((c) => c.args[0])).toEqual(['keen']);
		// Again a minute later: nothing, the reminders went out.
		expect(
			(await sweepQuorum(d, discord, new Date(inWindow.getTime() + 60_000))).reminded
		).toBe(0);
	});

	it('nudges the owner in the channel at the due date, once, and goes stale if ignored', async () => {
		const d = db();
		const discord = fakeDiscord();
		let q = await openQuestion(
			d,
			{ quorum: 1, due_minutes: 60 },
			new Date('2026-10-12T10:00:00Z')
		);
		q = (await castVote(d, q, 'a', 'yes'))!;
		await closeQuestion(d, discord, q, {
			reason: 'early',
			now: new Date('2026-10-12T10:10:00Z'),
		});
		const due = new Date(q.due_at);
		expect((await sweepQuorum(d, discord, new Date(due.getTime() - 60_000))).nudged).toBe(0);
		expect((await sweepQuorum(d, discord, due)).nudged).toBe(1);
		expect((await sweepQuorum(d, discord, new Date(due.getTime() + 60_000))).nudged).toBe(0);
		const nudge = discord.calls.filter((c) => c.op === 'send').at(-1)!;
		expect(nudge.args[0]).toBe(CHANNEL);
		expect(nudge.args[1].content).toContain('<@asker>');
		expect(nudge.args[1].components[0].components.map((b) => b.custom_id)).toEqual([
			`quorum:followup:${q.id}:done`,
			`quorum:followup:${q.id}:stale`,
		]);
		expect(discord.calls.some((c) => c.op === 'dm')).toBe(false);
		const later = new Date(due.getTime() + STALE_AFTER_MS + 1000);
		expect((await sweepQuorum(d, discord, later)).staled).toBe(1);
		expect((await getQuestion(d, q.id))!.followup_status).toBe('stale');
	});

	it('costs nothing when nothing is open', async () => {
		const d = db();
		const discord = fakeDiscord();
		const s = await sweepQuorum(d, discord);
		expect(s).toEqual({ reminded: 0, closed: 0, nudged: 0, staled: 0, failed: 0 });
		expect(discord.calls).toEqual([]);
	});
});

describe('/quorum commands', () => {
	it('ask posts the card with four buttons and defaults the owner to the asker', async () => {
		const d = db();
		const discord = fakeDiscord();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ id: 'card-9' }), { status: 200 }))
		);
		try {
			const reply = await handleQuorumCommand(
				askBody({ question: 'Stage or voice?', closes: '2h', quorum: 30 }),
				d,
				discord
			);
			expect(reply.response.type).toBe(RESPOND_MESSAGE);
			const data = reply.response.data;
			expect(data.embeds[0].title).toBe('Stage or voice?');
			expect(data.embeds[0].fields[1].value).toBe('30 · 30 to go');
			const ids = data.components.flatMap((row) => row.components.map((b) => b.custom_id));
			expect(ids).toEqual([
				'quorum:vote:1:yes',
				'quorum:vote:1:no',
				'quorum:vote:1:abstain',
				'quorum:remind:1',
				'activity:open',
			]);
			await reply.after;
			const q = await getQuestion(d, 1);
			expect(q!.message_id).toBe('card-9');
			expect(q!.owner_id).toBe('asker');
			expect(new Date(q!.closes_at).getTime() - new Date(q!.created_at).getTime()).toBe(
				2 * 3600 * 1000
			);
			expect(discord.calls.some((c) => c.op === 'pin' && c.args[1] === 'card-9')).toBe(true);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('ask takes a role as owner when the mention resolves to one', async () => {
		const d = db();
		const body = askBody({ question: 'Q?', owner: 'role-7' });
		body.data.resolved = { roles: { 'role-7': { id: 'role-7' } } };
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('{}', { status: 500 }))
		);
		try {
			await handleQuorumCommand(body, d, fakeDiscord());
			const q = await getQuestion(d, 1);
			expect(q!.owner_kind).toBe('role');
			expect(q!.owner_id).toBe('role-7');
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('ask refuses a protected class with an ephemeral reply', async () => {
		const d = db();
		const reply = await handleQuorumCommand(
			askBody({ question: 'Spend the treasury?', class: 'money' }),
			d,
			fakeDiscord()
		);
		expect(reply.response.data.flags).toBe(64);
		expect(reply.response.data.content).toContain('owner decision');
		expect(
			await d.prepare('SELECT COUNT(*) AS n FROM quorum_questions').bind().first()
		).toEqual({ n: 0 });
		expect(DEFAULT_PROTECTED).toContain('money');
	});

	it('ask uses the channel defaults and rejects a bad duration', async () => {
		const d = db();
		await upsertSettings(d, GUILD, CHANNEL, { closes_minutes: 30, quorum: 7 });
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('{}', { status: 500 }))
		);
		try {
			await handleQuorumCommand(askBody({ question: 'Q?' }), d, fakeDiscord());
			const q = await getQuestion(d, 1);
			expect(q!.quorum).toBe(7);
			expect(new Date(q!.closes_at).getTime() - new Date(q!.created_at).getTime()).toBe(
				30 * 60 * 1000
			);
			const bad = await handleQuorumCommand(
				askBody({ question: 'Q?', closes: 'whenever' }),
				d,
				fakeDiscord()
			);
			expect(bad.response.data.flags).toBe(64);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('close is for the asker or Crew', async () => {
		const d = db();
		const discord = fakeDiscord();
		await openQuestion(d);
		const stranger = await handleQuorumCommand(
			subBody('close', {}, member('someone')),
			d,
			discord
		);
		expect(stranger.response.data.content).toContain('Only the asker or Crew');
		expect((await getQuestion(d, 1))!.status).toBe('open');
		const crew = await handleQuorumCommand(
			subBody('close', {}, member('mod', CREW)),
			d,
			discord
		);
		expect(crew.response.data.content).toContain('Closed question #1');
		expect((await getQuestion(d, 1))!.closed_reason).toBe('early');
	});

	it("settings is Crew only and the lock is the owner's", async () => {
		const d = db();
		const discord = fakeDiscord({ ownerId: 'owner-1' });
		const denied = await handleQuorumCommand(subBody('settings', { quorum: 4 }), d, discord);
		expect(denied.response.data.content).toContain('Crew only');
		const ok = await handleQuorumCommand(
			subBody(
				'settings',
				{ quorum: 4, closes: '12h', protect: 'money, legal' },
				member('mod', CREW)
			),
			d,
			discord
		);
		expect(ok.response.data.content).toContain('quorum 4');
		const s = await getSettings(d, GUILD, CHANNEL);
		expect(s.closes_minutes).toBe(720);
		expect(s.protected_classes).toEqual(['money', 'legal']);
		const notOwner = await handleQuorumCommand(
			subBody('settings', { lock: true }, member('mod', CREW)),
			d,
			discord
		);
		expect(notOwner.response.data.content).toContain('Only the server owner');
		await handleQuorumCommand(
			subBody('settings', { lock: true }, member('owner-1', CREW)),
			d,
			discord
		);
		const locked = await handleQuorumCommand(
			subBody('settings', { protect: 'none' }, member('mod', CREW)),
			d,
			discord
		);
		expect(locked.response.data.content).toContain('locked');
		expect((await getSettings(d, GUILD, CHANNEL)).protected_classes).toEqual([
			'money',
			'legal',
		]);
	});

	it("veto is the owner's, public, reasoned, and logged", async () => {
		const d = db();
		const discord = fakeDiscord({ ownerId: 'owner-1' });
		let q = await openQuestion(d, { quorum: 1 });
		q = (await castVote(d, q, 'a', 'yes'))!;
		await closeQuestion(d, discord, q, { reason: 'deadline' });
		const notOwner = await handleQuorumCommand(
			subBody('veto', { id: 1, reason: 'no' }, member('mod', CREW)),
			d,
			discord
		);
		expect(notOwner.response.data.content).toContain('Only the server owner');
		const veto = await handleQuorumCommand(
			subBody(
				'veto',
				{ id: 1, reason: 'Clashes with the venue contract' },
				member('owner-1')
			),
			d,
			discord
		);
		expect(veto.response.data.content).toContain('Vetoed');
		expect(veto.response.data.embeds[0].description).toContain('venue contract');
		expect((await getQuestion(d, 1))!.status).toBe('vetoed');
		const logReply = await handleQuorumCommand(subBody('log'), d, discord);
		expect(logReply.response.data.embeds[0].description).toContain('vetoed');
	});

	it('results reposts the last result in the channel and log lists statuses newest first', async () => {
		const d = db();
		const discord = fakeDiscord();
		let q1 = await openQuestion(d, { quorum: 1, question: 'First?' });
		q1 = (await castVote(d, q1, 'a', 'yes'))!;
		await closeQuestion(d, discord, q1, {
			reason: 'early',
			now: new Date('2026-10-12T10:10:00Z'),
		});
		const q2 = await openQuestion(d, { quorum: 5, question: 'Second?' });
		await closeQuestion(d, discord, q2, {
			reason: 'early',
			now: new Date('2026-10-12T10:20:00Z'),
		});
		const results = await handleQuorumCommand(subBody('results'), d, discord);
		expect(results.response.data.embeds[0].title).toBe('RESULT · Second?');
		expect(results.response.data.flags).toBeUndefined();
		const logReply = await handleQuorumCommand(subBody('log'), d, discord);
		const lines = logReply.response.data.embeds[0].description.split('\n');
		expect(lines[0]).toContain('Second?');
		expect(lines[0]).toContain('no quorum');
		expect(lines[1]).toContain('**Yes** 100%');
	});
});

describe('buttons', () => {
	it('a vote updates the card in place, and the counts stay consistent', async () => {
		const d = db();
		const q = await openQuestion(d);
		const r1 = await handleQuorumComponent(
			press(`quorum:vote:${q.id}:yes`, member('v1')),
			d,
			null
		);
		expect(r1.response.type).toBe(RESPOND_UPDATE);
		expect(r1.response.data.embeds[0].fields[2].value).toBe('1');
		await handleQuorumComponent(press(`quorum:vote:${q.id}:no`, member('v2')), d, null);
		const r3 = await handleQuorumComponent(
			press(`quorum:vote:${q.id}:abstain`, member('v1')),
			d,
			null
		);
		const fresh = (await getQuestion(d, q.id))!;
		expect([fresh.yes_count, fresh.no_count, fresh.abstain_count]).toEqual([0, 1, 1]);
		expect(r3.response.data.embeds[0].fields[2].value).toBe('2');
		expect(r3.response.data.embeds[0].fields[3].value).toContain(
			'0% yes · 50% no · 50% abstain'
		);
	});

	it('a vote on a closed question gets a private no', async () => {
		const d = db();
		const q = await openQuestion(d);
		await closeQuestion(d, null, q, { reason: 'early' });
		const r = await handleQuorumComponent(press(`quorum:vote:${q.id}:yes`), d, null);
		expect(r.response.type).toBe(RESPOND_MESSAGE);
		expect(r.response.data.flags).toBe(64);
	});

	it('remind me stores the member for the DM and nothing else', async () => {
		const d = db();
		const q = await openQuestion(d);
		const r = await handleQuorumComponent(
			press(`quorum:remind:${q.id}`, member('keen')),
			d,
			null
		);
		expect(r.response.data.flags).toBe(64);
		const rows = await d.prepare('SELECT * FROM quorum_reminders').bind().all();
		expect(rows.results).toEqual([{ question_id: q.id, user_id: 'keen' }]);
	});

	it('the follow-up buttons answer to the owner or Crew only', async () => {
		const d = db();
		const q = await openQuestion(d);
		await d
			.prepare(`UPDATE quorum_questions SET followup_status = 'asked' WHERE id = ?`)
			.bind(q.id)
			.run();
		const stranger = await handleQuorumComponent(
			press(`quorum:followup:${q.id}:done`, member('x')),
			d,
			null
		);
		expect(stranger.response.data.flags).toBe(64);
		const owner = await handleQuorumComponent(
			press(`quorum:followup:${q.id}:done`, member('asker')),
			d,
			null
		);
		expect(owner.response.type).toBe(RESPOND_UPDATE);
		expect(owner.response.data.components).toEqual([]);
		expect((await getQuestion(d, q.id))!.followup_status).toBe('done');
	});
});

describe('crew', () => {
	it('is manage server, manage messages, or admin', () => {
		expect(isCrew('0')).toBe(false);
		expect(isCrew(String(1n << 13n))).toBe(true);
		expect(isCrew(String(1n << 5n))).toBe(true);
		expect(isCrew('8')).toBe(true);
		expect(isCrew(undefined)).toBe(false);
	});
});

describe('auto-action on a passing vote', () => {
	const MANAGE_CHANNELS = String(1n << 4n);
	const auto = { action: 'voice_channel' as const, name: 'Game Night', threshold: 66 };
	const turnOn = (d) => upsertSettings(d, GUILD, '', { auto_actions: true });

	async function vote(d, q, yes: number, no: number, abstain = 0) {
		let n = 0;
		for (const [count, choice] of [
			[yes, 'yes'],
			[no, 'no'],
			[abstain, 'abstain'],
		] as const) {
			for (let i = 0; i < count; i++) {
				q = (await castVote(d, (await getQuestion(d, q.id))!, `v${n++}`, choice))!;
			}
		}
		return q;
	}

	it('judges yes against yes and no, with exact integer arithmetic', () => {
		const base = { abstain_count: 0, quorum: 1, auto_threshold: 66 };
		expect(autoMet({ ...base, yes_count: 2, no_count: 1 })).toBe(true); // 66.67%
		expect(autoMet({ ...base, auto_threshold: 67, yes_count: 2, no_count: 1 })).toBe(false);
		expect(autoMet({ ...base, yes_count: 0, no_count: 0 })).toBe(false);
		// Abstentions count toward quorum, not toward the percentage.
		expect(autoMet({ ...base, yes_count: 2, no_count: 1, abstain_count: 50 })).toBe(true);
		// No quorum, no action, however lopsided.
		expect(autoMet({ ...base, quorum: 5, yes_count: 3, no_count: 0 })).toBe(false);
	});

	it('names channels the way Discord wants them', () => {
		expect(channelName('Game  Night!', false)).toBe('game-night');
		expect(channelName('Game Night', true)).toBe('Game Night');
		expect(channelName('!!!', false)).toBe('new-channel');
	});

	it('creates the channel beside the question when the vote clears the bar, and says so', async () => {
		const d = db();
		await turnOn(d);
		const discord = fakeDiscord();
		let q = await openQuestion(d, { auto });
		await d
			.prepare('UPDATE quorum_questions SET message_id = ? WHERE id = ?')
			.bind('card-1', q.id)
			.run();
		q = await vote(d, q, 4, 1, 1);
		const closed = await closeQuestion(d, discord, q, { reason: 'deadline' });
		const made = discord.calls.find((c) => c.op === 'createChannel')!;
		expect(made.args[0]).toMatchObject({ name: 'Game Night', type: 2, parent: 'category-1' });
		expect(closed).toMatchObject({ auto_status: 'done' });
		expect(closed!.auto_channel_id).toBeTruthy();
		const sent = discord.calls.filter((c) => c.op === 'send').map((c) => c.args[1]);
		expect(sent.some((m) => String(m.content).includes('created voice channel'))).toBe(true);
		const edited = discord.calls.filter((c) => c.op === 'editMessage').at(-1)!;
		expect(JSON.stringify(edited.args[2])).toContain('done');
	});

	it('does nothing when yes falls short, or quorum is missed', async () => {
		for (const [yes, no] of [
			[1, 1],
			[1, 0],
		]) {
			const d = db();
			await turnOn(d);
			const discord = fakeDiscord();
			const q = await vote(
				d,
				await openQuestion(d, { auto, quorum: yes + no === 1 ? 3 : 1 }),
				yes,
				no
			);
			const closed = await closeQuestion(d, discord, q, { reason: 'early' });
			expect(closed!.auto_status).toBe('not_met');
			expect(discord.calls.some((c) => c.op === 'createChannel')).toBe(false);
		}
	});

	it('creates a text channel with a Discord-shaped name', async () => {
		const d = db();
		await turnOn(d);
		const discord = fakeDiscord();
		const q = await vote(
			d,
			await openQuestion(d, {
				auto: { action: 'text_channel', name: 'Game Night', threshold: 51 },
			}),
			3,
			0
		);
		await closeQuestion(d, discord, q, { reason: 'early' });
		expect(discord.calls.find((c) => c.op === 'createChannel')!.args[0]).toMatchObject({
			name: 'game-night',
			type: 0,
		});
	});

	it('records a Discord refusal and says it in the channel instead of failing quietly', async () => {
		const d = db();
		await turnOn(d);
		const discord = fakeDiscord({ failCreate: true });
		const q = await vote(d, await openQuestion(d, { auto }), 3, 0);
		const closed = await closeQuestion(d, discord, q, { reason: 'early' });
		expect(closed).toMatchObject({
			status: 'closed',
			auto_status: 'failed',
			auto_channel_id: null,
		});
		const sent = discord.calls.filter((c) => c.op === 'send').map((c) => c.args[1].content);
		expect(
			sent.some((c) => /could not create the channel \(Missing Permissions\)/.test(String(c)))
		).toBe(true);
	});

	it('a question with no action behaves as before', async () => {
		const d = db();
		const discord = fakeDiscord();
		const q = await vote(d, await openQuestion(d), 3, 0);
		const closed = await closeQuestion(d, discord, q, { reason: 'early' });
		expect(closed!.auto_status).toBeNull();
		expect(discord.calls.some((c) => c.op === 'createChannel')).toBe(false);
	});

	it('only lets someone who can manage channels attach an action', async () => {
		const d = db();
		await turnOn(d);
		const opts = { question: 'Make a channel?', then: 'voice_channel', name: 'Game Night' };
		const refused = await handleQuorumCommand(askBody(opts), d, fakeDiscord());
		expect(refused.response.data.content).toMatch(/Manage Channels/);
		const ok = await handleQuorumCommand(
			askBody(opts, member('asker', MANAGE_CHANNELS)),
			d,
			fakeDiscord()
		);
		const q = (await latestOpenInChannel(d, GUILD, CHANNEL))!;
		expect(q).toMatchObject({
			auto_action: 'voice_channel',
			auto_name: 'Game Night',
			auto_threshold: 66,
		});
		expect(JSON.stringify(ok.response.data.embeds[0])).toContain('If it passes');
	});

	it('rejects a bad threshold, a missing name, and name without then', async () => {
		const d = db();
		await turnOn(d);
		const m = member('asker', MANAGE_CHANNELS);
		const run = async (o: any) =>
			(await handleQuorumCommand(askBody({ question: 'q?', ...o }, m), d, fakeDiscord()))
				.response.data.content;
		expect(await run({ then: 'voice_channel', name: 'x', if_yes: 50 })).toMatch(/51 to 100/);
		expect(await run({ then: 'voice_channel' })).toMatch(/call the channel/);
		expect(await run({ name: 'x' })).toMatch(/only go with/);
	});

	it('is off by default: nobody can attach an action until the owner turns it on', async () => {
		const d = db();
		const r = await handleQuorumCommand(
			askBody(
				{ question: 'q?', then: 'voice_channel', name: 'x' },
				member('asker', MANAGE_CHANNELS)
			),
			d,
			fakeDiscord()
		);
		expect(r.response.data.content).toMatch(/off in this server/);
		expect(await latestOpenInChannel(d, GUILD, CHANNEL)).toBeNull();
	});

	it('only the server owner can switch it on or off, and the choice sticks', async () => {
		const d = db();
		const settings = (a: any, who = 'owner-1') =>
			handleQuorumCommand(
				subBody('settings', { auto_actions: a }, member(who, CREW)),
				d,
				fakeDiscord({ ownerId: 'owner-1' })
			);
		expect((await settings(true, 'crew-1')).response.data.content).toMatch(
			/Only the server owner/
		);
		expect((await getSettings(d, GUILD, CHANNEL)).auto_actions).toBe(false);
		expect((await settings(true)).response.data.content).toMatch(/Automatic actions\*\* — on/);
		expect((await getSettings(d, GUILD, CHANNEL)).auto_actions).toBe(true);
		await settings(false);
		expect((await getSettings(d, GUILD, CHANNEL)).auto_actions).toBe(false);
	});

	it('does nothing if the owner turned it off after the question was asked', async () => {
		const d = db();
		await turnOn(d);
		const discord = fakeDiscord();
		let q = await openQuestion(d, { auto });
		q = await vote(d, q, 3, 0);
		await upsertSettings(d, GUILD, '', { auto_actions: false });
		const closed = await closeQuestion(d, discord, q, { reason: 'early' });
		expect(closed!.auto_status).toBe('disabled');
		expect(discord.calls.some((c) => c.op === 'createChannel')).toBe(false);
	});
});
