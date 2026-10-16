import { describe, it, expect, vi, beforeEach } from 'vitest';
import { canViewChannel, VIEW_CHANNEL } from '../lib/server/channel-access.js';

let quorumOn = true;
vi.mock('../lib/db/commands.js', () => ({
	getCommandByName: vi.fn(async () => (quorumOn ? { name: 'quorum' } : null)),
}));

const q = await import('../lib/server/quorum.js');
const { quorumAct, quorumViewForViewer, QuorumAccessError } =
	await import('../lib/server/activity-quorum.js');

const G = '100000000000000001';
const ME = '200000000000000001';
const VOICE = '300000000000000001';
const PRIVATE = '300000000000000002';
const claims: any = { u: ME, i: 'i', k: 'guild', g: [G], c: VOICE, e: 9e9 };

describe('canViewChannel', () => {
	const base = { guildId: G, ownerId: null, userId: ME, guildRoles: [], memberRoles: [] };
	const everyone = (perms: bigint) => [{ id: G, permissions: String(perms) }];
	const ow = (id: string, type: number, allow = 0n, deny = 0n) => ({
		id,
		type,
		allow: String(allow),
		deny: String(deny),
	});

	it('follows @everyone', () => {
		expect(
			canViewChannel({ ...base, guildRoles: everyone(VIEW_CHANNEL), overwrites: [] })
		).toBe(true);
		expect(canViewChannel({ ...base, guildRoles: everyone(0n), overwrites: [] })).toBe(false);
	});

	it('lets the owner and administrators see everything', () => {
		const deny = [ow(G, 0, 0n, VIEW_CHANNEL)];
		expect(canViewChannel({ ...base, ownerId: ME, overwrites: deny })).toBe(true);
		expect(
			canViewChannel({
				...base,
				guildRoles: [...everyone(0n), { id: 'r', permissions: String(1n << 3n) }],
				memberRoles: ['r'],
				overwrites: deny,
			})
		).toBe(true);
	});

	it('hides a channel @everyone is denied, until a role is let in', () => {
		const roles = [...everyone(VIEW_CHANNEL), { id: 'r', permissions: '0' }];
		const overwrites = [ow(G, 0, 0n, VIEW_CHANNEL)];
		expect(canViewChannel({ ...base, guildRoles: roles, overwrites })).toBe(false);
		expect(
			canViewChannel({
				...base,
				guildRoles: roles,
				memberRoles: ['r'],
				overwrites: [...overwrites, ow('r', 0, VIEW_CHANNEL)],
			})
		).toBe(true);
	});

	it('lets a member overwrite beat the roles', () => {
		const roles = [...everyone(VIEW_CHANNEL), { id: 'r', permissions: '0' }];
		expect(
			canViewChannel({
				...base,
				guildRoles: roles,
				memberRoles: ['r'],
				overwrites: [ow('r', 0, VIEW_CHANNEL), ow(ME, 1, 0n, VIEW_CHANNEL)],
			})
		).toBe(false);
	});
});

// A fake D1 that holds questions and votes, and a fake Discord.
function world() {
	const questions: any[] = [];
	const votes: any[] = [];
	const db: any = {
		prepare(sql: string) {
			let args: any[] = [];
			const run = {
				bind(...a: any[]) {
					args = a;
					return run;
				},
				async all() {
					if (/FROM quorum_questions WHERE guild_id = \? AND status = 'open'/.test(sql))
						return { results: questions.filter((x) => x.status === 'open') };
					if (/FROM quorum_questions WHERE guild_id = \? AND status != 'open'/.test(sql))
						return { results: questions.filter((x) => x.status !== 'open') };
					return { results: [] };
				},
				async first() {
					if (/INSERT INTO quorum_questions/.test(sql)) {
						const row = {
							id: questions.length + 1,
							guild_id: args[0],
							channel_id: args[1],
							asker_id: args[2],
							question: args[3],
							quorum: args[5],
							closes_at: args[6],
							salt: args[10],
							yes_count: 0,
							no_count: 0,
							abstain_count: 0,
							status: 'open',
							result: null,
							message_id: null,
						};
						questions.push(row);
						return row;
					}
					if (/SELECT \* FROM quorum_questions WHERE id = \?/.test(sql))
						return questions.find((x) => x.id === args[0]) ?? null;
					if (/SELECT choice FROM quorum_votes/.test(sql))
						return votes.find((v) => v.q === args[0] && v.h === args[1]) ?? null;
					if (/FROM quorum_settings/.test(sql)) return null;
					return null;
				},
				async run() {
					if (/INSERT INTO quorum_votes/.test(sql)) {
						const v = votes.find((x) => x.q === args[0] && x.h === args[1]);
						if (v) v.choice = args[2];
						else votes.push({ q: args[0], h: args[1], choice: args[2] });
					}
					if (/UPDATE quorum_questions SET\s+yes_count/.test(sql)) {
						const id = args[3];
						const row = questions.find((x) => x.id === id);
						for (const [k, c] of [
							['yes_count', 'yes'],
							['no_count', 'no'],
							['abstain_count', 'abstain'],
						])
							row[k] = votes.filter((v) => v.q === id && v.choice === c).length;
					}
					if (/UPDATE quorum_questions SET message_id/.test(sql))
						questions.find((x) => x.id === args[1]).message_id = args[0];
					if (/DELETE FROM quorum_questions/.test(sql))
						questions.splice(
							questions.findIndex((x) => x.id === args[0]),
							1
						);
					return { meta: { changes: 1 } };
				},
			};
			return run;
		},
	};
	return { db, questions, votes };
}

