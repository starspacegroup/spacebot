import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSqliteD1 } from './helpers/sqlite-d1.js';

// Enabling is the commands table's job and is tested there; here it is a switch.
let enabled = true;
vi.mock('../lib/db/commands.js', () => ({
	getCommandByName: vi.fn(async () => (enabled ? { name: 'timebox' } : null)),
}));

import {
	DEFAULTS,
	EMPTY_GRACE_MS,
	LONG_BREAK_EVERY,
	RESPOND_MESSAGE,
	RESPOND_UPDATE,
	advance,
	applyDeafen,
	createSession,
	endSession,
	getGoals,
	getParticipant,
	getSession,
	getSettings,
	handleTimeboxCommand,
	handleTimeboxComponent,
	isController,
	liveForVoice,
	liveSoloFor,
	nextStep,
	phaseMs,
	sweepTimebox,
	upsertSettings,
	wantsDeaf,
	type Session,
} from '../lib/server/timebox.js';

const schema = (file: string, cut?: string) => {
	const sql = readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8');
	return cut ? sql.split(cut)[0] : sql;
};
// `is_bot` was added to the live table later (0060), by an ALTER.
const SCHEMA =
	schema('0041_live_voice_states.sql') +
	'ALTER TABLE live_voice_states ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0;\n' +
	schema('0070_timebox.sql', '-- /timebox as a built-in command family') +
	schema('0071_timebox_goals.sql', 'UPDATE commands') +
	schema('0080_timebox_mute.sql');

const G = '100000000000000001';
const TEXT = '200000000000000001';
const VC = '300000000000000001';
const VC2 = '300000000000000002';
const ALICE = '400000000000000001';
const BOB = '400000000000000002';
const T0 = new Date('2026-10-14T12:00:00.000Z');
const min = (n: number) => n * 60 * 1000;
const at = (m: number) => new Date(T0.getTime() + min(m));

const CREW = String(1n << 5n); // Manage Server
const NONE = '0';

function db() {
	return createSqliteD1(SCHEMA);
}

function putVoice(d: any, userId: string, channel: string, bot = 0) {
	d.exec(
		`INSERT OR REPLACE INTO live_voice_states (guild_id, user_id, channel_id, is_bot) VALUES ('${G}','${userId}','${channel}',${bot})`
	);
}
function leaveVoice(d: any, userId: string) {
	d.exec(`DELETE FROM live_voice_states WHERE guild_id='${G}' AND user_id='${userId}'`);
}

/** A REST client that records what it was asked to do and can be told to fail. */
function fakeDiscord() {
	const log: Array<{ op: string; [k: string]: any }> = [];
	const state = {
		deaf: new Map<string, boolean>(),
		mute: new Map<string, boolean>(),
		failSetDeaf: null as null | { status: number },
	};
	const client = {
		channels: {
			send: vi.fn(async (channelId: string, payload: any) => {
				log.push({ op: 'send', channelId, payload });
				return { id: 'm-ping' };
			}),
			editMessage: vi.fn(async (channelId: string, messageId: string, patch: any) => {
				log.push({ op: 'edit', channelId, messageId, patch });
				return {};
			}),
		},
		members: {
			fetch: vi.fn(async (_g: string, userId: string) => ({
				deaf: state.deaf.get(userId) ?? false,
				mute: state.mute.get(userId) ?? false,
			})),
			setVoice: vi.fn(
				async (_g: string, userId: string, v: { deaf?: boolean; mute?: boolean }) => {
					if (state.failSetDeaf)
						throw Object.assign(new Error('nope'), state.failSetDeaf);
					if (v.deaf !== undefined) {
						state.deaf.set(userId, v.deaf);
						log.push({ op: 'deaf', userId, deaf: v.deaf });
					}
					if (v.mute !== undefined) state.mute.set(userId, v.mute);
				}
			),
			setDeaf: vi.fn(async (_g: string, userId: string, deaf: boolean) => {
				if (state.failSetDeaf) throw Object.assign(new Error('nope'), state.failSetDeaf);
				state.deaf.set(userId, deaf);
				log.push({ op: 'deaf', userId, deaf });
			}),
		},
	};
	return { client: client as any, log, state };
}

const slash = (sub: string, options: any[] = [], user = ALICE, perms = NONE) => ({
	type: 2,
	guild_id: G,
	channel_id: TEXT,
	application_id: 'app',
	token: 'tok',
	member: { user: { id: user }, permissions: perms },
	data: { name: 'timebox', options: [{ type: 1, name: sub, options }] },
});
const opt = (name: string, value: any) => ({ name, value });
const press = (action: string, id: number, user = ALICE, perms = NONE) => ({
	type: 3,
	guild_id: G,
	member: { user: { id: user }, permissions: perms },
	data: { custom_id: `timebox:${action}:${id}` },
});
const text = (r: any) => r.response.data.content as string;

