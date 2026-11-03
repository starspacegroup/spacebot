import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSqliteD1 } from './helpers/sqlite-d1.js';

let enabled = true;
vi.mock('../lib/db/commands.js', () => ({
	getCommandByName: vi.fn(async () => (enabled ? { name: 'timebox' } : null)),
}));

import {
	TimeboxAccessError,
	othersForViewer,
	timeboxesForViewer,
} from '../lib/server/activity-timebox.js';
import { createSession } from '../lib/server/timebox.js';
import type { TokenClaims } from '../lib/server/activity.js';

const sql = (file: string, cut?: string) => {
	const text = readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8');
	return cut ? text.split(cut)[0] : text;
};
const SCHEMA =
	sql('0041_live_voice_states.sql') +
	'ALTER TABLE live_voice_states ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0;\n' +
	sql('0070_timebox.sql', '-- /timebox as a built-in command family') +
	sql('0080_timebox_mute.sql');

const G = '100000000000000001';
const OTHER_G = '100000000000000002';
const TEXT = '200000000000000001';
const VC = '300000000000000001';
const VC2 = '300000000000000002';
const ME = '400000000000000001';
const FRIEND = '400000000000000002';

const claims = (over: Partial<TokenClaims> = {}): TokenClaims => ({
	u: ME,
	i: 'inst',
	k: 'guild',
	g: [G],
	c: VC,
	e: 9_999_999_999,
	...over,
});

async function make(d: any, over: any = {}) {
	return createSession(d, {
		guild_id: G,
		channel_id: TEXT,
		voice_channel_id: VC,
		starter_id: FRIEND,
		focus: 23,
		break: 5,
		longBreak: 15,
		rounds: 4,
		control: 'crew',
		...over,
	});
}
const inVoice = (d: any, user: string, channel: string) =>
	d.exec(
		`INSERT OR REPLACE INTO live_voice_states (guild_id, user_id, channel_id) VALUES ('${G}','${user}','${channel}')`
	);

beforeEach(() => {
	enabled = true;
});

describe("other members' timers", () => {
	it("shows solo timers of people in the viewer's voice channel, with no ids", async () => {
		const d = createSqliteD1(SCHEMA);
		inVoice(d, ME, VC);
		inVoice(d, FRIEND, VC);
		d.exec(`UPDATE live_voice_states SET display_name = 'Riker' WHERE user_id = '${FRIEND}'`);
		await make(d, { kind: 'solo', voice_channel_id: null });
		const out = await othersForViewer(d, claims(), G);
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ name: 'Riker', phase: 'focus', status: 'running' });
		expect(JSON.stringify(out)).not.toContain(FRIEND);
	});

	it('leaves out the viewer, other channels and ended timers', async () => {
		const d = createSqliteD1(SCHEMA);
		inVoice(d, ME, VC);
		inVoice(d, FRIEND, VC2);
		await make(d, { kind: 'solo', voice_channel_id: null });
		expect(await othersForViewer(d, claims(), G)).toEqual([]);
		inVoice(d, FRIEND, VC);
		d.exec(`UPDATE timebox_sessions SET status = 'done'`);
		expect(await othersForViewer(d, claims(), G)).toEqual([]);
	});
});

describe('the Timebox tab data', () => {
	it('shows the shared timebox in the voice channel the Activity was opened in', async () => {
		const d = createSqliteD1(SCHEMA);
		const s = await make(d);
		const out = await timeboxesForViewer(d, claims(), G);
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({
			id: s.id,
			kind: 'shared',
			phase: 'focus',
			rounds: 4,
			mine: false,
		});
		expect(out[0].ends_at).toBe(
			Math.floor(new Date(s.phase_ends_at as string).getTime() / 1000)
		);
	});

	it('shows the viewer their own solo timebox, marked as theirs', async () => {
		const d = createSqliteD1(SCHEMA);
		await make(d, { voice_channel_id: null, starter_id: ME });
		const out = await timeboxesForViewer(d, claims({ k: 'dm', c: undefined }), G);
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ kind: 'solo', mine: true, voice_channel_id: null });
	});

	it("does not show someone else's solo timebox", async () => {
		const d = createSqliteD1(SCHEMA);
		await make(d, { voice_channel_id: null, starter_id: FRIEND });
		expect(await timeboxesForViewer(d, claims(), G)).toEqual([]);
	});

	it('from a DM, finds the shared timebox in the voice channel the viewer is in', async () => {
		const d = createSqliteD1(SCHEMA);
		await make(d, { voice_channel_id: VC2 });
		const dm = claims({ k: 'dm', c: undefined });
		expect(await timeboxesForViewer(d, dm, G)).toEqual([]);
		inVoice(d, ME, VC2);
		expect(await timeboxesForViewer(d, dm, G)).toHaveLength(1);
	});

	it('does not show a shared timebox in a channel the viewer has nothing to do with', async () => {
		const d = createSqliteD1(SCHEMA);
		await make(d, { voice_channel_id: VC2 });
		expect(await timeboxesForViewer(d, claims(), G)).toEqual([]);
	});

	it('does not list the same timebox twice when both routes find it', async () => {
		const d = createSqliteD1(SCHEMA);
		await make(d);
		inVoice(d, ME, VC);
		expect(await timeboxesForViewer(d, claims(), G)).toHaveLength(1);
	});

	it("reports the viewer's own deafen choice, and never anyone else's", async () => {
		const d = createSqliteD1(SCHEMA);
		const s = await make(d);
		d.exec(
			`INSERT INTO timebox_participants (session_id, user_id, deafen_mode) VALUES (${s.id}, '${ME}', 'focus')`
		);
		d.exec(
			`INSERT INTO timebox_participants (session_id, user_id, deafen_mode) VALUES (${s.id}, '${FRIEND}', 'whole')`
		);
		const [tb] = await timeboxesForViewer(d, claims(), G);
		expect(tb.deafen).toBe('focus');
		expect(JSON.stringify(tb)).not.toContain(FRIEND);
	});

	it('leaves out finished timeboxes', async () => {
		const d = createSqliteD1(SCHEMA);
		const s = await make(d);
		d.exec(`UPDATE timebox_sessions SET status = 'done' WHERE id = ${s.id}`);
		expect(await timeboxesForViewer(d, claims(), G)).toEqual([]);
	});

	it('refuses a server that is not in the signed session', async () => {
		const d = createSqliteD1(SCHEMA);
		await expect(timeboxesForViewer(d, claims(), OTHER_G)).rejects.toMatchObject({
			status: 403,
		});
		await expect(timeboxesForViewer(d, claims({ g: [] }), G)).rejects.toBeInstanceOf(
			TimeboxAccessError
		);
		await expect(timeboxesForViewer(d, claims(), undefined)).rejects.toMatchObject({
			status: 403,
		});
		await expect(timeboxesForViewer(d, claims(), { $ne: 1 })).rejects.toMatchObject({
			status: 403,
		});
	});

	it('refuses a server that has not turned Timebox on', async () => {
		enabled = false;
		const d = createSqliteD1(SCHEMA);
		await expect(timeboxesForViewer(d, claims(), G)).rejects.toMatchObject({
			status: 403,
			message: expect.stringMatching(/not turned on/),
		});
	});
});