function fakeDiscord() {
	const sent: any[] = [];
	const edits: any[] = [];
	return {
		sent,
		edits,
		channels: {
			send: vi.fn(async (c: string, p: any) => {
				sent.push({ c, p });
				return { id: 'm' + sent.length };
			}),
			pin: vi.fn(async () => {}),
			editMessage: vi.fn(async (...a: any[]) => {
				edits.push(a);
			}),
		},
	};
}

// Discord's REST for the viewer: public voice channel, a private one.
function rest(visible: Record<string, boolean>): any {
	return async (url: string) => {
		const path = url.replace('https://discord.com/api/v10', '');
		const ok = (body: any) => ({ ok: true, json: async () => body });
		if (path === `/guilds/${G}`)
			return ok({
				owner_id: 'someone',
				roles: [{ id: G, permissions: String(VIEW_CHANNEL) }],
			});
		if (path === `/guilds/${G}/members/${ME}`) return ok({ roles: [] });
		const m = path.match(/^\/channels\/(\d+)$/);
		if (m)
			return ok({
				id: m[1],
				guild_id: G,
				name: m[1] === PRIVATE ? 'staff' : 'voice-chat',
				permission_overwrites: visible[m[1]]
					? []
					: [{ id: G, type: 0, allow: '0', deny: String(VIEW_CHANNEL) }],
			});
		return { ok: false, json: async () => ({}) };
	};
}

