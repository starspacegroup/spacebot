import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSqliteD1 } from './helpers/sqlite-d1.js';

// The registration builders read three other tables; what matters here is the
// sweep, so they are replaced with a command list the test can change.
let builtIn: any[] = [];
vi.mock('../lib/db/commands.js', () => ({
	BUILT_IN_GUILD_ID: '__built_in__',
	ensureBuiltInCommands: async () => {},
	getBuiltInCommandsForGuild: async () => builtIn,
	getGuildCommands: async () => [],
	markCommandRegistered: async () => {},
	toDiscordCommand: (cmd: any) => ({ name: cmd.name, options: cmd.options ?? [] }),
}));
let integrationCmds: any[] = [];
vi.mock('../lib/db/integrations.js', () => ({
	getEnabledGuildIntegrations: async () =>
		integrationCmds.length ? [{ slug: 'starspace-game' }] : [],
}));
vi.mock('../lib/integrations/registry.js', () => ({
	getIntegrationCommands: () => integrationCmds,
}));

const {
	COMMAND_SYNC_BATCH,
	hashCommandPayload,
	buildGuildCommandPayload,
	sweepCommandSync,
	getCommandSyncStatus,
	syncGuildCommandsNow,
} = await import('../lib/discord/commands.js');

const SCHEMA = `
CREATE TABLE commands (id INTEGER PRIMARY KEY, guild_id TEXT);
CREATE TABLE built_in_command_overrides (id INTEGER PRIMARY KEY, guild_id TEXT);
CREATE TABLE guild_integrations (id INTEGER PRIMARY KEY, guild_id TEXT);
${readFileSync(new URL('../../migrations/0074_guild_command_sync.sql', import.meta.url), 'utf8')}
`;

const ENV = { DISCORD_BOT_TOKEN: 't', DISCORD_CLIENT_ID: 'c' };

function setup(guilds: string[]) {
	const db = createSqliteD1();
	db.exec(SCHEMA);
	for (const g of guilds) db.exec(`INSERT INTO commands (guild_id) VALUES ('${g}')`);
	return db;
}

describe('sweepCommandSync', () => {
	let puts: string[];
	let status: number;

	beforeEach(() => {
		builtIn = [{ name: 'timebox', enabled: 1, options: [] }];
		puts = [];
		status = 200;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				puts.push(url);
				return new Response(status === 200 ? '[]' : 'Unknown Guild', { status });
			})
		);
	});

	it('sends a server it has never synced', async () => {
		const db = setup(['g1']);
		const r = await sweepCommandSync(db, ENV);
		expect(r).toMatchObject({ checked: 1, synced: 1, failed: 0 });
		expect(puts).toEqual(['https://discord.com/api/v10/applications/c/guilds/g1/commands']);
	});

	it('leaves a server alone while its commands are unchanged', async () => {
		const db = setup(['g1']);
		await sweepCommandSync(db, ENV);
		puts.length = 0;
		const r = await sweepCommandSync(db, ENV);
		expect(r).toMatchObject({ checked: 1, synced: 0, current: 1 });
		expect(puts).toEqual([]);
	});

	it('sends again once the commands change (a new option from a migration)', async () => {
		const db = setup(['g1']);
		await sweepCommandSync(db, ENV);
		builtIn = [{ name: 'timebox', enabled: 1, options: [{ name: 'goal' }] }];
		const r = await sweepCommandSync(db, ENV);
		expect(r.synced).toBe(1);
		expect(puts).toHaveLength(2);
	});

	it('holds a failed server for the retry window, then tries it again', async () => {
		const db = setup(['gone']);
		status = 404;
		expect((await sweepCommandSync(db, ENV)).failed).toBe(1);
		expect((await sweepCommandSync(db, ENV)).checked).toBe(0);
		db.exec(
			"UPDATE guild_command_sync SET attempted_at = datetime('now', '-31 minutes') WHERE guild_id = 'gone'"
		);
		status = 200;
		expect((await sweepCommandSync(db, ENV)).synced).toBe(1);
	});

	it('looks at a limited number of servers per run, oldest check first', async () => {
		const ids = Array.from({ length: COMMAND_SYNC_BATCH + 3 }, (_, i) => `g${i}`);
		const db = setup(ids);
		expect((await sweepCommandSync(db, ENV)).checked).toBe(COMMAND_SYNC_BATCH);
		const second = await sweepCommandSync(db, ENV);
		expect(second.checked).toBe(COMMAND_SYNC_BATCH);
		// The three left over were synced by the second run, not skipped.
		expect(puts.length).toBe(ids.length);
	});

	it('does not count the shared built-in rows as a server', async () => {
		const db = setup(['__built_in__']);
		expect((await sweepCommandSync(db, ENV)).checked).toBe(0);
	});

	it('hashes the same list to the same value and a changed list differently', async () => {
		const a = await hashCommandPayload([{ name: 'a' }]);
		expect(await hashCommandPayload([{ name: 'a' }])).toBe(a);
		expect(await hashCommandPayload([{ name: 'b' }])).not.toBe(a);
		const { allCommands } = await buildGuildCommandPayload(setup([]), 'g');
		// `/start` rides along, built from the timebox command the server has.
		expect(allCommands.map((c) => c.name)).toEqual(['timebox', 'start']);
	});
});

