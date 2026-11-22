/**
 * Cross-server logs for the superadmin: what people changed, what happened in servers, what
 * went wrong, and one person's timeline. Read-only. Every query is bounded (a time window and a
 * row limit) and every user-supplied value is bound, never spliced into SQL.
 */

type Db = any;

export interface LogFilter {
	guildId?: string;
	userId?: string;
	/** Look back this many hours (1 to 720). */
	hours?: number;
	/** Rows to return (1 to 100). */
	limit?: number;
	/** Only rows older than this timestamp (the last row of the previous page). */
	before?: string;
}

export interface LogRow {
	key: string;
	at: string;
	kind: string;
	guild_id: string | null;
	user_id: string | null;
	user_name: string | null;
	title: string;
	detail: string | null;
	/** True worked, false failed, null not applicable. */
	ok: boolean | null;
}

export const MAX_HOURS = 720;
export const MAX_LIMIT = 100;
export const DEFAULT_HOURS = 168;
export const DEFAULT_LIMIT = 50;

const SNOWFLAKE = /^\d{17,20}$/;
const STAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/;

function num(value: unknown, fallback: number, min: number, max: number): number {
	const n =
		typeof value === 'number' || typeof value === 'string' ? Math.trunc(Number(value)) : NaN;
	return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/** A filter with every field checked and clamped. Anything wrong is dropped, not trusted. */
export function cleanFilter(raw: LogFilter | null | undefined) {
	const text = (v: unknown) =>
		typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
	const guild = text(raw?.guildId);
	const user = text(raw?.userId);
	const stamp = text(raw?.before);
	return {
		guildId: SNOWFLAKE.test(guild) ? guild : undefined,
		userId: /^\d{1,25}$/.test(user) ? user : undefined,
		before: STAMP.test(stamp) ? stamp.replace('T', ' ').slice(0, 19) : undefined,
		hours: num(raw?.hours, DEFAULT_HOURS, 1, MAX_HOURS),
		limit: num(raw?.limit, DEFAULT_LIMIT, 1, MAX_LIMIT),
	};
}

const sql = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 19);

/** The guild a dashboard path belongs to, if it names one. */
export function guildOfPath(path: string): string | null {
	return /\/(\d{17,20})(?:\/|$|\?)/.exec(String(path))?.[1] ?? null;
}

/** Which part of the site a request touched. */
export function scopeOfPath(path: string): 'superadmin' | 'server' | 'account' | 'other' {
	const p = String(path);
	if (p.startsWith('/admin/superadmin') || p.startsWith('/api/superadmin')) return 'superadmin';
	if (guildOfPath(p)) return 'server';
	if (p.startsWith('/account') || p.startsWith('/api/billing')) return 'account';
	return 'other';
}

/** A short title for a request: "POST /admin/123/personality ?/enable". */
export function describeRequest(method: string, path: string, query?: string | null): string {
	const q = query && query.startsWith('?') ? query : query ? `?${query}` : '';
	// A SvelteKit form action reads as "?/name"; other query strings are noise here.
	const action = /^\?\/[\w-]+/.exec(q)?.[0] ?? '';
	return `${String(method).toUpperCase()} ${path}${action ? ` ${action}` : ''}`.slice(0, 200);
}

function window(f: ReturnType<typeof cleanFilter>, now: Date, column: string) {
	const clauses = [`${column} >= ?`];
	const binds: unknown[] = [sql(new Date(now.getTime() - f.hours * 3_600_000))];
	if (f.before) {
		clauses.push(`${column} < ?`);
		binds.push(f.before);
	}
	return { clauses, binds };
}

const byNewest = (a: LogRow, b: LogRow) =>
	a.at < b.at ? 1 : a.at > b.at ? -1 : a.key < b.key ? 1 : -1;

const take = (rows: LogRow[], limit: number) => [...rows].sort(byNewest).slice(0, limit);

