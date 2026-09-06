import { beforeEach, describe, expect, it } from 'vitest';
import {
	consumeAuthorizationCode,
	generateAuthorizationCode,
	generateClientSecret,
	hashToken,
	issueAuthorizationCode,
	parseConnectClient,
	parseSqliteTime,
	timingSafeEqual,
	validateRedirectUri,
	validateScopes,
	verifyClientSecret,
} from '../lib/db/connect-clients.js';

/**
 * Minimal in-memory stand-in for the two tables, enough to exercise the
 * single-use and binding rules without a real D1.
 */
function fakeDb() {
	const clients = new Map<string, any>();
	const codes = new Map<string, any>();

	const db: any = {
		clients,
		codes,
		prepare(sql: string) {
			const stmt = {
				_binds: [] as any[],
				bind(...args: any[]) {
					stmt._binds = args;
					return stmt;
				},
				async first() {
					if (sql.includes('FROM connect_clients')) {
						return clients.get(String(stmt._binds[0])) ?? null;
					}
					if (sql.includes('FROM connect_authorization_codes')) {
						return codes.get(String(stmt._binds[0])) ?? null;
					}
					return null;
				},
				async all() {
					return { results: [...clients.values()] };
				},
				async run() {
					if (sql.startsWith('INSERT INTO connect_authorization_codes')) {
						const [
							code_hash,
							client_id,
							guild_id,
							redirect_uri,
							scopes,
							approved_by,
							expires_at,
						] = stmt._binds;
						codes.set(code_hash, {
							code_hash,
							client_id,
							guild_id,
							redirect_uri,
							scopes,
							approved_by,
							expires_at,
							consumed_at: null,
						});
						return { meta: { changes: 1 } };
					}
					if (sql.includes('SET consumed_at')) {
						const row = codes.get(String(stmt._binds[0]));
						if (!row || row.consumed_at) return { meta: { changes: 0 } };
						row.consumed_at = new Date().toISOString();
						return { meta: { changes: 1 } };
					}
					return { meta: { changes: 1 } };
				},
			};
			// `.run().catch()` is used for opportunistic cleanup.
			const originalRun = stmt.run.bind(stmt);
			stmt.run = (async () => originalRun()) as any;
			return stmt;
		},
	};
	return db;
}

describe('timingSafeEqual', () => {
	it('matches equal strings and rejects different ones', () => {
		expect(timingSafeEqual('abc123', 'abc123')).toBe(true);
		expect(timingSafeEqual('abc123', 'abc124')).toBe(false);
	});

	it('rejects different lengths and non-strings without throwing', () => {
		expect(timingSafeEqual('abc', 'abcd')).toBe(false);
		expect(timingSafeEqual(null as any, 'abc')).toBe(false);
	});

	it('compares every character rather than stopping at the first mismatch', () => {
		// A prefix match must not read as closer than a total mismatch.
		expect(timingSafeEqual('aaaaaaaa', 'aaaaaaab')).toBe(false);
		expect(timingSafeEqual('aaaaaaaa', 'bbbbbbbb')).toBe(false);
	});
});

describe('validateRedirectUri', () => {
	it('accepts absolute https URLs', () => {
		expect(validateRedirectUri('https://starspace.group/callback').valid).toBe(true);
	});

	it('allows http only for localhost, for development', () => {
		expect(validateRedirectUri('http://localhost:5173/cb').valid).toBe(true);
		expect(validateRedirectUri('http://example.com/cb').valid).toBe(false);
	});

	it('rejects relative URLs and non-http schemes', () => {
		expect(validateRedirectUri('/callback').valid).toBe(false);
		expect(validateRedirectUri('javascript:alert(1)').valid).toBe(false);
	});

	it('rejects a fragment, which the client could reinterpret', () => {
		expect(validateRedirectUri('https://example.com/cb#x').valid).toBe(false);
	});
});

describe('validateScopes', () => {
	it('rejects scopes SpaceBot does not define', () => {
		expect(validateScopes(['voice:read', 'stats:read']).valid).toBe(true);
		expect(validateScopes(['voice:read', 'admin:everything']).valid).toBe(false);
	});
});

describe('parseConnectClient', () => {
	it('never exposes the stored secret hash', () => {
		const parsed: any = parseConnectClient({
			client_id: 'c',
			name: 'C',
			client_secret_hash: 'SECRET-HASH',
			redirect_uris: '["https://x.test/cb"]',
			allowed_scopes: '["voice:read"]',
			enabled: 1,
		});

		expect(parsed.client_secret_hash).toBeUndefined();
		expect(Object.values(parsed)).not.toContain('SECRET-HASH');
	});

	it('tolerates malformed JSON columns rather than throwing', () => {
		const parsed: any = parseConnectClient({
			client_id: 'c',
			name: 'C',
			client_secret_hash: 'h',
			redirect_uris: 'not json',
			allowed_scopes: null,
			enabled: 0,
		});
		expect(parsed.redirect_uris).toEqual([]);
		expect(parsed.allowed_scopes).toEqual([]);
		expect(parsed.enabled).toBe(false);
	});
});

