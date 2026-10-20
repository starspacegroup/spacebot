import { describe, expect, it, vi } from 'vitest';
import {
	SESSION_COOKIE,
	establishSession,
	getSessionSecret,
	signSession,
	verifySession,
} from '../lib/server/auth-session.js';
import { createCookieJar } from './helpers/cookie-jar.js';

vi.mock('$lib/db/local-runners.js', () => ({
	createRunnerJob: vi.fn(async () => ({ success: true, job: { id: 1 } })),
	revokeRunnerToken: vi.fn(),
	deleteRunnerToken: vi.fn(),
}));
vi.mock('$lib/db/users.js', () => ({
	listUsers: vi.fn(async () => ({ users: [], total: 0 })),
	upsertUser: vi.fn(),
	getUser: vi.fn(),
}));

const SECRET = 'x'.repeat(48);
const SUPERADMIN = '111111111111111111';
const VICTIM = '222222222222222222';

async function afterHook(cookies: Record<string, string>) {
	const jar = createCookieJar(cookies);
	const userId = await establishSession(jar as any, SECRET, true);
	return { jar, userId };
}

describe('signed session token', () => {
	it('round-trips a user id', async () => {
		const token = await signSession(VICTIM, 3600, SECRET);
		expect((await verifySession(token, SECRET))?.uid).toBe(VICTIM);
	});

	it('rejects a tampered payload, a wrong key, expiry and garbage', async () => {
		const token = await signSession(VICTIM, 3600, SECRET);
		const [v, body, sig] = token.split('.');
		const forgedBody = Buffer.from(
			JSON.stringify({ uid: SUPERADMIN, iat: 0, exp: 9e9 })
		).toString('base64url');
		expect(await verifySession(`${v}.${forgedBody}.${sig}`, SECRET)).toBeNull();
		expect(await verifySession(token, 'y'.repeat(48))).toBeNull();
		expect(await verifySession(token, SECRET, Date.now() + 3601_000)).toBeNull();
		expect(await verifySession('not-a-token', SECRET)).toBeNull();
		expect(await verifySession(`${v}.${body}`, SECRET)).toBeNull();
		expect(await verifySession(token, null)).toBeNull();
	});

	it('fails closed without SESSION_SECRET outside dev', () => {
		expect(getSessionSecret(() => undefined, false)).toBeNull();
		expect(getSessionSecret(() => 'short', false)).toBeNull();
		expect(getSessionSecret(() => SECRET, false)).toBe(SECRET);
		expect(getSessionSecret(() => undefined, true)).toBeTruthy();
	});
});

describe('establishSession (hooks invariant)', () => {
	it('clears a forged discord_user_id with no session', async () => {
		const { jar, userId } = await afterHook({
			discord_user_id: SUPERADMIN,
			discord_access_token: 'x',
		});
		expect(userId).toBeNull();
		expect(jar.get('discord_user_id')).toBeUndefined();
		expect(jar.get('discord_access_token')).toBeUndefined();
	});

	it('overrides a forged discord_user_id with the session identity', async () => {
		const token = await signSession(VICTIM, 3600, SECRET);
		const { jar, userId } = await afterHook({
			[SESSION_COOKIE]: token,
			discord_user_id: SUPERADMIN,
		});
		expect(userId).toBe(VICTIM);
		expect(jar.get('discord_user_id')).toBe(VICTIM);
	});

	it('leaves an anonymous request untouched', async () => {
		const { jar, userId } = await afterHook({});
		expect(userId).toBeNull();
		expect(jar.written.size).toBe(0);
	});
});

describe('forged cookie against representative APIs', () => {
	it('account runner job creation → 401', async () => {
		const { jar } = await afterHook({ discord_user_id: VICTIM });
		const { POST }: any = await import('../routes/api/account/runners/[id]/+server.js');
		const res = await POST({
			params: { id: '1' },
			request: new Request('http://x/', { method: 'POST', body: '{"command":"id"}' }),
			cookies: jar,
			platform: { env: { DB: {} } },
		});
		expect(res.status).toBe(401);
	});

	it('superadmin users API → denied', async () => {
		const { jar } = await afterHook({ discord_user_id: SUPERADMIN });
		const { GET }: any = await import('../routes/api/superadmin/users/+server.js');
		const res = await GET({
			cookies: jar,
			platform: { env: { DB: {}, ADMIN_USER_IDS: SUPERADMIN } },
			url: new URL('http://x/api/superadmin/users'),
		});
		expect(res.status).toBe(403);
	});

	it('authenticateRequest → 401', async () => {
		const { jar } = await afterHook({ discord_user_id: SUPERADMIN });
		const { authenticateRequest } = await import('../lib/api-auth.js');
		const auth = await authenticateRequest(new Request('http://x/'), jar as any, {});
		expect(auth.authenticated).toBe(false);
		expect((auth as any).status).toBe(401);
	});

	it('a real session for the superadmin is honoured', async () => {
		const token = await signSession(SUPERADMIN, 3600, SECRET);
		const { jar } = await afterHook({ [SESSION_COOKIE]: token });
		const { GET }: any = await import('../routes/api/superadmin/users/+server.js');
		const res = await GET({
			cookies: jar,
			platform: { env: { DB: {}, ADMIN_USER_IDS: SUPERADMIN } },
			url: new URL('http://x/api/superadmin/users'),
		});
		expect(res.status).toBe(200);
	});
});