async function rows<T>(db: Db, query: string, binds: unknown[]): Promise<T[]> {
	const res = await db
		.prepare(query)
		.bind(...binds)
		.all();
	return (res?.results ?? []) as T[];
}

// ---- Audit trail: what people changed ----------------------------------------------------

/** Every write a signed-in person made (anything that is not a plain page read). */
export async function auditTrail(db: Db, raw?: LogFilter, now = new Date()): Promise<LogRow[]> {
	if (!db) return [];
	const f = cleanFilter(raw);
	const w = window(f, now, 'a.created_at');
	const clauses = [...w.clauses, `a.method != 'GET'`];
	const binds = [...w.binds];
	if (f.userId) {
		clauses.push('a.user_id = ?');
		binds.push(f.userId);
	}
	if (f.guildId) {
		clauses.push('a.path LIKE ?');
		binds.push(`%/${f.guildId}%`);
	}
	const found = await rows<any>(
		db,
		`SELECT a.id, a.created_at, a.user_id, a.method, a.path, a.query_string, a.status_code, u.username
		 FROM user_activity_logs a LEFT JOIN users u ON u.id = a.user_id
		 WHERE ${clauses.join(' AND ')} ORDER BY a.created_at DESC, a.id DESC LIMIT ?`,
		[...binds, f.limit]
	);
	return found.map((r) => ({
		key: `a${r.id}`,
		at: r.created_at,
		kind: scopeOfPath(r.path),
		guild_id: guildOfPath(r.path),
		user_id: r.user_id,
		user_name: r.username ?? null,
		title: describeRequest(r.method, r.path, r.query_string),
		detail: r.status_code ? `HTTP ${r.status_code}` : null,
		ok: r.status_code ? r.status_code < 400 : null,
	}));
}

// ---- Activity: what happened in servers ---------------------------------------------------

/** Commands run and events recorded, from every server. */
export async function activityFeed(db: Db, raw?: LogFilter, now = new Date()): Promise<LogRow[]> {
	if (!db) return [];
	const f = cleanFilter(raw);

	const cw = window(f, now, 'c.created_at');
	const cClauses = [...cw.clauses];
	const cBinds = [...cw.binds];
	if (f.guildId) {
		cClauses.push('c.guild_id = ?');
		cBinds.push(f.guildId);
	}
	if (f.userId) {
		cClauses.push('c.user_id = ?');
		cBinds.push(f.userId);
	}
	const commands = await rows<any>(
		db,
		`SELECT c.id, c.created_at, c.guild_id, c.user_id, c.user_name, c.success, c.error_message,
		        c.execution_time_ms, cm.name AS command
		 FROM command_logs c LEFT JOIN commands cm ON cm.id = c.command_id
		 WHERE ${cClauses.join(' AND ')} ORDER BY c.created_at DESC, c.id DESC LIMIT ?`,
		[...cBinds, f.limit]
	);

	const ew = window(f, now, 'e.created_at');
	const eClauses = [...ew.clauses];
	const eBinds = [...ew.binds];
	if (f.guildId) {
		eClauses.push('e.guild_id = ?');
		eBinds.push(f.guildId);
	}
	if (f.userId) {
		eClauses.push('e.actor_id = ?');
		eBinds.push(f.userId);
	}
	const events = await rows<any>(
		db,
		`SELECT e.id, e.created_at, e.guild_id, e.event_type, e.event_category, e.actor_id, e.actor_name,
		        e.target_name, e.channel_name
		 FROM event_logs e WHERE ${eClauses.join(' AND ')} ORDER BY e.created_at DESC, e.id DESC LIMIT ?`,
		[...eBinds, f.limit]
	);

	return take(
		[
			...commands.map((r): LogRow => ({
				key: `c${r.id}`,
				at: r.created_at,
				kind: 'command',
				guild_id: r.guild_id,
				user_id: r.user_id,
				user_name: r.user_name ?? null,
				title: `/${r.command ?? 'command'}`,
				detail: r.success
					? r.execution_time_ms
						? `${r.execution_time_ms} ms`
						: null
					: r.error_message,
				ok: Boolean(r.success),
			})),
			...events.map((r): LogRow => ({
				key: `e${r.id}`,
				at: r.created_at,
				kind: r.event_category || 'event',
				guild_id: r.guild_id,
				user_id: r.actor_id ?? null,
				user_name: r.actor_name ?? null,
				title: r.event_type,
				detail:
					[r.target_name, r.channel_name && `#${r.channel_name}`]
						.filter(Boolean)
						.join(' · ') || null,
				ok: null,
			})),
		],
		f.limit
	);
}

