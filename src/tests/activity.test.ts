import { beforeEach, describe, expect, it, vi } from 'vitest';

// The module switch is "is the built-in command effectively enabled here", which
// is the commands table's job and is tested there. Here it is a set of guild ids.
const enabledGuilds = new Set<string>();
vi.mock('../lib/db/commands.js', () => ({
	getCommandByName: vi.fn(async (_db, _name, guildId) =>
		enabledGuilds.has(guildId) ? { name: 'timebox' } : null
	),
}));

import {
	ActivityError,
	MAX_DM_PARTICIPANTS,
	SESSION_TTL_SECONDS,
	createActivitySession,
	exchangeCode,
	sessionFromRequest,
	signSession,
	verifySession,
} from '../lib/server/activity.js';
import {
	ACTIVITY_FRAME_ANCESTORS,
	applySecurityHeaders,
	isFramablePath,
} from '../lib/server/security-headers.js';
import { getEntryPointCommands } from '../lib/discord/commands.js';

const ENV = { clientId: '111111111111111111', clientSecret: 'shh', botToken: 'bot-token' };
const ME = '222222222222222222';
const FRIEND = '333333333333333333';
const STRANGER = '444444444444444444';
const G1 = '555555555555555555';
const G2 = '666666666666666666';

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface World {
	instance?: any;
	members?: Record<string, string[]>; // guild id -> member ids
	userGuilds?: any[];
	instanceStatus?: number;
	meStatus?: number;
}

/** A fake Discord keyed on the path, so a test says what the world looks like. */
function discord(world: World) {
	const calls: string[] = [];
	const f = vi.fn(async (input: string, init?: RequestInit) => {
		const path = input.replace('https://discord.com/api/v10', '');
		const auth = String((init?.headers as any)?.Authorization ?? '');
		calls.push(`${auth.split(' ')[0]} ${path}`);
		if (path === '/users/@me') {
			return world.meStatus
				? json({}, world.meStatus)
				: json({ id: ME, username: 'me', avatar: null });
		}
		if (path === '/users/@me/guilds') return json(world.userGuilds ?? []);
		if (path.startsWith(`/applications/${ENV.clientId}/activity-instances/`)) {
			return world.instanceStatus ? json({}, world.instanceStatus) : json(world.instance);
		}
		let m = /^\/guilds\/(\d+)\/members\/(\d+)$/.exec(path);
		if (m) return (world.members?.[m[1]] ?? []).includes(m[2]) ? json({}) : json({}, 404);
		m = /^\/guilds\/(\d+)$/.exec(path);
		if (m) return json({ id: m[1], name: `Guild ${m[1].slice(0, 2)}`, icon: null });
		return json({}, 404);
	});
	return { f: f as any, calls };
}

const guildInstance = (guild = G1, users = [ME]) => ({
	instance_id: 'inst-1',
	location: { kind: 'gc', guild_id: guild, channel_id: '777777777777777777' },
	users,
});
const dmInstance = (users: string[]) => ({
	instance_id: 'inst-1',
	location: { kind: 'pc' },
	users,
});

const session = (world: World, instanceId: any = 'inst-1', token: any = 'tok') => {
	const d = discord(world);
	return {
		d,
		run: () =>
			createActivitySession(ENV, {}, { accessToken: token, instanceId }, d.f, 1_000_000),
	};
};

beforeEach(() => enabledGuilds.clear());

describe('signed session token', () => {
	const claims = { u: ME, i: 'inst-1', k: 'guild' as const, g: [G1], e: 2_000 };

	it('round-trips', async () => {
		const t = await signSession('s', claims);
		expect(await verifySession('s', t, 1_000_000)).toEqual(claims);
	});

	it('rejects expiry, a wrong secret, and tampering', async () => {
		const t = await signSession('s', claims);
		expect(await verifySession('s', t, 2_000 * 1000)).toBeNull();
		expect(await verifySession('other', t, 1_000_000)).toBeNull();
		const [body, sig] = t.split('.');
		const forged = btoa(JSON.stringify({ ...claims, g: [G1, G2] }))
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=+$/, '');
		expect(await verifySession('s', `${forged}.${sig}`, 1_000_000)).toBeNull();
		expect(await verifySession('s', `${body}.${sig}x`, 1_000_000)).toBeNull();
	});

	it('rejects things that are not tokens', async () => {
		for (const bad of [undefined, null, 5, '', 'a', 'a.b.c', '.', 'a.']) {
			expect(await verifySession('s', bad as any)).toBeNull();
		}
	});

	it('reads the bearer header', async () => {
		const t = await signSession('s', { ...claims, e: Math.floor(Date.now() / 1000) + 60 });
		const ok = new Request('https://x', { headers: { authorization: `Bearer ${t}` } });
		expect((await sessionFromRequest(ok, 's'))?.u).toBe(ME);
		expect(await sessionFromRequest(new Request('https://x'), 's')).toBeNull();
	});
});

