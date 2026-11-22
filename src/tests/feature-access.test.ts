import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

vi.mock('$lib/discord/guilds.js', () => ({
	verifyGuildAdmin: vi.fn(),
	getUserGuilds: vi.fn(),
}));
vi.mock('$lib/db/settings.js', () => ({ getGuildSettings: vi.fn() }));

import { verifyGuildAdmin, getUserGuilds } from '$lib/discord/guilds.js';
import { getGuildSettings } from '$lib/db/settings.js';
import {
	decideFeatures,
	resolveFeatures,
	roleIdsFor,
	hasAnyRoleRule,
	clearRoleCache,
	FEATURES,
	NO_FEATURES,
	ALL_FEATURES,
	FEATURE_RULE_KEY,
	type Feature,
} from '$lib/server/feature-access';

const id = fc.bigInt({ min: 100000000000000000n, max: 999999999999999999n }).map(String);
const roleList = fc.array(id, { maxLength: 4 });
const rules = fc.record({
	viewDashboard: fc.record({ roles: roleList }),
	viewLogs: fc.record({ roles: roleList }),
	manageAutomations: fc.record({ roles: roleList }),
	manageCommands: fc.record({ roles: roleList }),
	manageSettings: fc.record({ roles: roleList }),
});
const noStanding = { superAdmin: false, owner: false, administrator: false, manageGuild: false };
const standing = fc.record({
	superAdmin: fc.boolean(),
	owner: fc.boolean(),
	administrator: fc.boolean(),
	manageGuild: fc.boolean(),
});

describe('decideFeatures (properties)', () => {
	it('members with full standing keep every feature, whatever the rules say', () => {
		fc.assert(
			fc.property(standing, roleList, rules, (s, roles, r) => {
				fc.pre(s.superAdmin || s.owner || s.administrator || s.manageGuild);
				expect(decideFeatures(s, roles, r)).toEqual(ALL_FEATURES);
			})
		);
	});

	it('without full standing, a feature is granted exactly when a held role is saved for it', () => {
		fc.assert(
			fc.property(roleList, rules, (roles, r) => {
				const got = decideFeatures(noStanding, roles, r);
				const holds = (f: Feature) => roleIdsFor(r, f).some((x) => roles.includes(x));
				expect(got.logs).toBe(holds('logs'));
				expect(got.automations).toBe(holds('automations'));
				expect(got.commands).toBe(holds('commands'));
				expect(got.dashboard).toBe(FEATURES.some(holds));
			})
		);
	});

	it('roles saved on any other row never grant anything', () => {
		fc.assert(
			fc.property(roleList, id, (roles, extra) => {
				const r = {
					manageSettings: { roles: [extra, ...roles] },
					billing: { roles: roles },
				};
				expect(decideFeatures(noStanding, [extra, ...roles], r)).toEqual(NO_FEATURES);
			})
		);
	});

	it('empty or missing rules grant nothing', () => {
		fc.assert(
			fc.property(roleList, (roles) => {
				expect(decideFeatures(noStanding, roles, null)).toEqual(NO_FEATURES);
				expect(decideFeatures(noStanding, roles, {})).toEqual(NO_FEATURES);
			})
		);
	});

	it('a feature implies the dashboard', () => {
		fc.assert(
			fc.property(standing, roleList, rules, (s, roles, r) => {
				const got = decideFeatures(s, roles, r);
				if (got.logs || got.automations || got.commands) expect(got.dashboard).toBe(true);
			})
		);
	});

	it('holding more roles never removes access', () => {
		fc.assert(
			fc.property(standing, roleList, roleList, rules, (s, a, b, r) => {
				const before = decideFeatures(s, a, r);
				const after = decideFeatures(s, [...a, ...b], r);
				for (const f of FEATURES) if (before[f]) expect(after[f]).toBe(true);
			})
		);
	});

	it('ignores malformed role entries', () => {
		const bad = { viewLogs: { roles: ['not-an-id', 12, null, '123'] } };
		expect(roleIdsFor(bad as never, 'logs')).toEqual([]);
		expect(hasAnyRoleRule(bad as never)).toBe(false);
	});
});