// ---- Errors: what went wrong ---------------------------------------------------------------

/** Failed commands and automations, failed command syncs, bot errors and failed requests. */
export async function errorFeed(db: Db, raw?: LogFilter, now = new Date()): Promise<LogRow[]> {
	if (!db) return [];
	const f = cleanFilter(raw);
	const out: LogRow[] = [];

	const cw = window(f, now, 'c.created_at');
	const cClauses = [...cw.clauses, 'c.success = 0'];
	const cBinds = [...cw.binds];
	if (f.guildId) {
		cClauses.push('c.guild_id = ?');
		cBinds.push(f.guildId);
	}
	if (f.userId) {
		cClauses.push('c.user_id = ?');
		cBinds.push(f.userId);
	}
	for (const r of await rows<any>(
		db,
		`SELECT c.id, c.created_at, c.guild_id, c.user_id, c.user_name, c.error_message, cm.name AS command
		 FROM command_logs c LEFT JOIN commands cm ON cm.id = c.command_id
		 WHERE ${cClauses.join(' AND ')} ORDER BY c.created_at DESC, c.id DESC LIMIT ?`,
		[...cBinds, f.limit]
	)) {
		out.push({
			key: `c${r.id}`,
			at: r.created_at,
			kind: 'command',
			guild_id: r.guild_id,
			user_id: r.user_id,
			user_name: r.user_name ?? null,
			title: `/${r.command ?? 'command'} failed`,
			detail: r.error_message,
			ok: false,
		});
	}

	// Automations and syncs are about a server, not a person.
	if (!f.userId) {
		const aw = window(f, now, 'l.created_at');
		const aClauses = [...aw.clauses, 'l.success = 0'];
		const aBinds = [...aw.binds];
		if (f.guildId) {
			aClauses.push('l.guild_id = ?');
			aBinds.push(f.guildId);
		}
		for (const r of await rows<any>(
			db,
			`SELECT l.id, l.created_at, l.guild_id, l.trigger_event, l.error_message
			 FROM automation_logs l WHERE ${aClauses.join(' AND ')} ORDER BY l.created_at DESC, l.id DESC LIMIT ?`,
			[...aBinds, f.limit]
		)) {
			out.push({
				key: `l${r.id}`,
				at: r.created_at,
				kind: 'automation',
				guild_id: r.guild_id,
				user_id: null,
				user_name: null,
				title: `Automation failed (${r.trigger_event})`,
				detail: r.error_message,
				ok: false,
			});
		}

		const sw = window(f, now, 's.attempted_at');
		const sClauses = [...sw.clauses, `s.last_error IS NOT NULL`, `s.last_error != ''`];
		const sBinds = [...sw.binds];
		if (f.guildId) {
			sClauses.push('s.guild_id = ?');
			sBinds.push(f.guildId);
		}
		for (const r of await rows<any>(
			db,
			`SELECT s.guild_id, s.attempted_at, s.last_error FROM guild_command_sync s
			 WHERE ${sClauses.join(' AND ')} ORDER BY s.attempted_at DESC LIMIT ?`,
			[...sBinds, f.limit]
		)) {
			out.push({
				key: `s${r.guild_id}`,
				at: r.attempted_at,
				kind: 'sync',
				guild_id: r.guild_id,
				user_id: null,
				user_name: null,
				title: 'Command sync failed',
				detail: r.last_error,
				ok: false,
			});
		}

		// Bot-wide errors have no server. Skip them when one server is asked for.
		if (!f.guildId) {
			const gw = window(f, now, 'g.logged_at');
			for (const r of await rows<any>(
				db,
				`SELECT g.id, g.logged_at, g.message, g.source FROM gateway_logs g
				 WHERE ${gw.clauses.join(' AND ')} AND lower(g.level) = 'error'
				 ORDER BY g.logged_at DESC, g.id DESC LIMIT ?`,
				[...gw.binds, f.limit]
			)) {
				out.push({
					key: `g${r.id}`,
					at: r.logged_at,
					kind: 'bot',
					guild_id: null,
					user_id: null,
					user_name: null,
					title: `Bot error (${r.source})`,
					detail: String(r.message).slice(0, 300),
					ok: false,
				});
			}
		}
	}

	// Requests that failed on our side.
	const rw = window(f, now, 'a.created_at');
	const rClauses = [...rw.clauses, 'a.status_code >= 500'];
	const rBinds = [...rw.binds];
	if (f.userId) {
		rClauses.push('a.user_id = ?');
		rBinds.push(f.userId);
	}
	if (f.guildId) {
		rClauses.push('a.path LIKE ?');
		rBinds.push(`%/${f.guildId}%`);
	}
	for (const r of await rows<any>(
		db,
		`SELECT a.id, a.created_at, a.user_id, a.method, a.path, a.query_string, a.status_code, u.username
		 FROM user_activity_logs a LEFT JOIN users u ON u.id = a.user_id
		 WHERE ${rClauses.join(' AND ')} ORDER BY a.created_at DESC, a.id DESC LIMIT ?`,
		[...rBinds, f.limit]
	)) {
		out.push({
			key: `a${r.id}`,
			at: r.created_at,
			kind: 'request',
			guild_id: guildOfPath(r.path),
			user_id: r.user_id,
			user_name: r.username ?? null,
			title: describeRequest(r.method, r.path, r.query_string),
			detail: `HTTP ${r.status_code}`,
			ok: false,
		});
	}

	return take(out, f.limit);
}