describe('exchangeCode', () => {
	it('returns the access token', async () => {
		const f: any = vi.fn(async () => json({ access_token: 'abc' }));
		expect(await exchangeCode(ENV, 'code', f)).toBe('abc');
		expect(String((f.mock.calls[0][1] as any).body)).toContain('client_secret=shh');
	});

	it('refuses a missing code without calling Discord', async () => {
		const f: any = vi.fn();
		await expect(exchangeCode(ENV, '', f)).rejects.toMatchObject({ status: 400 });
		await expect(exchangeCode(ENV, 'x'.repeat(600), f)).rejects.toMatchObject({ status: 400 });
		expect(f).not.toHaveBeenCalled();
	});

	it('maps a rejected code to 401', async () => {
		const f: any = async () => json({}, 400);
		await expect(exchangeCode(ENV, 'code', f)).rejects.toMatchObject({ status: 401 });
	});
});

describe('Activity in a guild voice channel', () => {
	it('takes the guild from Discord, not the page, and lists its modules', async () => {
		enabledGuilds.add(G1);
		const { run, d } = session({ instance: guildInstance(), members: { [G1]: [ME] } });
		const out = await run();
		expect(out.context).toEqual({
			kind: 'guild',
			guildId: G1,
			channelId: '777777777777777777',
		});
		expect(out.guilds).toHaveLength(1);
		expect(out.guilds[0].modules[0]).toMatchObject({ id: 'timebox', enabled: true });
		expect(out.expiresAt).toBe(1000 + SESSION_TTL_SECONDS);
		// The viewer's own token is used for identity; the bot token for the rest.
		expect(d.calls).toContain('Bearer /users/@me');
		expect(d.calls.some((c) => c.startsWith('Bot /applications/'))).toBe(true);
		const claims = await verifySession(ENV.clientSecret, out.token, 1_000_000);
		expect(claims).toMatchObject({ u: ME, k: 'guild', g: [G1], c: '777777777777777777' });
	});

	it('shows a module as off when the server has not enabled it', async () => {
		const out = await session({ instance: guildInstance(), members: { [G1]: [ME] } }).run();
		expect(out.guilds[0].modules[0].enabled).toBe(false);
	});

	it('refuses someone who is not a member of the server', async () => {
		await expect(
			session({ instance: guildInstance(), members: { [G1]: [] } }).run()
		).rejects.toMatchObject({ status: 403, code: 'not_a_member' });
	});

	it('refuses a viewer who is not in the instance', async () => {
		await expect(
			session({ instance: guildInstance(G1, [FRIEND]), members: { [G1]: [ME] } }).run()
		).rejects.toMatchObject({ status: 403, code: 'not_in_instance' });
	});

	it('refuses a session Discord says is not running', async () => {
		await expect(session({ instanceStatus: 404 }).run()).rejects.toMatchObject({
			status: 403,
			code: 'no_instance',
		});
	});
});

describe('Activity in a DM', () => {
	const userGuilds = [
		{ id: G1, name: 'One', icon: null },
		{ id: G2, name: 'Two', icon: null },
	];

	it('shows only the servers the viewer is in that have a module on', async () => {
		enabledGuilds.add(G1);
		const out = await session({ instance: dmInstance([ME]), userGuilds }).run();
		expect(out.context).toEqual({ kind: 'dm' });
		expect(out.guilds.map((g) => g.id)).toEqual([G1]);
		const claims = await verifySession(ENV.clientSecret, out.token, 1_000_000);
		expect(claims).toMatchObject({ k: 'dm', g: [G1] });
	});

	it('shows nothing, not an error, when no server qualifies', async () => {
		const out = await session({ instance: dmInstance([ME]), userGuilds }).run();
		expect(out.guilds).toEqual([]);
	});

	it('in a group DM keeps only servers every connected person is a member of', async () => {
		enabledGuilds.add(G1).add(G2);
		const out = await session({
			instance: dmInstance([ME, FRIEND]),
			userGuilds,
			members: { [G1]: [ME, FRIEND], [G2]: [ME] },
		}).run();
		expect(out.guilds.map((g) => g.id)).toEqual([G1]);
	});

	it('shows no server data when a non-member joins the group DM', async () => {
		enabledGuilds.add(G1);
		const out = await session({
			instance: dmInstance([ME, FRIEND, STRANGER]),
			userGuilds,
			members: { [G1]: [ME, FRIEND] },
		}).run();
		expect(out.guilds).toEqual([]);
		const claims = await verifySession(ENV.clientSecret, out.token, 1_000_000);
		expect(claims?.g).toEqual([]);
	});

	it('refuses an oversized group before checking anyone', async () => {
		const users = Array.from({ length: MAX_DM_PARTICIPANTS + 1 }, (_, i) =>
			`${1000 + i}`.padEnd(18, '0')
		);
		users[0] = ME;
		const { run, d } = session({ instance: dmInstance(users), userGuilds });
		await expect(run()).rejects.toMatchObject({ status: 403, code: 'too_many' });
		expect(d.calls.filter((c) => c.includes('/members/'))).toHaveLength(0);
	});
});

