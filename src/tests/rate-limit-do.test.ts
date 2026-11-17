/**
 * The RateLimiter Durable Object and the D1 fallback must make the same
 * decision for every request (house rule: rate-limit logic carries a property
 * test). Both are driven against real SQLite: the DO's store through a
 * SqlStorage-shaped adapter, the D1 path through the D1 helper.
 */
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { createSqliteD1 } from './helpers/sqlite-d1.js';
import {
	RateLimiter,
	RateLimiterStore,
	type SqlLike,
} from '../../orchestrator-worker/src/rate-limiter.js';
import { decide, rateWindow } from '../lib/server/rate-limit-core.js';
import { consumeQuota, hitD1Limiter } from '../lib/server/rate-limit.js';

const D1_SCHEMA = `
	CREATE TABLE api_rate_limits (
		key TEXT PRIMARY KEY, route_group TEXT NOT NULL, window_start INTEGER NOT NULL,
		request_count INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
`;

function sqlStorage(): SqlLike & { close(): void } {
	const db = new Database(':memory:');
	return {
		exec(query: string, ...b: unknown[]) {
			const st = db.prepare(query);
			const rows = st.reader ? st.all(...b) : (st.run(...b), []);
			return { toArray: () => rows as any[] };
		},
		close: () => db.close(),
	};
}

/** Seeded PRNG (mulberry32) so a failure is reproducible from its seed. */
function rng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Per-identity DO stores, the way idFromName(group:identity) partitions them. */
class FakeNamespace {
	stores = new Map<string, RateLimiterStore>();
	storages: Array<{ close(): void }> = [];
	store(name: string) {
		let s = this.stores.get(name);
		if (!s) {
			const sql = sqlStorage();
			this.storages.push(sql);
			s = new RateLimiterStore(sql);
			this.stores.set(name, s);
		}
		return s;
	}
	close() {
		for (const s of this.storages) s.close();
	}
}

describe('RateLimiter DO vs D1: identical decisions', () => {
	it('agrees on 200 random request sequences', async () => {
		for (let seed = 1; seed <= 200; seed++) {
			const r = rng(seed);
			const d1 = createSqliteD1(D1_SCHEMA);
			const ns = new FakeNamespace();
			const windowSeconds = 1 + Math.floor(r() * 120);
			const max = Math.floor(r() * 12); // includes 0
			const groups = ['api', 'auth', 'listing-ai'];
			const ids = ['user:1', 'user:2', 'ip:10.0.0.1', 'bearer:sb_live_x'];
			let now = 1_700_000_000 + Math.floor(r() * 100_000);

			for (let i = 0; i < 60; i++) {
				now += Math.floor(r() * r() * windowSeconds * 1.5); // bursts and gaps
				const g = groups[Math.floor(r() * groups.length)];
				const id = ids[Math.floor(r() * ids.length)];
				const win = rateWindow(now, windowSeconds);

				const viaD1 = decide(await hitD1Limiter(d1, g, id, win, now), max, win.expiresAt);
				const viaDO = decide(
					ns.store(`${g}:${id}`).hit(win.windowStart, win.expiresAt, now),
					max,
					win.expiresAt
				);
				if (JSON.stringify(viaD1) !== JSON.stringify(viaDO)) {
					throw new Error(
						`seed ${seed} step ${i}: D1 ${JSON.stringify(viaD1)} DO ${JSON.stringify(viaDO)}`
					);
				}
			}
			d1.close();
			ns.close();
		}
	});

	it('window math: start aligned, expiry one window later, now inside it', () => {
		const r = rng(7);
		for (let i = 0; i < 1000; i++) {
			const now = Math.floor(r() * 2e9);
			const w = 1 + Math.floor(r() * 3600);
			const { windowStart, expiresAt } = rateWindow(now, w);
			expect(windowStart % w).toBe(0);
			expect(expiresAt - windowStart).toBe(w);
			expect(now >= windowStart && now < expiresAt).toBe(true);
		}
	});
});