describe('resolveFeatures', () => {
	const GUILD = '111111111111111111';
	const USER = '222222222222222222';
	const ROLE = '333333333333333333';
	const cookies = (over: Record<string, string | undefined> = {}) =>
		({
			get: (n: string) =>
				({ discord_access_token: 'tok', discord_user_id: USER, ...over })[n],
		}) as never;
	const platform = {
		env: { DB: {}, DISCORD_BOT_TOKEN: 'bot', ADMIN_USER_IDS: '999999999999999999' },
	};
	const ctx = (c = cookies()) => ({ guildId: GUILD, cookies: c, platform });

	beforeEach(() => {
		vi.resetAllMocks();
		clearRoleCache();
		vi.mocked(verifyGuildAdmin).mockResolvedValue({ authorized: false } as never);
		vi.mocked(getUserGuilds).mockResolvedValue([{ id: GUILD, permissions: '0' }] as never);
		vi.mocked(getGuildSettings).mockResolvedValue({
			permission_settings: { viewLogs: { roles: [ROLE] } },
		} as never);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ roles: [ROLE] }), { status: 200 }))
		);
	});

	it('gives a member with a saved role that feature and the door only', async () => {
		expect(await resolveFeatures(ctx())).toEqual({
			dashboard: true,
			logs: true,
			automations: false,
			commands: false,
		});
	});

	it('asks Discord with the bot token, not the member token', async () => {
		await resolveFeatures(ctx());
		const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
		expect(url).toContain(`/guilds/${GUILD}/members/${USER}`);
		expect((init.headers as Record<string, string>).Authorization).toBe('Bot bot');
	});

	it('Manage Server holders answer without any role lookup', async () => {
		vi.mocked(verifyGuildAdmin).mockResolvedValue({ authorized: true } as never);
		expect(await resolveFeatures(ctx())).toEqual(ALL_FEATURES);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('superadmins keep everything', async () => {
		const c = cookies({ discord_user_id: '999999999999999999' });
		expect(await resolveFeatures(ctx(c))).toEqual(ALL_FEATURES);
	});

	it('fails closed when Discord cannot say', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('', { status: 500 }))
		);
		expect(await resolveFeatures(ctx())).toEqual(NO_FEATURES);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('timeout');
			})
		);
		clearRoleCache();
		expect(await resolveFeatures(ctx())).toEqual(NO_FEATURES);
	});

	it('does not ask Discord when the server saved no roles', async () => {
		vi.mocked(getGuildSettings).mockResolvedValue({
			permission_settings: { viewLogs: { roles: [] } },
		} as never);
		expect(await resolveFeatures(ctx())).toEqual(NO_FEATURES);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('gives nothing to someone who is not in the guild', async () => {
		vi.mocked(getUserGuilds).mockResolvedValue([{ id: '444444444444444444' }] as never);
		expect(await resolveFeatures(ctx())).toEqual(NO_FEATURES);
	});

	it('gives nothing without a session', async () => {
		expect(await resolveFeatures(ctx(cookies({ discord_user_id: undefined })))).toEqual(
			NO_FEATURES
		);
		expect(await resolveFeatures(ctx(cookies({ discord_access_token: undefined })))).toEqual(
			NO_FEATURES
		);
	});

	it('a member without the role gets nothing', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ roles: ['555555555555555555'] })))
		);
		expect(await resolveFeatures(ctx())).toEqual(NO_FEATURES);
	});

	it('maps every feature to its Settings row', () => {
		expect(FEATURE_RULE_KEY).toEqual({
			dashboard: 'viewDashboard',
			logs: 'viewLogs',
			automations: 'manageAutomations',
			commands: 'manageCommands',
		});
	});
});
