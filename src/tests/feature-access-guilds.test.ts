import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/discord/guilds.js', () => ({ verifyGuildAdmin: vi.fn(), getUserGuilds: vi.fn() }));
vi.mock('$lib/db/settings.js', () => ({ getGuildSettings: vi.fn() }));

import { verifyGuildAdmin, getUserGuilds } from '$lib/discord/guilds.js';
import { getGuildSettings } from '$lib/db/settings.js';
import {
	buildMemberGuilds,
	loadRoleRules,
	verifyGuildFeature,
	clearRoleCache,
} from '$lib/server/feature-access';

const A = '111111111111111111';
const B = '222222222222222222';
const C = '333333333333333333';
const USER = '444444444444444444';
const ROLE = '555555555555555555';

function fakeDb(rows: Record<string, unknown>) {
	const seen: unknown[][] = [];
	return {
		seen,
		prepare: () => ({
			bind: (...ids: unknown[]) => {
				seen.push(ids);
				return {
					all: async () => ({
						results: ids
							.filter((id) => (id as string) in rows)
							.map((id) => ({
								guild_id: id,
								permission_settings:
									typeof rows[id as string] === 'string'
										? rows[id as string]
										: JSON.stringify(rows[id as string]),
							})),
					}),
				};
			},
		}),
	};
}

beforeEach(() => {
	clearRoleCache();
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response(JSON.stringify({ roles: [ROLE] }), { status: 200 }))
	);
});

describe('loadRoleRules', () => {
	it('keeps only guilds with a saved role and ignores rows that do not parse', async () => {
		const db = fakeDb({
			[A]: { viewLogs: { roles: [ROLE] } },
			[B]: { viewLogs: { roles: [] } },
			[C]: 'not json',
		});
		const got = await loadRoleRules(db as never, [A, B, C]);
		expect([...got.keys()]).toEqual([A]);
	});

	it('asks in chunks of 80', async () => {
		const ids = Array.from({ length: 170 }, (_, i) => String(100000000000000000n + BigInt(i)));
		const db = fakeDb({});
		await loadRoleRules(db as never, ids);
		expect(db.seen.map((c) => c.length)).toEqual([80, 80, 10]);
	});
});

describe('buildMemberGuilds', () => {
	const base = {
		userGuilds: [
			{ id: A, name: 'Alpha' },
			{ id: B, name: 'Beta' },
			{ id: C, name: 'Gamma' },
		],
		botGuildIds: new Set([A, B, C]),
		adminGuildIds: new Set<string>(),
		userId: USER,
		botToken: 'bot',
	};

	it('lists servers where a held role is saved, with exactly that feature', async () => {
		const db = fakeDb({ [A]: { viewLogs: { roles: [ROLE] } } });
		const out = await buildMemberGuilds({ ...base, db });
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({
			id: A,
			features: { dashboard: true, logs: true, automations: false, commands: false },
		});
	});

	it('skips servers the member already administers, and servers without the bot', async () => {
		const db = fakeDb({
			[A]: { viewLogs: { roles: [ROLE] } },
			[B]: { viewLogs: { roles: [ROLE] } },
		});
		const out = await buildMemberGuilds({
			...base,
			db,
			adminGuildIds: new Set([A]),
			botGuildIds: new Set([A, C]),
		});
		expect(out).toEqual([]);
	});

	it('lists nothing when Discord cannot say which roles the member holds', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('', { status: 403 }))
		);
		const db = fakeDb({ [A]: { viewLogs: { roles: [ROLE] } } });
		expect(await buildMemberGuilds({ ...base, db })).toEqual([]);
	});

	it('lists nothing for a role the member does not hold', async () => {
		const db = fakeDb({ [A]: { viewLogs: { roles: ['666666666666666666'] } } });
		expect(await buildMemberGuilds({ ...base, db })).toEqual([]);
	});

	it('asks Discord only for servers that saved a role', async () => {
		const db = fakeDb({ [A]: { viewLogs: { roles: [ROLE] } } });
		await buildMemberGuilds({ ...base, db });
		expect(fetch).toHaveBeenCalledTimes(1);
	});
});

describe('verifyGuildFeature', () => {
	const cookies = {
		get: (n: string) => ({ discord_access_token: 't', discord_user_id: USER })[n],
	} as never;
	const platform = { env: { DB: {}, DISCORD_BOT_TOKEN: 'bot' } };

	beforeEach(() => {
		vi.mocked(verifyGuildAdmin).mockResolvedValue({
			authorized: false,
			error: 'nope',
		} as never);
		vi.mocked(getUserGuilds).mockResolvedValue([{ id: A }] as never);
		vi.mocked(getGuildSettings).mockResolvedValue({
			permission_settings: { manageCommands: { roles: [ROLE] } },
		} as never);
	});

	it('accepts a role for the named feature', async () => {
		expect((await verifyGuildFeature(A, 't', cookies, platform, 'commands')).authorized).toBe(
			true
		);
	});

	it('refuses a feature the role was not saved for', async () => {
		expect(
			(await verifyGuildFeature(A, 't', cookies, platform, 'automations')).authorized
		).toBe(false);
	});

	it('accepts any of a list, so shared pickers work for every feature holder', async () => {
		const r = await verifyGuildFeature(A, 't', cookies, platform, ['logs', 'commands']);
		expect(r.authorized).toBe(true);
	});
});