// ---- One person's timeline ------------------------------------------------------------------

/** Everything one person did: dashboard requests and commands, newest first. */
export async function userTimeline(
	db: Db,
	userId: string,
	raw?: Omit<LogFilter, 'userId'>,
	now = new Date()
): Promise<LogRow[]> {
	if (!db) return [];
	const f = cleanFilter({ ...raw, userId });
	if (!f.userId) return [];
	const w = window(f, now, 'a.created_at');
	const clauses = [...w.clauses, 'a.user_id = ?'];
	const binds = [...w.binds, f.userId];
	if (f.guildId) {
		clauses.push('a.path LIKE ?');
		binds.push(`%/${f.guildId}%`);
	}
	const requests = await rows<any>(
		db,
		`SELECT a.id, a.created_at, a.activity_type, a.method, a.path, a.query_string, a.status_code
		 FROM user_activity_logs a WHERE ${clauses.join(' AND ')} ORDER BY a.created_at DESC, a.id DESC LIMIT ?`,
		[...binds, f.limit]
	);
	const commands = await activityFeed(db, { ...raw, userId: f.userId, limit: f.limit }, now);
	return take(
		[
			...requests.map((r): LogRow => ({
				key: `a${r.id}`,
				at: r.created_at,
				kind: r.method === 'GET' ? 'view' : scopeOfPath(r.path),
				guild_id: guildOfPath(r.path),
				user_id: f.userId!,
				user_name: null,
				title: describeRequest(r.method, r.path, r.query_string),
				detail: r.status_code ? `HTTP ${r.status_code}` : null,
				ok: r.status_code ? r.status_code < 400 : null,
			})),
			...commands.filter((c) => c.kind === 'command'),
		],
		f.limit
	);
}