describe('parseSqliteTime', () => {
	it("reads SQLite's zone-less timestamps as UTC", () => {
		expect(parseSqliteTime('2026-01-01 12:00:00')?.toISOString()).toBe(
			'2026-01-01T12:00:00.000Z'
		);
	});

	it('returns null for junk, which callers treat as expired', () => {
		expect(parseSqliteTime('whenever')).toBeNull();
		expect(parseSqliteTime(null)).toBeNull();
	});
});

describe('verifyClientSecret', () => {
	let db: any;
	let secret: string;

	beforeEach(async () => {
		db = fakeDb();
		secret = generateClientSecret();
		db.clients.set('site', {
			client_id: 'site',
			name: 'Site',
			client_secret_hash: await hashToken(secret),
			redirect_uris: '["https://site.test/cb"]',
			allowed_scopes: '["voice:read"]',
			enabled: 1,
		});
	});

	it('accepts the right secret', async () => {
		const client = await verifyClientSecret(db, 'site', secret);
		expect(client?.client_id).toBe('site');
	});

	it('rejects a wrong secret', async () => {
		expect(await verifyClientSecret(db, 'site', generateClientSecret())).toBeNull();
	});

	it('rejects a disabled client even with the right secret', async () => {
		db.clients.get('site').enabled = 0;
		expect(await verifyClientSecret(db, 'site', secret)).toBeNull();
	});

	it('rejects an unknown client', async () => {
		expect(await verifyClientSecret(db, 'nope', secret)).toBeNull();
	});
});

describe('authorization codes', () => {
	let db: any;

	beforeEach(() => {
		db = fakeDb();
	});

	async function issue(overrides: Record<string, any> = {}) {
		return issueAuthorizationCode(db, {
			clientId: 'site',
			guildId: 'guild1',
			redirectUri: 'https://site.test/cb',
			scopes: ['voice:read', 'stats:read'],
			approvedBy: 'user1',
			...overrides,
		});
	}

	it('stores only the hash of the code, never the code itself', async () => {
		const issued = await issue();
		const stored = [...db.codes.values()][0];

		expect(stored.code_hash).toBe(await hashToken(issued.code));
		expect(JSON.stringify(stored)).not.toContain(issued.code);
	});

	it('redeems once and returns the approved grant', async () => {
		const issued = await issue();
		const result = await consumeAuthorizationCode(db, {
			code: issued.code,
			clientId: 'site',
			redirectUri: 'https://site.test/cb',
		});

		expect(result).toMatchObject({
			success: true,
			guildId: 'guild1',
			scopes: ['voice:read', 'stats:read'],
			approvedBy: 'user1',
		});
	});

	it('refuses a second redemption of the same code', async () => {
		const issued = await issue();
		const args = {
			code: issued.code,
			clientId: 'site',
			redirectUri: 'https://site.test/cb',
		};

		expect((await consumeAuthorizationCode(db, args)).success).toBe(true);
		expect((await consumeAuthorizationCode(db, args)).success).toBe(false);
	});

	it('refuses a code presented by a different client', async () => {
		const issued = await issue();
		const result = await consumeAuthorizationCode(db, {
			code: issued.code,
			clientId: 'someone-else',
			redirectUri: 'https://site.test/cb',
		});
		expect(result.success).toBe(false);
	});

	it('refuses a code redeemed against a different redirect_uri', async () => {
		const issued = await issue();
		const result = await consumeAuthorizationCode(db, {
			code: issued.code,
			clientId: 'site',
			redirectUri: 'https://evil.test/cb',
		});
		expect(result.success).toBe(false);
	});

	it('refuses an expired code', async () => {
		const issued = await issue();
		const stored = [...db.codes.values()][0];
		stored.expires_at = new Date(Date.now() - 1000).toISOString();

		const result = await consumeAuthorizationCode(db, {
			code: issued.code,
			clientId: 'site',
			redirectUri: 'https://site.test/cb',
		});
		expect(result.success).toBe(false);
	});

	it('treats an unparseable expiry as expired rather than valid', async () => {
		const issued = await issue();
		[...db.codes.values()][0].expires_at = 'sometime';

		const result = await consumeAuthorizationCode(db, {
			code: issued.code,
			clientId: 'site',
			redirectUri: 'https://site.test/cb',
		});
		expect(result.success).toBe(false);
	});

	it('refuses a code that was never issued', async () => {
		const result = await consumeAuthorizationCode(db, {
			code: generateAuthorizationCode(),
			clientId: 'site',
			redirectUri: 'https://site.test/cb',
		});
		expect(result.success).toBe(false);
	});

	it('gives the same message for every rejection', async () => {
		const issued = await issue();
		const wrongClient = await consumeAuthorizationCode(db, {
			code: issued.code,
			clientId: 'other',
			redirectUri: 'https://site.test/cb',
		});
		const unknownCode = await consumeAuthorizationCode(db, {
			code: generateAuthorizationCode(),
			clientId: 'site',
			redirectUri: 'https://site.test/cb',
		});

		// A caller probing must not learn which part was wrong.
		expect(wrongClient.error).toBe(unknownCode.error);
	});

	it('issues codes with real entropy and a distinguishable prefix', async () => {
		const a = await issue();
		const b = await issue();
		expect(a.code).not.toBe(b.code);
		expect(a.code.startsWith('sbc_')).toBe(true);
		expect(a.code.length).toBeGreaterThan(60);
	});
});