describe('concurrency: N parallel calls never allow more than max', () => {
	const N = 50;
	const max = 7;

	it('DO object (fetch path, one instance)', async () => {
		const sql = sqlStorage();
		let alarm: number | null = null;
		const obj = new RateLimiter(
			{
				storage: {
					sql,
					getAlarm: async () => alarm,
					setAlarm: async (t: number) => void (alarm = t),
					deleteAll: async () => {},
				},
			},
			{}
		);
		const now = 1_700_000_030;
		const win = rateWindow(now, 60);
		const counts = await Promise.all(
			Array.from({ length: N }, async () => {
				const res = await obj.fetch(
					new Request('https://rate-limiter/hit', {
						method: 'POST',
						body: JSON.stringify({ ...win, now }),
					})
				);
				return Number(((await res.json()) as any).count);
			})
		);
		expect(new Set(counts).size).toBe(N); // every request got its own count
		expect(counts.filter((c) => decide(c, max, win.expiresAt).allowed)).toHaveLength(max);
		expect(alarm).toBe((win.expiresAt + 1) * 1000);
		sql.close();
	});

	it('D1 fallback (statements interleave across awaits)', async () => {
		const d1 = createSqliteD1(D1_SCHEMA);
		const now = 1_700_000_030;
		const win = rateWindow(now, 60);
		const counts = await Promise.all(
			Array.from({ length: N }, () => hitD1Limiter(d1, 'api', 'user:1', win, now))
		);
		// Interleaving can make two calls read the same (higher) count, which only
		// ever denies more: an allowed call saw a count <= max, so at most max pass.
		const allowed = counts.filter((c) => decide(c, max, win.expiresAt).allowed).length;
		expect(allowed).toBeLessThanOrEqual(max);
		d1.close();
	});

	it('consumeQuota through a DO binding', async () => {
		const ns = new FakeNamespace();
		const binding = {
			idFromName: (name: string) => name,
			get: (name: string) => ({
				fetch: async (_url: string, init: any) => {
					const b = JSON.parse(init.body);
					return Response.json({
						count: ns.store(name).hit(b.windowStart, b.expiresAt, b.now),
					});
				},
			}),
		};
		const platform = { env: { RATE_LIMITER: binding } };
		const results = await Promise.all(
			Array.from({ length: N }, () =>
				consumeQuota(null, 'listing-ai', 'guild-1', { max, windowSeconds: 600 }, platform)
			)
		);
		expect(results.filter(Boolean)).toHaveLength(max);
		ns.close();
	});
});

describe('fallbacks', () => {
	it('DO error falls back to D1', async () => {
		const d1 = createSqliteD1(D1_SCHEMA);
		const broken = {
			idFromName: () => 'x',
			get: () => ({ fetch: async () => new Response('boom', { status: 500 }) }),
		};
		const platform = { env: { RATE_LIMITER: broken } };
		const q = { max: 2, windowSeconds: 600 };
		expect(await consumeQuota(d1, 'g', 'i', q, platform)).not.toBeNull();
		expect(await consumeQuota(d1, 'g', 'i', q, platform)).not.toBeNull();
		expect(await consumeQuota(d1, 'g', 'i', q, platform)).toBeNull();
		d1.close();
	});

	it('no binding: D1 path exactly as before; no DB: fail open', async () => {
		const d1 = createSqliteD1(D1_SCHEMA);
		const q = { max: 1, windowSeconds: 600 };
		expect(await consumeQuota(d1, 'g', 'i', q)).not.toBeNull();
		expect(await consumeQuota(d1, 'g', 'i', q)).toBeNull();
		expect(await consumeQuota(null, 'g', 'i', q)).toEqual({ remaining: 1, resetAt: 0 });
		d1.close();
	});

	it('DO store sweeps expired windows', () => {
		const sql = sqlStorage();
		const s = new RateLimiterStore(sql);
		s.hit(0, 60, 10);
		s.hit(60, 120, 70);
		expect(s.sweep(100)).toBe(120);
		expect(s.sweep(200)).toBeNull();
		sql.close();
	});
});
