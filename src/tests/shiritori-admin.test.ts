/**
 * The Shiritori form actions change what the bot does in a server, and a form
 * action runs without the page's load, so each one has to check for itself that
 * the caller manages THIS server.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSqliteD1 } from './helpers/sqlite-d1.js';

let admin = { authorized: true, guild: { id: 'g', permissions: '8' } } as any;
let superadmin = false;
const verifyGuildAdmin = vi.fn(async () => admin);
vi.mock('$lib/db/logger.js', () => ({
	log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('$lib/db/commands.js', () => ({
	getBuiltInCommandsForGuild: vi.fn(async () => []),
	setBuiltInCommandOverride: vi.fn(),
}));
vi.mock('$lib/discord/commands.js', () => ({ syncGuildCommands: vi.fn() }));
vi.mock('$lib/discord/guilds.js', () => ({
	hasFullAdminPermission: (g: any) => Boolean(g && BigInt(g.permissions) & 8n),
	verifyGuildAdmin: (...args: unknown[]) => (verifyGuildAdmin as any)(...args),
}));
vi.mock('$lib/server/superadmin-guard.js', () => ({ checkIsSuperAdmin: () => superadmin }));

const { actions } = await import('../routes/admin/[serverId]/activity/+page.server.js');
const { getSettings } = await import('../lib/server/shiritori-game.js');

const SCHEMA = readFileSync(
	new URL('../../migrations/0081_shiritori.sql', import.meta.url),
	'utf8'
).split('-- `/play shiritori` joins')[0];
const G = '100000000000000001';

const form = (over: Record<string, string> = {}) => {
	const fd = new FormData();
	const base: Record<string, string> = {
		enabled: 'on',
		turnSeconds: '20',
		deadLetters: 'xz',
		allowWords: 'Holodeck',
		blockWords: '',
	};
	for (const [k, v] of Object.entries({ ...base, ...over })) fd.set(k, v);
	return fd;
};

const event = (db: any, fd: FormData, signedIn = true) => ({
	request: { formData: async () => fd },
	cookies: {
		get: (name: string) =>
			name === 'discord_user_id' && signedIn
				? 'u1'
				: name === 'discord_access_token'
					? 'token'
					: undefined,
	},
	platform: { env: { DB: db } },
	params: { serverId: G },
});

let db: ReturnType<typeof createSqliteD1>;
beforeEach(() => {
	db = createSqliteD1(SCHEMA);
	admin = { authorized: true, guild: { id: G, permissions: '8' } };
	superadmin = false;
	verifyGuildAdmin.mockClear();
});

describe('saveShiritori', () => {
	it('saves for an administrator of the server', async () => {
		const out = await (actions as any).saveShiritori(event(db, form()));
		expect(out).toMatchObject({ success: true });
		expect(await getSettings(db, G)).toMatchObject({
			enabled: true,
			turnSeconds: 20,
			deadLetters: 'xz',
			allowWords: 'holodeck',
		});
		expect(verifyGuildAdmin).toHaveBeenCalledWith(G, 'token', expect.anything());
	});

	it('refuses someone who is signed in but does not manage this server', async () => {
		admin = { authorized: false, error: 'Guild not found' };
		const out = await (actions as any).saveShiritori(event(db, form()));
		expect(out.status).toBe(403);
		expect((await getSettings(db, G)).enabled).toBe(false);
	});

	it('refuses Manage Server without Administrator, as the page itself does', async () => {
		admin = { authorized: true, guild: { id: G, permissions: '32' } };
		expect((await (actions as any).saveShiritori(event(db, form()))).status).toBe(403);
	});

	it('refuses someone who is not signed in', async () => {
		const out = await (actions as any).saveShiritori(event(db, form(), false));
		expect(out.status).toBe(401);
		expect(verifyGuildAdmin).not.toHaveBeenCalled();
	});

	it('lets a superadmin through without a guild check', async () => {
		superadmin = true;
		admin = { authorized: false };
		expect(await (actions as any).saveShiritori(event(db, form()))).toMatchObject({
			success: true,
		});
	});

	it('rejects a turn clock out of range, and an over-long word list', async () => {
		expect(
			(await (actions as any).saveShiritori(event(db, form({ turnSeconds: '2' })))).status
		).toBe(400);
		// 3,000 distinct words of 4+ letters is well past the 4,000-character limit
		const letters = 'abcdefghijklmnopqrstuvwxyz';
		const long = Array.from(
			{ length: 3000 },
			(_, i) =>
				'wor' +
				letters[i % 26] +
				letters[Math.floor(i / 26) % 26] +
				letters[Math.floor(i / 676)]
		).join('\n');
		const out = await (actions as any).saveShiritori(event(db, form({ blockWords: long })));
		expect(out.status).toBe(400);
	});

	it('falls back to the default dead letters when none are valid', async () => {
		await (actions as any).saveShiritori(event(db, form({ deadLetters: '123 !' })));
		expect((await getSettings(db, G)).deadLetters).toBe('xqjz');
	});
});

describe('resetShiritoriChain', () => {
	it('refuses someone who does not manage the server', async () => {
		admin = { authorized: false };
		const out = await (actions as any).resetShiritoriChain(event(db, form()));
		expect(out.status).toBe(403);
	});

	it('asks for a Chain channel first', async () => {
		const out = await (actions as any).resetShiritoriChain(event(db, form()));
		expect(out.status).toBe(400);
	});
});