async function shared(d: any, over: Partial<Parameters<typeof createSession>[1]> = {}) {
	return createSession(
		d,
		{
			guild_id: G,
			channel_id: TEXT,
			voice_channel_id: VC,
			starter_id: ALICE,
			focus: 25,
			break: 5,
			longBreak: 15,
			rounds: 4,
			control: 'crew',
			...over,
		},
		T0
	);
}

beforeEach(() => {
	enabled = true;
	// The command starts sessions at "now"; the sweep tests pass `at(n)`. Pin the clock
	// so the two agree.
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(T0);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('the schedule', () => {
	const s = (phase: any, block: number, rounds = 4) => ({ phase, block_number: block, rounds });

	it('alternates focus and break, with a long break after every fourth block', () => {
		expect(LONG_BREAK_EVERY).toBe(4);
		expect(nextStep(s('focus', 1, 8))).toEqual({ phase: 'break', block_number: 1 });
		expect(nextStep(s('focus', 4, 8))).toEqual({ phase: 'long_break', block_number: 4 });
		expect(nextStep(s('break', 1, 8))).toEqual({ phase: 'focus', block_number: 2 });
		expect(nextStep(s('long_break', 4, 8))).toEqual({ phase: 'focus', block_number: 5 });
	});

	it('finishes after the last focus block, with no break after it', () => {
		expect(nextStep(s('focus', 4, 4))).toBeNull();
		expect(nextStep(s('focus', 1, 1))).toBeNull();
	});

	it('ships with 23 minutes of focus', () => {
		expect(DEFAULTS.focus).toBe(23);
		expect(
			phaseMs({ focus_minutes: 23, break_minutes: 5, long_break_minutes: 15 }, 'focus')
		).toBe(min(23));
	});

	it('moves one block when its time has just passed', () => {
		const d = db();
		return shared(d).then((sess) => {
			const a = advance(sess, at(25));
			expect(a).toMatchObject({ phase: 'break', block_number: 1, finished: false, steps: 1 });
			expect(a.phase_started_at).toBe(at(25).toISOString());
			expect(a.phase_ends_at).toBe(at(30).toISOString());
		});
	});

	it('does not drift: a late sweep leaves the next end where the schedule put it', async () => {
		const sess = await shared(db());
		// The sweep runs 40 seconds late; the break still ends 5 minutes after the block did.
		const a = advance(sess, new Date(at(25).getTime() + 40_000));
		expect(a.phase_ends_at).toBe(at(30).toISOString());
	});

	it('after an outage walks every block that passed and reports only where it landed', async () => {
		const sess = await shared(db());
		// 25 + 5 + 25 + 5 + 25 = 85: now is 3 minutes into the third focus block's... block 3 ends at 85
		const a = advance(sess, at(88));
		expect(a).toMatchObject({ phase: 'break', block_number: 3, finished: false });
		expect(a.steps).toBe(5);
	});

	it('knows when the whole timebox ended and when', async () => {
		const sess = await shared(db(), { rounds: 2 });
		const a = advance(sess, at(500));
		expect(a.finished).toBe(true);
		// 25 + 5 + 25 = 55
		expect(a.finished_at).toBe(at(55).toISOString());
	});
});

describe('who is Crew', () => {
	it('is Manage Server, Manage Channels or Administrator', () => {
		expect(isController(String(1n << 5n))).toBe(true);
		expect(isController(String(1n << 4n))).toBe(true);
		expect(isController(String(1n << 3n))).toBe(true);
		expect(isController(String(1n << 13n))).toBe(false); // Manage Messages is not enough here
		expect(isController(undefined)).toBe(false);
	});

	it('wants a deafen during focus blocks, or all of it, or none', () => {
		expect(wantsDeaf('focus', 'focus')).toBe(true);
		expect(wantsDeaf('focus', 'break')).toBe(false);
		expect(wantsDeaf('whole', 'long_break')).toBe(true);
		expect(wantsDeaf('none', 'focus')).toBe(false);
	});
});

describe('settings', () => {
	it('falls back to the defaults and keeps what is set', async () => {
		const d = db();
		expect(await getSettings(d, G)).toEqual({
			focus: 23,
			break: 5,
			longBreak: 15,
			rounds: 1,
			control: 'crew',
		});
		await upsertSettings(d, G, { focus: 40 });
		await upsertSettings(d, G, { control: 'anyone', rounds: 6 });
		expect(await getSettings(d, G)).toEqual({
			focus: 40,
			break: 5,
			longBreak: 15,
			rounds: 6,
			control: 'anyone',
		});
	});
});

describe('/timebox start', () => {
	it('refuses where the command is not turned on', async () => {
		enabled = false;
		const r = await handleTimeboxCommand(slash('start'), db(), fakeDiscord().client);
		expect(text(r)).toMatch(/not turned on/);
	});

	it('starts a shared timebox for the voice channel the member is in', async () => {
		const d = db();
		putVoice(d, ALICE, VC);
		const r = await handleTimeboxCommand(slash('start'), d, fakeDiscord().client);
		expect(r.response.type).toBe(RESPOND_MESSAGE);
		expect(r.response.data.flags).toBeUndefined(); // public: the channel sees it
		expect(r.response.data.content).toContain(`<#${VC}>`);
		const s = (await liveForVoice(d, G, VC)) as Session;
		expect(s).toMatchObject({
			kind: 'shared',
			focus_minutes: 23,
			rounds: 1,
			starter_id: ALICE,
		});
		expect(r.after).toBeDefined(); // stores the card's message id
	});

	it('starts a solo one outside voice, privately, and only one at a time', async () => {
		const d = db();
		const r = await handleTimeboxCommand(slash('start'), d, fakeDiscord().client);
		expect(r.response.data.flags).toBe(64);
		expect(await liveSoloFor(d, G, ALICE)).toMatchObject({
			kind: 'solo',
			voice_channel_id: null,
		});
		expect(text(await handleTimeboxCommand(slash('start'), d, fakeDiscord().client))).toMatch(
			/already have a timebox/
		);
	});

	it('goes solo when asked, even in a voice channel', async () => {
		const d = db();
		putVoice(d, ALICE, VC);
		await handleTimeboxCommand(slash('start', [opt('solo', true)]), d, fakeDiscord().client);
		expect(await liveForVoice(d, G, VC)).toBeNull();
		expect(await liveSoloFor(d, G, ALICE)).not.toBeNull();
	});

	it('allows one shared timebox per voice channel and points the second person at the card', async () => {
		const d = db();
		putVoice(d, ALICE, VC);
		putVoice(d, BOB, VC);
		await handleTimeboxCommand(slash('start'), d, fakeDiscord().client);
		const r = await handleTimeboxCommand(slash('start', [], BOB), d, fakeDiscord().client);
		expect(text(r)).toMatch(/already running/);
		expect(text(r)).toMatch(/Deafen me/);
	});

	it('uses the options, and the server defaults for what is left out', async () => {
		const d = db();
		await upsertSettings(d, G, { break: 10 });
		await handleTimeboxCommand(
			slash('start', [opt('focus', 50), opt('rounds', 2)]),
			d,
			fakeDiscord().client
		);
		expect(await liveSoloFor(d, G, ALICE)).toMatchObject({
			focus_minutes: 50,
			break_minutes: 10,
			rounds: 2,
		});
	});

	it('rejects an out-of-range number without starting anything', async () => {
		const d = db();
		const r = await handleTimeboxCommand(
			slash('start', [opt('focus', 500)]),
			d,
			fakeDiscord().client
		);
		expect(text(r)).toMatch(/focus.*1 to 180/);
		expect(await liveSoloFor(d, G, ALICE)).toBeNull();
	});
});

describe('deafen me', () => {
	it('deafens a member in voice, remembering they were not deafened before', async () => {
		const d = db();
		const f = fakeDiscord();
		putVoice(d, ALICE, VC);
		const r = await handleTimeboxCommand(slash('start', [opt('deafen', 'focus')]), d, f.client);
		expect(text(r)).toMatch(/You are deafened/);
		expect(f.state.deaf.get(ALICE)).toBe(true);
		expect(f.state.mute.get(ALICE)).toBe(true);
		const s = (await liveForVoice(d, G, VC)) as Session;
		expect(await getParticipant(d, s.id, ALICE)).toMatchObject({
			applied: 1,
			prev_deaf: 0,
			prev_mute: 0,
			deafen_mode: 'focus',
		});
	});

	it('does not touch, and later does not lift, a deafen a moderator already set', async () => {
		const d = db();
		const f = fakeDiscord();
		f.state.deaf.set(ALICE, true);
		f.state.mute.set(ALICE, true);
		putVoice(d, ALICE, VC);
		await handleTimeboxCommand(slash('start', [opt('deafen', 'focus')]), d, f.client);
		const s = (await liveForVoice(d, G, VC)) as Session;
		expect(f.client.members.setVoice).not.toHaveBeenCalled();
		await handleTimeboxComponent(press('stop', s.id), d, f.client);
		expect(f.client.members.setVoice).not.toHaveBeenCalled();
		expect(f.state.deaf.get(ALICE)).toBe(true);
	});

	it('lifts its own mute with the deafen, but leaves a mute a moderator set', async () => {
		const d = db();
		const f = fakeDiscord();
		f.state.mute.set(ALICE, true);
		putVoice(d, ALICE, VC);
		await handleTimeboxCommand(slash('start', [opt('deafen', 'focus')]), d, f.client);
		const s = (await liveForVoice(d, G, VC)) as Session;
		expect(f.state.deaf.get(ALICE)).toBe(true);
		await handleTimeboxComponent(press('stop', s.id), d, f.client);
		expect(f.state.deaf.get(ALICE)).toBe(false);
		expect(f.state.mute.get(ALICE)).toBe(true);
	});

	it('waits for a member who is not in voice yet, and the sweep deafens them when they join', async () => {
		const d = db();
		const f = fakeDiscord();
		const r = await handleTimeboxCommand(slash('start', [opt('deafen', 'focus')]), d, f.client);
		expect(text(r)).toMatch(/Join a voice channel/);
		const s = (await liveSoloFor(d, G, ALICE)) as Session;
		expect(f.client.members.setVoice).not.toHaveBeenCalled();
		putVoice(d, ALICE, VC);
		const sum = await sweepTimebox(d, f.client, at(1));
		expect(sum.deafened).toBe(1);
		expect(f.state.deaf.get(ALICE)).toBe(true);
		expect((await getParticipant(d, s.id, ALICE))?.applied).toBe(1);
	});

	it('says so, and turns the option off, when it cannot deafen them', async () => {
		const d = db();
		const f = fakeDiscord();
		f.state.failSetDeaf = { status: 403 };
		putVoice(d, ALICE, VC);
		const r = await handleTimeboxCommand(slash('start', [opt('deafen', 'focus')]), d, f.client);
		expect(text(r)).toMatch(/Deafen Members/);
		const s = (await liveForVoice(d, G, VC)) as Session;
		expect(await getParticipant(d, s.id, ALICE)).toMatchObject({
			deafen_mode: 'none',
			applied: 0,
		});
	});

	it('lifts at the break and comes back for the next focus block', async () => {
		const d = db();
		const f = fakeDiscord();
		putVoice(d, ALICE, VC);
		await handleTimeboxCommand(
			slash('start', [opt('deafen', 'focus'), opt('rounds', 2)]),
			d,
			f.client
		);
		const s = (await liveForVoice(d, G, VC)) as Session;
		await sweepTimebox(d, f.client, at(24)); // 23-minute block has ended
		expect(f.state.deaf.get(ALICE)).toBe(false);
		await sweepTimebox(d, f.client, at(29)); // 5-minute break has ended
		expect(f.state.deaf.get(ALICE)).toBe(true);
		expect((await getSession(d, s.id))?.phase).toBe('focus');
	});

	it('"whole timebox" stays deafened through the breaks and lifts only at the end', async () => {
		const d = db();
		const f = fakeDiscord();
		putVoice(d, ALICE, VC);
		await handleTimeboxCommand(
			slash('start', [opt('deafen', 'whole'), opt('rounds', 1)]),
			d,
			f.client
		);
		await sweepTimebox(d, f.client, at(10));
		expect(f.state.deaf.get(ALICE)).toBe(true);
		const sum = await sweepTimebox(d, f.client, at(24));
		expect(sum.finished).toBe(1);
		expect(f.state.deaf.get(ALICE)).toBe(false);
	});

	it('the button lifts it, always, and turning it on again works', async () => {
		const d = db();
		const f = fakeDiscord();
		putVoice(d, ALICE, VC);
		await handleTimeboxCommand(slash('start', [opt('deafen', 'focus')]), d, f.client);
		const s = (await liveForVoice(d, G, VC)) as Session;
		const off = await handleTimeboxComponent(press('deafen', s.id), d, f.client);
		expect(text(off)).toMatch(/Deafen off/);
		expect(f.state.deaf.get(ALICE)).toBe(false);
		const on = await handleTimeboxComponent(press('deafen', s.id), d, f.client);
		expect(text(on)).toMatch(/Deafened/);
		expect(f.state.deaf.get(ALICE)).toBe(true);
	});

	it('a member of a shared timebox can opt in; someone outside the voice channel cannot', async () => {
		const d = db();
		const f = fakeDiscord();
		putVoice(d, ALICE, VC);
		putVoice(d, BOB, VC);
		await handleTimeboxCommand(slash('start'), d, f.client);
		const s = (await liveForVoice(d, G, VC)) as Session;
		await handleTimeboxComponent(press('deafen', s.id, BOB), d, f.client);
		expect(f.state.deaf.get(BOB)).toBe(true);
		const outsider = '400000000000000009';
		putVoice(d, outsider, VC2);
		expect(
			text(await handleTimeboxComponent(press('deafen', s.id, outsider), d, f.client))
		).toMatch(/Join the voice channel/);
	});

	it('keeps trying to lift a deafen it could not, once the member is back in voice', async () => {
		const d = db();
		const f = fakeDiscord();
		putVoice(d, ALICE, VC);
		await handleTimeboxCommand(slash('start', [opt('deafen', 'focus')]), d, f.client);
		const s = (await liveForVoice(d, G, VC)) as Session;
		leaveVoice(d, ALICE);
		f.state.failSetDeaf = { status: 400 }; // Discord: not connected to voice
		await handleTimeboxComponent(press('stop', s.id), d, f.client);
		expect(await getParticipant(d, s.id, ALICE)).toMatchObject({
			applied: 1,
			restore_pending: 1,
		});
		putVoice(d, ALICE, VC);
		f.state.failSetDeaf = null;
		const sum = await sweepTimebox(d, f.client, at(30));
		expect(sum.restored).toBe(1);
		expect(f.state.deaf.get(ALICE)).toBe(false);
		expect(await getParticipant(d, s.id, ALICE)).toMatchObject({
			applied: 0,
			restore_pending: 0,
		});
	});

	it('gives up on a deafen it cannot lift a day after the timebox ended', async () => {
		const d = db();
		const f = fakeDiscord();
		putVoice(d, ALICE, VC);
		await handleTimeboxCommand(slash('start', [opt('deafen', 'focus')]), d, f.client);
		const s = (await liveForVoice(d, G, VC)) as Session;
		leaveVoice(d, ALICE);
		f.state.failSetDeaf = { status: 400 };
		await handleTimeboxComponent(press('stop', s.id), d, f.client);
		const sum = await sweepTimebox(d, f.client, new Date(Date.now() + 25 * 3600 * 1000));
		expect(sum.restore_failed).toBe(1);
		expect(await getParticipant(d, s.id, ALICE)).toMatchObject({
			applied: 0,
			restore_pending: 0,
		});
	});

	it('pausing lifts it and resuming brings it back', async () => {
		const d = db();
		const f = fakeDiscord();
		putVoice(d, ALICE, VC);
		await handleTimeboxCommand(slash('start', [opt('deafen', 'focus')]), d, f.client);
		const s = (await liveForVoice(d, G, VC)) as Session;
		await handleTimeboxComponent(press('pause', s.id), d, f.client);
		expect(f.state.deaf.get(ALICE)).toBe(false);
		await handleTimeboxComponent(press('resume', s.id), d, f.client);
		expect(f.state.deaf.get(ALICE)).toBe(true);
	});

	it('applyDeafen reports why it did nothing', async () => {
		const d = db();
		const f = fakeDiscord();
		const s = await shared(d);
		expect(await applyDeafen(d, f.client, s, ALICE)).toBe('not_in_voice');
	});
});

describe('the buttons', () => {
	it('pause keeps the time left and resume sets a new end from it', async () => {
		const d = db();
		const f = fakeDiscord();
		const s = await shared(d);
		const paused = await handleTimeboxComponent(press('pause', s.id), d, f.client);
		expect(paused.response.type).toBe(RESPOND_UPDATE);
		const row = (await getSession(d, s.id)) as Session;
		expect(row.status).toBe('paused');
		expect(row.phase_ends_at).toBeNull();
		expect(row.paused_remaining_ms).toBeGreaterThanOrEqual(0);
		await handleTimeboxComponent(press('resume', s.id), d, f.client);
		const after = (await getSession(d, s.id)) as Session;
		expect(after.status).toBe('running');
		expect(after.phase_ends_at).not.toBeNull();
		expect(after.paused_remaining_ms).toBeNull();
	});

	it('skip moves on at once, and skipping the last block finishes it', async () => {
		const d = db();
		const f = fakeDiscord();
		const s = await shared(d, { rounds: 1 });
		const r = await handleTimeboxComponent(press('skip', s.id), d, f.client);
		expect(r.response.type).toBe(RESPOND_UPDATE);
		expect((await getSession(d, s.id))?.status).toBe('done');
		const s2 = await shared(d, { voice_channel_id: VC2, rounds: 3 });
		await handleTimeboxComponent(press('skip', s2.id), d, f.client);
		expect(await getSession(d, s2.id)).toMatchObject({
			phase: 'break',
			block_number: 1,
			status: 'running',
		});
	});

	it('stop ends it and disables the buttons on the card', async () => {
		const d = db();
		const f = fakeDiscord();
		const s = await shared(d);
		const r = await handleTimeboxComponent(press('stop', s.id), d, f.client);
		expect((await getSession(d, s.id))?.status).toBe('stopped');
		expect(r.response.data.components[0].components.every((c: any) => c.disabled)).toBe(true);
	});

	it('only the starter or Crew may control it by default', async () => {
		const d = db();
		const f = fakeDiscord();
		putVoice(d, BOB, VC);
		const s = await shared(d);
		expect(text(await handleTimeboxComponent(press('stop', s.id, BOB), d, f.client))).toMatch(
			/starter or Crew/
		);
		expect((await getSession(d, s.id))?.status).toBe('running');
		await handleTimeboxComponent(press('stop', s.id, BOB, CREW), d, f.client);
		expect((await getSession(d, s.id))?.status).toBe('stopped');
	});

	it('lets anyone in the voice channel control it when the server says so, and nobody outside it', async () => {
		const d = db();
		const f = fakeDiscord();
		putVoice(d, BOB, VC);
		const outsider = '400000000000000009';
		putVoice(d, outsider, VC2);
		const s = await shared(d, { control: 'anyone' });
		expect(
			text(await handleTimeboxComponent(press('skip', s.id, outsider), d, f.client))
		).toMatch(/Only someone in the voice channel/);
		const ok = await handleTimeboxComponent(press('skip', s.id, BOB), d, f.client);
		expect(ok.response.type).toBe(RESPOND_UPDATE);
	});

	it('says the timebox is gone or over instead of failing', async () => {
		const d = db();
		const f = fakeDiscord();
		expect(text(await handleTimeboxComponent(press('stop', 999), d, f.client))).toMatch(/gone/);
		const s = await shared(d);
		await handleTimeboxComponent(press('stop', s.id), d, f.client);
		expect(text(await handleTimeboxComponent(press('pause', s.id), d, f.client))).toMatch(
			/ended/
		);
	});
});

describe('stop, status and settings commands', () => {
	it('stop ends the timebox the member is part of', async () => {
		const d = db();
		const f = fakeDiscord();
		putVoice(d, ALICE, VC);
		await handleTimeboxCommand(slash('start'), d, f.client);
		await handleTimeboxCommand(slash('stop'), d, f.client);
		expect(await liveForVoice(d, G, VC)).toBeNull();
		expect(text(await handleTimeboxCommand(slash('stop'), d, f.client))).toMatch(/No timebox/);
	});

	it('status shows the card privately', async () => {
		const d = db();
		await handleTimeboxCommand(slash('start'), d, fakeDiscord().client);
		const r = await handleTimeboxCommand(slash('status'), d, fakeDiscord().client);
		expect(r.response.data.flags).toBe(64);
		expect(r.response.data.embeds[0].title).toContain('Focus');
	});

	it('only Crew change the defaults', async () => {
		const d = db();
		expect(
			text(await handleTimeboxCommand(slash('settings', [opt('focus', 30)]), d, null))
		).toMatch(/Only Crew/);
		const ok = await handleTimeboxCommand(
			slash('settings', [opt('focus', 30), opt('control', 'anyone')], ALICE, CREW),
			d,
			null
		);
		expect(text(ok)).toMatch(/30 min focus/);
		expect(text(ok)).toMatch(/anyone in the voice channel/);
		expect((await getSettings(d, G)).focus).toBe(30);
	});
});

describe('the sweep', () => {
	it('does nothing, cheaply, when nothing is live', async () => {
		const d = db();
		const f = fakeDiscord();
		const sum = await sweepTimebox(d, f.client, at(1));
		expect(sum).toMatchObject({ advanced: 0, finished: 0 });
		expect(f.log).toHaveLength(0);
	});

	it('moves a due shared session on, edits the card, and pings the people in the channel once', async () => {
		const d = db();
		const f = fakeDiscord();
		putVoice(d, ALICE, VC);
		putVoice(d, BOB, VC);
		putVoice(d, '400000000000000003', VC, 1); // a bot is not pinged
		const s = await shared(d);
		await d
			.prepare(`UPDATE timebox_sessions SET message_id = 'card' WHERE id = ?`)
			.bind(s.id)
			.run();
		const sum = await sweepTimebox(d, f.client, at(26));
		expect(sum.advanced).toBe(1);
		expect(await getSession(d, s.id)).toMatchObject({ phase: 'break', block_number: 1 });
		const edit = f.log.find((l) => l.op === 'edit');
		expect(edit).toMatchObject({ channelId: TEXT, messageId: 'card' });
		const ping = f.log.find((l) => l.op === 'send');
		expect(ping?.payload.allowed_mentions.users.sort()).toEqual([ALICE, BOB].sort());
		expect(ping?.payload.content).toContain('Break');
	});

	it('does not announce a block that has not ended', async () => {
		const d = db();
		const f = fakeDiscord();
		putVoice(d, ALICE, VC);
		await shared(d);
		await sweepTimebox(d, f.client, at(10));
		expect(f.log).toHaveLength(0);
	});

	it('after an outage announces only where it landed', async () => {
		const d = db();
		const f = fakeDiscord();
		putVoice(d, ALICE, VC);
		const s = await shared(d);
		await d
			.prepare(`UPDATE timebox_sessions SET message_id = 'card' WHERE id = ?`)
			.bind(s.id)
			.run();
		await sweepTimebox(d, f.client, at(88));
		expect(f.log.filter((l) => l.op === 'send')).toHaveLength(1);
		expect(await getSession(d, s.id)).toMatchObject({ block_number: 3, phase: 'break' });
	});

	it('finishes the timebox at the end of the last block and says so', async () => {
		const d = db();
		const f = fakeDiscord();
		putVoice(d, ALICE, VC);
		const s = await shared(d, { rounds: 1 });
		const sum = await sweepTimebox(d, f.client, at(26));
		expect(sum.finished).toBe(1);
		expect(await getSession(d, s.id)).toMatchObject({ status: 'done', end_reason: 'finished' });
		expect(f.log.find((l) => l.op === 'send')?.payload.content).toContain('finished');
	});

	it('a solo timebox gets a fresh card message with buttons at each change', async () => {
		const d = db();
		const f = fakeDiscord();
		await handleTimeboxCommand(slash('start'), d, f.client);
		await sweepTimebox(d, f.client, at(24));
		const send = f.log.find((l) => l.op === 'send');
		expect(send?.payload.content).toContain(`<@${ALICE}>`);
		expect(send?.payload.components).toBeDefined();
		expect(f.log.some((l) => l.op === 'edit')).toBe(false);
	});

	it('leaves a paused session alone however long it sits', async () => {
		const d = db();
		const f = fakeDiscord();
		putVoice(d, ALICE, VC);
		const s = await shared(d);
		await handleTimeboxComponent(press('pause', s.id), d, f.client);
		const sum = await sweepTimebox(d, f.client, at(600));
		expect(sum.advanced).toBe(0);
		expect((await getSession(d, s.id))?.status).toBe('paused');
	});

	it('ends a shared session after its voice channel has been empty for the grace period', async () => {
		const d = db();
		const f = fakeDiscord();
		const s = await shared(d);
		await sweepTimebox(d, f.client, at(1)); // starts the clock
		expect((await getSession(d, s.id))?.empty_since).not.toBeNull();
		expect((await getSession(d, s.id))?.status).toBe('running');
		const sum = await sweepTimebox(
			d,
			f.client,
			new Date(at(1).getTime() + EMPTY_GRACE_MS + 1000)
		);
		expect(sum.ended_empty).toBe(1);
		expect(await getSession(d, s.id)).toMatchObject({ status: 'stopped', end_reason: 'empty' });
	});

	it('forgets the empty clock if someone comes back in time', async () => {
		const d = db();
		const f = fakeDiscord();
		const s = await shared(d);
		await sweepTimebox(d, f.client, at(1));
		putVoice(d, ALICE, VC);
		await sweepTimebox(d, f.client, at(3));
		expect((await getSession(d, s.id))?.empty_since).toBeNull();
		await sweepTimebox(d, f.client, at(20));
		expect((await getSession(d, s.id))?.status).toBe('running');
	});
});

describe('goals and percent done', () => {
	const pct = (id: number, n: number, user = ALICE) => ({
		type: 3,
		guild_id: G,
		member: { user: { id: user }, permissions: NONE },
		data: { custom_id: `timebox:pct:${id}:${n}` },
	});

	it('takes a goal on start and shows it on the card', async () => {
		const d = db();
		const r = await handleTimeboxCommand(
			slash('start', [opt('goal', '  write   the intro  ')]),
			d,
			fakeDiscord().client
		);
		const s = (await liveSoloFor(d, G, ALICE)) as Session;
		expect(await getGoals(d, s.id)).toEqual([
			{ user_id: ALICE, goal: 'write the intro', percent_done: null },
		]);
		expect(r.response.data.embeds[0].description).toContain('write the intro');
	});

	it('sets and changes a goal mid-timebox, and clears the percent when the goal changes', async () => {
		const d = db();
		const f = fakeDiscord();
		await handleTimeboxCommand(slash('start', [opt('goal', 'old')]), d, f.client);
		const s = (await liveSoloFor(d, G, ALICE)) as Session;
		await handleTimeboxCommand(slash('progress', [opt('percent', 40)]), d, f.client);
		await handleTimeboxCommand(slash('goal', [opt('text', 'new')]), d, f.client);
		expect(await getGoals(d, s.id)).toEqual([
			{ user_id: ALICE, goal: 'new', percent_done: null },
		]);
	});

	it('refuses a goal with no timebox, and a percent with no goal', async () => {
		const d = db();
		const f = fakeDiscord();
		expect(
			text(await handleTimeboxCommand(slash('goal', [opt('text', 'x')]), d, f.client))
		).toMatch(/No timebox/);
		await handleTimeboxCommand(slash('start'), d, f.client);
		expect(
			text(await handleTimeboxCommand(slash('progress', [opt('percent', 50)]), d, f.client))
		).toMatch(/no goal/);
	});

	it('rejects a percent outside 0 to 100', async () => {
		const d = db();
		const f = fakeDiscord();
		await handleTimeboxCommand(slash('start', [opt('goal', 'x')]), d, f.client);
		expect(
			text(await handleTimeboxCommand(slash('progress', [opt('percent', 101)]), d, f.client))
		).toMatch(/0 to 100/);
	});

	it('asks for the percent when it ends, and records it from the button after it ended', async () => {
		const d = db();
		const f = fakeDiscord();
		await handleTimeboxCommand(slash('start', [opt('goal', 'ship it')]), d, f.client);
		const s = (await liveSoloFor(d, G, ALICE)) as Session;
		await handleTimeboxCommand(slash('stop'), d, f.client);
		const sent = f.log.filter((e) => e.op === 'send').at(-1)!.payload;
		expect(sent.content).toMatch(/How much of your goal/);
		expect(sent.components[0].components.map((c: any) => c.label)).toEqual([
			'0%',
			'25%',
			'50%',
			'75%',
			'100%',
		]);
		const r = await handleTimeboxComponent(pct(s.id, 75), d, f.client);
		expect(r.response.type).toBe(RESPOND_UPDATE);
		expect(r.response.data.embeds[0].description).toContain('**75%**');
		expect((await getGoals(d, s.id))[0].percent_done).toBe(75);
	});

	it('records /timebox progress against the timebox that just ended', async () => {
		const d = db();
		const f = fakeDiscord();
		await handleTimeboxCommand(slash('start', [opt('goal', 'ship it')]), d, f.client);
		const s = (await liveSoloFor(d, G, ALICE)) as Session;
		await handleTimeboxCommand(slash('stop'), d, f.client);
		await handleTimeboxCommand(slash('progress', [opt('percent', 100)]), d, f.client);
		expect((await getGoals(d, s.id))[0].percent_done).toBe(100);
	});

	it('keeps each member of a shared timebox to their own goal and percent', async () => {
		const d = db();
		const f = fakeDiscord();
		const s = await shared(d);
		putVoice(d, ALICE, VC);
		putVoice(d, BOB, VC);
		await handleTimeboxCommand(slash('goal', [opt('text', 'a')]), d, f.client);
		await handleTimeboxCommand(slash('goal', [opt('text', 'b')], BOB), d, f.client);
		await endSession(d, f.client, s, 'finished');
		await handleTimeboxComponent(pct(s.id, 100, BOB), d, f.client);
		expect(await getGoals(d, s.id)).toEqual([
			{ user_id: ALICE, goal: 'a', percent_done: null },
			{ user_id: BOB, goal: 'b', percent_done: 100 },
		]);
		const carol = await handleTimeboxComponent(
			pct(s.id, 50, '400000000000000009'),
			d,
			f.client
		);
		expect(text(carol)).toMatch(/nothing to rate/);
	});
});
