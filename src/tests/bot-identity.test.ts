import { beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

const GUILD = '100000000000000001';

const editBotMember = vi.fn(async (..._a: any[]) => ({}));
let guildData: any = { id: GUILD, name: 'Cool Server', icon: 'abc123' };
let editError: any = null;
vi.mock('../lib/discord/rest-client.js', () => ({
	createDiscordRestClient: () => ({
		guilds: {
			fetch: async () => guildData,
			editBotMember: async (...a: any[]) => {
				if (editError) throw editError;
				return (editBotMember as any)(...a);
			},
		},
	}),
}));
const iconBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
vi.mock('../lib/server/safe-fetch.js', () => ({
	safeFetch: async () => new Response(iconBytes, { status: 200 }),
}));
vi.mock('../lib/db/logger.js', () => ({
	log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
	MAX_CUSTOM_IMAGE_BYTES,
	MAX_NICK,
	bytesToDataUri,
	defaultBotName,
	effectiveBotName,
	guildIconUrl,
	identityPatch,
	parseCustomName,
} from '../lib/server/bot-identity-core.js';
import { applyBotIdentity, getBotIdentity, saveBotIdentity } from '../lib/db/bot-identity.js';
import { POST as resync } from '../routes/api/gateway/bot-identity/[guildId]/+server.js';

// ---- in-memory guild_bot_identity ----
let row: any = null;
const db = {
	prepare(sql: string) {
		return {
			bind(...a: any[]) {
				return {
					first: async () => (row ? { ...row } : null),
					run: async () => {
						if (sql.startsWith('INSERT')) {
							row = {
								guild_id: a[0],
								enabled: a[1],
								name: a[2],
								avatar_mode: a[3],
								avatar_data: a[4],
								applied_key: null,
								last_error: null,
							};
						} else if (sql.includes('SET applied_key')) {
							row.applied_key = a[0];
							row.last_error = null;
						} else if (sql.includes('SET last_error')) {
							row.last_error = a[0];
						}
						return {};
					},
				};
			},
		};
	},
};

beforeEach(() => {
	row = null;
	editError = null;
	guildData = { id: GUILD, name: 'Cool Server', icon: 'abc123' };
	vi.clearAllMocks();
});

describe('names', () => {
	it('defaults to <server name>Bot', () => {
		expect(defaultBotName('Cool Server')).toBe('Cool ServerBot');
		expect(defaultBotName('')).toBe('Bot');
		expect(defaultBotName(undefined)).toBe('Bot');
	});

	it('property: every name is 1..32 characters, the default ends in Bot, and no hidden characters survive', () => {
		fc.assert(
			fc.property(
				fc.string({ unit: 'binary' }),
				fc.option(fc.string({ unit: 'binary' })),
				(guild, custom) => {
					const d = defaultBotName(guild);
					expect([...d].length).toBeLessThanOrEqual(MAX_NICK);
					expect(d.endsWith('Bot')).toBe(true);
					const e = effectiveBotName(custom, guild);
					expect([...e].length).toBeGreaterThanOrEqual(1);
					expect([...e].length).toBeLessThanOrEqual(MAX_NICK);
					expect(e).not.toMatch(new RegExp('[\\u0000-\\u001f\\u200b-\\u200f]'));
				}
			)
		);
	});

	it('uses a custom name when given, and rejects a too-long one', () => {
		expect(effectiveBotName('Nova', 'Cool Server')).toBe('Nova');
		expect(effectiveBotName('   ', 'Cool Server')).toBe('Cool ServerBot');
		expect(parseCustomName('x'.repeat(33))).toMatchObject({ ok: false });
		expect(parseCustomName('')).toEqual({ ok: true, name: null });
		expect(parseCustomName('  Nova  ')).toEqual({ ok: true, name: 'Nova' });
	});
});

describe('images', () => {
	it('builds the icon url only from safe pieces', () => {
		expect(guildIconUrl(GUILD, 'a_abc123')).toContain(`/icons/${GUILD}/a_abc123.png`);
		expect(guildIconUrl(GUILD, null)).toBeNull();
		expect(guildIconUrl(GUILD, '../x')).toBeNull();
		expect(guildIconUrl('nope', 'abc')).toBeNull();
	});

	it('takes the type from the bytes and caps the size', () => {
		const png = bytesToDataUri(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]));
		expect(png).toMatchObject({ ok: true });
		expect((png as any).dataUri.startsWith('data:image/png;base64,')).toBe(true);
		expect(bytesToDataUri(new Uint8Array([0x3c, 0x73, 0x76, 0x67]))).toMatchObject({
			ok: false,
		}); // <svg
		expect(bytesToDataUri(new Uint8Array(0))).toMatchObject({ ok: false });
		const big = new Uint8Array(MAX_CUSTOM_IMAGE_BYTES + 1);
		big.set([0x89, 0x50, 0x4e, 0x47]);
		expect(bytesToDataUri(big)).toMatchObject({ ok: false });
	});
});

describe('identityPatch', () => {
	const base = {
		enabled: true,
		name: null,
		avatar_mode: 'server_icon' as const,
		avatar_data: null,
	};
	it('disabled restores the bot', () => {
		expect(identityPatch({ ...base, enabled: false }, { name: 'X' }, 'data:...')).toEqual({
			nick: null,
			avatar: null,
		});
	});
	it('server icon mode uses the icon, null clears, undefined keeps', () => {
		expect(identityPatch(base, { name: 'Cool Server' }, 'data:x')).toEqual({
			nick: 'Cool ServerBot',
			avatar: 'data:x',
		});
		expect(identityPatch(base, { name: 'Cool Server' }, null)).toEqual({
			nick: 'Cool ServerBot',
			avatar: null,
		});
		expect(identityPatch(base, { name: 'Cool Server' }, undefined)).toEqual({
			nick: 'Cool ServerBot',
		});
	});
	it('custom mode uses the stored picture', () => {
		expect(
			identityPatch(
				{ ...base, avatar_mode: 'custom', avatar_data: 'data:y' },
				{ name: 'S' },
				'data:icon'
			)
		).toEqual({ nick: 'SBot', avatar: 'data:y' });
	});
});

describe('applyBotIdentity', () => {
	const save = (v: Partial<any> = {}) =>
		saveBotIdentity(
			db,
			GUILD,
			{ enabled: true, name: null, avatar_mode: 'server_icon', avatar_data: null, ...v },
			'u1'
		);

	it('does nothing for a server that never turned it on', async () => {
		const r = await applyBotIdentity(db, 'tok', GUILD);
		expect(r).toMatchObject({ ok: true, skipped: true });
		expect(editBotMember).not.toHaveBeenCalled();
	});

	it('applies the default name and the server icon', async () => {
		await save();
		const r = await applyBotIdentity(db, 'tok', GUILD, { force: true });
		expect(r).toMatchObject({ ok: true, name: 'Cool ServerBot' });
		const [guildId, patch] = editBotMember.mock.calls[0] as any[];
		expect(guildId).toBe(GUILD);
		expect(patch.nick).toBe('Cool ServerBot');
		expect(patch.avatar).toMatch(/^data:image\/png;base64,/);
	});

	it('skips a repeat with nothing changed, but not after a rename of the server', async () => {
		await save();
		await applyBotIdentity(db, 'tok', GUILD);
		expect(await applyBotIdentity(db, 'tok', GUILD)).toMatchObject({ skipped: true });
		expect(editBotMember).toHaveBeenCalledTimes(1);
		guildData = { ...guildData, name: 'Renamed' };
		expect(await applyBotIdentity(db, 'tok', GUILD)).toMatchObject({
			ok: true,
			name: 'RenamedBot',
		});
		expect(editBotMember).toHaveBeenCalledTimes(2);
	});

	it('restores the bot when turned off', async () => {
		await save();
		await applyBotIdentity(db, 'tok', GUILD);
		await save({ enabled: false });
		await applyBotIdentity(db, 'tok', GUILD);
		expect(editBotMember).toHaveBeenLastCalledWith(
			GUILD,
			{ nick: null, avatar: null },
			expect.any(String)
		);
	});

	it('uses a custom name and picture', async () => {
		await save({
			name: 'Nova',
			avatar_mode: 'custom',
			avatar_data: 'data:image/png;base64,AAAA',
		});
		await applyBotIdentity(db, 'tok', GUILD);
		expect((editBotMember.mock.calls[0] as any[])[1]).toEqual({
			nick: 'Nova',
			avatar: 'data:image/png;base64,AAAA',
		});
	});

	it('records a plain reason when Discord refuses', async () => {
		await save();
		editError = Object.assign(new Error('Missing Permissions'), { status: 403 });
		const r = await applyBotIdentity(db, 'tok', GUILD);
		expect(r).toMatchObject({ ok: false });
		expect((r as any).error).toContain('Change Nickname');
		expect((await getBotIdentity(db, GUILD)).last_error).toContain('Change Nickname');
	});
});

describe('POST /api/gateway/bot-identity/:guildId', () => {
	const call = (auth: string | null, guildId = GUILD) =>
		resync({
			params: { guildId },
			request: new Request('http://x', {
				method: 'POST',
				headers: auth ? { Authorization: auth } : {},
			}),
			platform: { env: { DB: db, DISCORD_BOT_TOKEN: 'tok' } },
		} as any);

	it('needs the bot token', async () => {
		expect((await call(null)).status).toBe(401);
		expect((await call('Bot wrong')).status).toBe(401);
		expect(editBotMember).not.toHaveBeenCalled();
	});

	it('re-applies for the guild', async () => {
		await saveBotIdentity(
			db,
			GUILD,
			{ enabled: true, name: null, avatar_mode: 'server_icon', avatar_data: null },
			'u'
		);
		const res = await call('Bot tok');
		expect(res.status).toBe(200);
		expect(editBotMember).toHaveBeenCalledTimes(1);
		expect((await call('Bot tok', 'bad')).status).toBe(400);
	});
});