describe('Activity Quorum', () => {
	beforeEach(() => {
		quorumOn = true;
	});

	it('refuses a server that is not in the session, or has Quorum off', async () => {
		const { db } = world();
		const deps: any = { db, discord: null, botToken: 't', fetchImpl: rest({ [VOICE]: true }) };
		await expect(
			quorumViewForViewer(deps, claims, '999999999999999999')
		).rejects.toBeInstanceOf(QuorumAccessError);
		quorumOn = false;
		await expect(quorumViewForViewer(deps, claims, G)).rejects.toMatchObject({ status: 403 });
	});

	it('asks a question: posts the card, pins it, remembers its message', async () => {
		const { db, questions } = world();
		const discord = fakeDiscord();
		const deps: any = { db, discord, botToken: 't', fetchImpl: rest({ [VOICE]: true }) };
		const out = await quorumAct(deps, claims, G, {
			action: 'ask',
			question: '  Pizza   Friday? ',
			closes: '2h',
		});
		expect(out).toEqual({ ok: true, id: 1 });
		expect(questions[0]).toMatchObject({
			question: 'Pizza Friday?',
			channel_id: VOICE,
			asker_id: ME,
			message_id: 'm1',
		});
		expect(discord.sent[0].c).toBe(VOICE);
		expect(discord.channels.pin).toHaveBeenCalled();
	});

	it('rejects empty, long and bad-duration questions, and a too-short close', async () => {
		const { db, questions } = world();
		const deps: any = {
			db,
			discord: fakeDiscord(),
			botToken: 't',
			fetchImpl: rest({ [VOICE]: true }),
		};
		const ask = (m: any) => quorumAct(deps, claims, G, { action: 'ask', ...m });
		expect(await ask({ question: '  ' })).toHaveProperty('error');
		expect(await ask({ question: 'x'.repeat(241) })).toHaveProperty('error');
		expect(await ask({ question: 'ok?', closes: 'soon' })).toHaveProperty('error');
		expect(await ask({ question: 'ok?', closes: '1m' })).toHaveProperty('error');
		expect(questions).toHaveLength(0);
	});

	it('takes the question back when the card cannot be posted', async () => {
		const { db, questions } = world();
		const discord = fakeDiscord();
		discord.channels.send = vi.fn(async () => {
			throw new Error('Missing Access');
		});
		const deps: any = { db, discord, botToken: 't', fetchImpl: rest({ [VOICE]: true }) };
		const out: any = await quorumAct(deps, claims, G, { action: 'ask', question: 'Pizza?' });
		expect(out.error).toMatch(/couldn't post/);
		expect(questions).toHaveLength(0);
	});

	it('will not ask where the viewer cannot see, or with no voice channel', async () => {
		const { db } = world();
		const deps: any = {
			db,
			discord: fakeDiscord(),
			botToken: 't',
			fetchImpl: rest({ [VOICE]: false }),
		};
		expect(await quorumAct(deps, claims, G, { action: 'ask', question: 'a?' })).toHaveProperty(
			'error'
		);
		expect(
			await quorumAct(deps, { ...claims, c: undefined }, G, { action: 'ask', question: 'a?' })
		).toHaveProperty('error');
	});

	it('votes, changes the vote, and refreshes the card', async () => {
		const { db, questions } = world();
		const discord = fakeDiscord();
		const deps: any = { db, discord, botToken: 't', fetchImpl: rest({ [VOICE]: true }) };
		await quorumAct(deps, claims, G, { action: 'ask', question: 'Pizza?' });

		expect(
			await quorumAct(deps, claims, G, { action: 'vote', question_id: 1, choice: 'yes' })
		).toEqual({ ok: true, id: 1 });
		expect(questions[0].yes_count).toBe(1);
		await quorumAct(deps, claims, G, { action: 'vote', question_id: 1, choice: 'no' });
		expect([questions[0].yes_count, questions[0].no_count]).toEqual([0, 1]);
		expect(discord.edits.length).toBe(2);

		const view = await quorumViewForViewer(deps, claims, G);
		expect(view.open[0]).toMatchObject({ id: 1, my_vote: 'no', no: 1, asked_by_me: true });
		expect(view.can_ask).toBe(true);
	});

	it('rejects an unknown choice and a closed question', async () => {
		const { db, questions } = world();
		const deps: any = {
			db,
			discord: fakeDiscord(),
			botToken: 't',
			fetchImpl: rest({ [VOICE]: true }),
		};
		await quorumAct(deps, claims, G, { action: 'ask', question: 'Pizza?' });
		expect(
			await quorumAct(deps, claims, G, { action: 'vote', question_id: 1, choice: 'maybe' })
		).toHaveProperty('error');
		questions[0].status = 'closed';
		expect(
			await quorumAct(deps, claims, G, { action: 'vote', question_id: 1, choice: 'yes' })
		).toEqual({ error: 'Voting has closed on that one.' });
	});

	it('hides a question in a private channel, and will not take a vote on it', async () => {
		const { db, questions } = world();
		questions.push({
			id: 7,
			guild_id: G,
			channel_id: PRIVATE,
			asker_id: 'x',
			question: 'Fire the mod?',
			quorum: 5,
			closes_at: new Date(Date.now() + 3600e3).toISOString(),
			salt: 's',
			yes_count: 0,
			no_count: 0,
			abstain_count: 0,
			status: 'open',
			result: null,
		});
		const deps: any = {
			db,
			discord: fakeDiscord(),
			botToken: 't',
			fetchImpl: rest({ [VOICE]: true, [PRIVATE]: false }),
		};
		const view = await quorumViewForViewer(deps, claims, G);
		expect(view.open).toHaveLength(0);
		expect(
			await quorumAct(deps, claims, G, { action: 'vote', question_id: 7, choice: 'yes' })
		).toEqual({ error: 'That question is gone.' });
		expect(questions[0].yes_count).toBe(0);
	});

	it('fails closed when Discord will not say what the viewer can see', async () => {
		const { db, questions } = world();
		questions.push({
			id: 1,
			guild_id: G,
			channel_id: VOICE,
			asker_id: 'x',
			question: 'q?',
			quorum: 5,
			closes_at: new Date(Date.now() + 3600e3).toISOString(),
			salt: 's',
			yes_count: 0,
			no_count: 0,
			abstain_count: 0,
			status: 'open',
			result: null,
		});
		const deps: any = {
			db,
			discord: fakeDiscord(),
			botToken: 't',
			fetchImpl: async () => ({ ok: false, json: async () => ({}) }),
		};
		const view = await quorumViewForViewer(deps, claims, G);
		expect(view.open).toHaveLength(0);
		expect(view.can_ask).toBe(false);
	});

	it('is registered as an Activity module gated by /quorum', async () => {
		const { ACTIVITY_MODULES } = await import('../lib/server/activity.js');
		expect(ACTIVITY_MODULES.find((m) => m.id === 'quorum')?.command).toBe('quorum');
		expect(q.CHOICES).toContain('yes');
	});
});