describe('syncGuildCommandsNow + getCommandSyncStatus', () => {
	let status: number;
	beforeEach(() => {
		builtIn = [{ name: 'game', enabled: 1, options: [] }];
		status = 200;
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(status === 200 ? '[]' : 'Missing Access', { status }))
		);
	});

	it('is null before the first sync, and without a db', async () => {
		const db = setup(['g1']);
		expect(await getCommandSyncStatus(db, 'g1')).toBeNull();
		expect(await getCommandSyncStatus(null, 'g1')).toBeNull();
	});

	it('records a success with its time and no error', async () => {
		const db = setup(['g1']);
		expect(await syncGuildCommandsNow(db, 'g1', ENV)).toMatchObject({ success: true });
		const s = await getCommandSyncStatus(db, 'g1');
		expect(s?.syncedAt).toBeTruthy();
		expect(s?.lastError).toBeNull();
	});

	it('records a failure so the page shows it', async () => {
		const db = setup(['g1']);
		status = 403;
		expect(await syncGuildCommandsNow(db, 'g1', ENV)).toMatchObject({ success: false });
		const s = await getCommandSyncStatus(db, 'g1');
		expect(s?.lastError).toContain('Missing Access');
		expect(s?.syncedAt).toBeNull();
	});

	it('survives a broken table on read and on the error write', async () => {
		const broken = {
			prepare: () => {
				throw new Error('no table');
			},
		};
		expect(await getCommandSyncStatus(broken, 'g1')).toBeNull();
		status = 500;
		expect(await syncGuildCommandsNow(broken, 'g1', ENV)).toMatchObject({ success: false });
	});
});

describe('buildGuildCommandPayload and /game', () => {
	beforeEach(() => {
		integrationCmds = [];
	});

	it('sends one /game with the integration subcommands, and /play identical to it', async () => {
		builtIn = [{ name: 'game', enabled: 1, options: [{ name: 'shiritori', type: 1 }] }];
		integrationCmds = [{ name: 'game', type: 1, options: [{ name: 'stats', type: 1 }] }];
		const { allCommands, integrationCommands } = await buildGuildCommandPayload(
			setup([]),
			'g1'
		);
		const game = allCommands.filter((c: any) => c.name === 'game');
		const play = allCommands.filter((c: any) => c.name === 'play');
		expect(game).toHaveLength(1);
		expect(play).toHaveLength(1);
		expect(game[0].options.map((o: any) => o.name)).toEqual(['shiritori', 'stats']);
		expect(play[0].options).toEqual(game[0].options);
		expect(play[0].description).toBe('Same as /game');
		expect(integrationCommands).toEqual([]);
	});

	it('changes the hash when a subcommand is added, so the sweep resyncs', async () => {
		builtIn = [{ name: 'game', enabled: 1, options: [{ name: 'start', type: 1 }] }];
		const a = await hashCommandPayload(
			(await buildGuildCommandPayload(setup([]), 'g1')).allCommands
		);
		builtIn = [
			{
				name: 'game',
				enabled: 1,
				options: [
					{ name: 'start', type: 1 },
					{ name: 'shiritori', type: 1 },
				],
			},
		];
		const b = await hashCommandPayload(
			(await buildGuildCommandPayload(setup([]), 'g1')).allCommands
		);
		expect(a).not.toBe(b);
	});
});
