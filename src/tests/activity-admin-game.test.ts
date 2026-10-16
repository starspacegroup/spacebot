import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSqliteD1 } from './helpers/sqlite-d1.js';

vi.mock('$lib/db/logger.js', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('$lib/db/commands.js', () => ({
	getBuiltInCommandsForGuild: vi.fn(async () => []),
	setBuiltInCommandOverride: vi.fn(),
}));
vi.mock('$lib/discord/commands.js', () => ({ syncGuildCommands: vi.fn() }));
vi.mock('$lib/discord/guilds.js', () => ({ hasFullAdminPermission: () => true }));
vi.mock('$lib/server/superadmin-guard.js', () => ({ checkIsSuperAdmin: () => false }));

const { actions } = await import('../routes/admin/[serverId]/activity/+page.server.js');
const { getSettings } = await import('../lib/server/game.js');

const SCHEMA = readFileSync(
	new URL('../../migrations/0076_game.sql', import.meta.url),
	'utf8'
).split('-- /game as a built-in command family')[0];
const G = '100000000000000001';

const form = (over: Record<string, string> = {}) => {
	const fd = new FormData();
	const base: Record<string, string> = {
		agentName: 'Impostor',
		crewName: 'Fed',
		minPlayers: '5',
		roundSeconds: '240',
		callLockSeconds: '30',
		meetingSeconds: '45',
		callsPerPlayer: '2',
		muteOut: 'on',
	};
	for (const [k, v] of Object.entries({ ...base, ...over })) fd.set(k, v);
	return fd;
};
const run = (db: any, fd: FormData) =>
	(actions as any).saveGame({
		request: { formData: async () => fd },
		cookies: { get: () => 'someone' },
		platform: { env: { DB: db } },
		params: { serverId: G },
	});

describe('dashboard: saving game settings', () => {
	it('saves valid settings and the game reads them back', async () => {
		const db = createSqliteD1(SCHEMA);
		const out = await run(db, form());
		expect(out).toMatchObject({ success: true });
		expect(await getSettings(db, G)).toMatchObject({
			agentName: 'Impostor',
			crewName: 'Fed',
			minPlayers: 5,
			roundSeconds: 240,
			callLockSeconds: 30,
			meetingSeconds: 45,
			callsPerPlayer: 2,
			muteOut: true,
		});
	});

	it('an unticked mute box turns the mute off', async () => {
		const db = createSqliteD1(SCHEMA);
		const fd = form();
		fd.delete('muteOut');
		await run(db, fd);
		expect((await getSettings(db, G)).muteOut).toBe(false);
	});

	it.each([
		['a role name with a mention in it', { agentName: '@everyone' }],
		['a role name with markdown', { crewName: '**Crew**' }],
		['an empty role name', { agentName: '  ' }],
		['a role name over 20 characters', { agentName: 'x'.repeat(21) }],
		['too few players', { minPlayers: '2' }],
		['too many players', { minPlayers: '16' }],
		['a round that is too short', { roundSeconds: '60' }],
		['a fractional number', { meetingSeconds: '30.5' }],
		['a vote lock as long as the round', { roundSeconds: '120', callLockSeconds: '120' }],
	])('refuses %s and saves nothing', async (_label, over) => {
		const db = createSqliteD1(SCHEMA);
		const out = await run(db, form(over));
		expect(out.status).toBe(400);
		expect(out.data.success).toBe(false);
		expect(await getSettings(db, G)).toMatchObject({ agentName: 'Agent', minPlayers: 4 });
	});

	it('accepts names with letters, numbers, spaces, apostrophes and hyphens', async () => {
		const db = createSqliteD1(SCHEMA);
		const out = await run(db, form({ agentName: 'Mole-person 2', crewName: "Pilot's crew" }));
		expect(out).toMatchObject({ success: true });
	});
});
