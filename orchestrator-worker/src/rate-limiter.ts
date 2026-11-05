/**
 * RateLimiter Durable Object — one instance per `group:identity`.
 *
 * Replaces three D1 round-trips per limited request (a global expiry DELETE,
 * an upsert, a SELECT on the shared 1.2 GB database) with one call to a
 * SQLite-backed object that owns its own counter. The increment and the read
 * are one statement (`... RETURNING count`) inside one object, so N parallel
 * requests get N distinct counts and at most `max` of them are allowed.
 *
 * Pages cannot host Durable Object classes, so the class lives here and the
 * Pages app binds it with `script_name = "spacebot-ai-orchestrator"`.
 *
 * Protocol (fetch, so it works with the Pages compatibility date, which
 * predates DO RPC): POST /hit {windowStart, expiresAt, now} -> {count}.
 * The caller computes the window and makes the decision with the same code
 * the D1 path uses (src/lib/server/rate-limit-core.ts).
 *
 * Cleanup: an alarm at the newest window's expiry deletes expired rows, and
 * empties storage when nothing is left, so idle identities cost nothing.
 */

/** The slice of DO SqlStorage this needs. Lets tests drive it with SQLite. */
export interface SqlLike {
	exec(query: string, ...bindings: unknown[]): { toArray(): any[] };
}

export class RateLimiterStore {
	constructor(private sql: SqlLike) {
		sql.exec(
			`CREATE TABLE IF NOT EXISTS hits (
				window_start INTEGER PRIMARY KEY,
				count INTEGER NOT NULL,
				expires_at INTEGER NOT NULL
			)`
		);
	}

	/** Count one request in `windowStart`; returns the count after it. */
	hit(windowStart: number, expiresAt: number, now: number): number {
		const rows = this.sql
			.exec(
				`INSERT INTO hits (window_start, count, expires_at) VALUES (?, 1, ?)
				 ON CONFLICT(window_start) DO UPDATE SET count = count + 1
				 RETURNING count`,
				windowStart,
				expiresAt
			)
			.toArray();
		this.sql.exec(`DELETE FROM hits WHERE expires_at < ?`, now);
		return Number(rows[0]?.count ?? 0);
	}

	/** Drop expired windows. Returns the earliest expiry still stored, or null. */
	sweep(now: number): number | null {
		this.sql.exec(`DELETE FROM hits WHERE expires_at < ?`, now);
		const row = this.sql.exec(`SELECT MIN(expires_at) AS next FROM hits`).toArray()[0];
		return row?.next == null ? null : Number(row.next);
	}
}

interface DOState {
	storage: {
		sql: SqlLike;
		getAlarm(): Promise<number | null>;
		setAlarm(at: number): Promise<void>;
		deleteAll(): Promise<void>;
	};
}

export class RateLimiter {
	private store: RateLimiterStore;

	constructor(
		private state: DOState,
		_env: unknown
	) {
		this.store = new RateLimiterStore(state.storage.sql);
	}

	async fetch(request: Request): Promise<Response> {
		if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
		let body: any;
		try {
			body = await request.json();
		} catch {
			return new Response('bad json', { status: 400 });
		}
		const windowStart = Number(body?.windowStart);
		const expiresAt = Number(body?.expiresAt);
		const now = Number(body?.now);
		if (![windowStart, expiresAt, now].every(Number.isFinite) || expiresAt <= windowStart) {
			return new Response('bad window', { status: 400 });
		}

		const count = this.store.hit(windowStart, expiresAt, now);

		// One alarm is enough: it re-arms itself until storage is empty.
		if ((await this.state.storage.getAlarm()) == null) {
			await this.state.storage.setAlarm((expiresAt + 1) * 1000);
		}
		return Response.json({ count });
	}

	async alarm(): Promise<void> {
		const next = this.store.sweep(Math.floor(Date.now() / 1000));
		if (next == null) await this.state.storage.deleteAll();
		else await this.state.storage.setAlarm((next + 1) * 1000);
	}
}