describe('bad input and bad places', () => {
	it('refuses a missing token or instance id', async () => {
		await expect(session({}, 'inst-1', '').run()).rejects.toMatchObject({ status: 401 });
		await expect(session({}, '../etc').run()).rejects.toMatchObject({ status: 400 });
		await expect(session({}, null).run()).rejects.toMatchObject({ status: 400 });
	});

	it('refuses a token Discord does not accept', async () => {
		await expect(session({ meStatus: 401 }).run()).rejects.toMatchObject({ status: 401 });
	});

	it('refuses any place that is not a guild channel or a DM', async () => {
		const instance = { instance_id: 'inst-1', location: { kind: 'xx' }, users: [ME] };
		const err = await session({ instance })
			.run()
			.catch((e) => e);
		expect(err).toBeInstanceOf(ActivityError);
		expect(err).toMatchObject({ status: 403, code: 'unsupported_context' });
	});
});

describe('framing', () => {
	const html = () => new Response('<html>', { headers: { 'content-type': 'text/html' } });

	it('only the Activity path is framable', () => {
		expect(isFramablePath('/activity')).toBe(true);
		expect(isFramablePath('/activity/x')).toBe(true);
		expect(isFramablePath('/activityx')).toBe(false);
		expect(isFramablePath('/admin')).toBe(false);
		expect(isFramablePath('/')).toBe(false);
	});

	it('a framable page drops X-Frame-Options and enforces frame-ancestors for Discord', () => {
		const r = applySecurityHeaders(html(), { framable: true });
		expect(r.headers.has('X-Frame-Options')).toBe(false);
		expect(r.headers.get('Content-Security-Policy')).toBe(
			`frame-ancestors ${ACTIVITY_FRAME_ANCESTORS}`
		);
		expect(r.headers.get('Content-Security-Policy-Report-Only')).toContain(
			ACTIVITY_FRAME_ANCESTORS
		);
	});

	it('every other page still refuses to be framed', () => {
		const r = applySecurityHeaders(html());
		expect(r.headers.get('X-Frame-Options')).toBe('DENY');
		expect(r.headers.get('Content-Security-Policy-Report-Only')).toContain(
			"frame-ancestors 'none'"
		);
		expect(r.headers.has('Content-Security-Policy')).toBe(false);
	});
});

describe('keeping the Entry Point command through a global overwrite', () => {
	it('returns only Entry Point commands, shaped for the PUT', async () => {
		const f: any = async () =>
			json([
				{ id: '1', name: 'stats', type: 1, description: 'x' },
				{
					id: '2',
					name: 'launch',
					type: 4,
					description: 'Launch',
					handler: 2,
					contexts: [0, 1, 2],
					integration_types: [0],
				},
			]);
		expect(await getEntryPointCommands(ENV.clientId, 'tok', f)).toEqual([
			{
				id: '2',
				name: 'launch',
				description: 'Launch',
				type: 4,
				handler: 2,
				integration_types: [0],
				contexts: [0, 1, 2],
			},
		]);
	});

	it('returns nothing when the read fails, so registration still goes ahead', async () => {
		expect(
			await getEntryPointCommands(ENV.clientId, 'tok', (async () => json({}, 500)) as any)
		).toEqual([]);
		expect(
			await getEntryPointCommands(ENV.clientId, 'tok', (async () => {
				throw new Error('net');
			}) as any)
		).toEqual([]);
	});
});
