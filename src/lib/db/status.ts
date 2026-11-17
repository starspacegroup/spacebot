/**
 * The public status page, on D1: record one round of checks, open and close the incidents the
 * checks find, take incidents from a person, and read it all back for the page and the API.
 * The rules (what counts as down, how many checks confirm a change) are in
 * `$lib/status/logic.ts`.
 */

import {
	COMPONENTS,
	COMPONENT_IDS,
	IMPACTS,
	INCIDENT_STATUSES,
	OPENING_NOTE,
	RESOLVED_NOTE,
	advance,
	autoImpact,
	autoIncidentTitle,
	cleanText,
	dayLevel,
	dayOf,
	lastDays,
	overall,
	overallHeadline,
	parseComponents,
	readBot,
	readDatabase,
	readWebsite,
	uptimePercent,
	type ComponentState,
	type DayCounts,
	type Impact,
	type IncidentStatus,
	type Reading,
	type Status,
	type WebsiteProbe,
} from '../status/logic.js';

type Db = any;

const sqlTime = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

export const HISTORY_DAYS = 90;
/** The page says checks are late when the newest one is older than this. */
export const STALE_CHECK_SECONDS = 300;
const KEEP_DAILY_DAYS = 400;
const RECENT_INCIDENT_DAYS = 30;

// --- recording --------------------------------------------------------------------------

async function probeDatabase(db: Db): Promise<{ ok: boolean; ms: number | null }> {
	const t0 = Date.now();
	try {
		await db.prepare('SELECT 1 AS ok').first();
		return { ok: true, ms: Date.now() - t0 };
	} catch {
		return { ok: false, ms: null };
	}
}

async function latestHeartbeat(db: Db) {
	try {
		const row: any = await db
			.prepare(
				`SELECT recorded_at, status, heartbeat_latency_ms
				   FROM gateway_benchmarks ORDER BY id DESC LIMIT 1`
			)
			.first();
		return row
			? {
					recordedAt: row.recorded_at as string,
					status: row.status as string,
					latencyMs: (row.heartbeat_latency_ms ?? null) as number | null,
				}
			: null;
	} catch {
		return null;
	}
}

async function openAutoIncident(db: Db, component: string) {
	return (await db
		.prepare(
			`SELECT id, impact, title FROM status_incidents
			  WHERE auto = 1 AND resolved_at IS NULL AND components LIKE ?
			  ORDER BY id DESC LIMIT 1`
		)
		.bind(`%"${component}"%`)
		.first()) as { id: number; impact: string; title: string } | null;
}

async function addUpdate(
	db: Db,
	incidentId: number,
	status: IncidentStatus,
	body: string,
	at: string,
	by: string | null
) {
	await db
		.prepare(
			`INSERT INTO status_incident_updates (incident_id, status, body, created_at, created_by)
			 VALUES (?, ?, ?, ?, ?)`
		)
		.bind(incidentId, status, body, at, by)
		.run();
}

/** The checks changed a component's confirmed status: open, change or close its incident. */
async function followIncident(
	db: Db,
	component: string,
	from: Status,
	to: Status,
	since: string,
	detail: string,
	now: string
) {
	const open = await openAutoIncident(db, component);
	if (to === 'operational') {
		if (!open) return;
		await db
			.prepare(
				`UPDATE status_incidents SET status = 'resolved', resolved_at = ? WHERE id = ?`
			)
			.bind(now, open.id)
			.run();
		await addUpdate(db, open.id, 'resolved', RESOLVED_NOTE, now, null);
		return;
	}
	const title = autoIncidentTitle(component, to);
	const impact = autoImpact(to);
	if (!open) {
		const res: any = await db
			.prepare(
				`INSERT INTO status_incidents (title, impact, status, components, auto, started_at)
				 VALUES (?, ?, 'investigating', ?, 1, ?)`
			)
			.bind(title, impact, JSON.stringify([component]), since)
			.run();
		const id = Number(res?.meta?.last_row_id);
		if (id)
			await addUpdate(db, id, 'investigating', `${OPENING_NOTE} ${detail}`.trim(), now, null);
		return;
	}
	if (from !== to) {
		await db
			.prepare(`UPDATE status_incidents SET title = ?, impact = ? WHERE id = ?`)
			.bind(title, impact, open.id)
			.run();
		await addUpdate(
			db,
			open.id,
			'investigating',
			to === 'down' ? `It got worse. ${detail}`.trim() : `Partly recovered. ${detail}`.trim(),
			now,
			null
		);
	}
}

async function loadState(db: Db, id: string, now: string): Promise<ComponentState> {
	const row: any = await db
		.prepare(
			`SELECT status, since, pending_status, pending_count, pending_since
			   FROM status_components WHERE id = ?`
		)
		.bind(id)
		.first();
	if (!row) {
		return {
			status: 'operational',
			since: now,
			pendingStatus: null,
			pendingCount: 0,
			pendingSince: null,
		};
	}
	return {
		status: row.status,
		since: row.since,
		pendingStatus: row.pending_status ?? null,
		pendingCount: Number(row.pending_count) || 0,
		pendingSince: row.pending_since ?? null,
	};
}

export interface RecordResult {
	checkedAt: string;
	components: Record<string, { status: Status; raw: Status; changed: boolean }>;
}

/**
 * One round of checks, once a minute. `website` is what an outside probe saw (the
 * orchestrator worker); when it is missing the website counts as up, because it just answered.
 */
export async function recordStatus(
	db: Db,
	input: { website?: WebsiteProbe | null } = {},
	now: Date = new Date()
): Promise<RecordResult> {
	const at = sqlTime(now);
	const [dbProbe, heartbeat] = await Promise.all([probeDatabase(db), latestHeartbeat(db)]);
	const bot = readBot(heartbeat, now);
	const readings: Record<string, Reading> = {
		website: readWebsite(input.website),
		database: readDatabase(dbProbe),
		bot_host: bot.host,
		discord: bot.discord,
	};

	const result: RecordResult['components'] = {};
	for (const id of COMPONENT_IDS) {
		const reading = readings[id];
		const before = await loadState(db, id, at);
		const step = advance(before, reading.status, at);
		const s = step.state;
		await db
			.prepare(
				`INSERT INTO status_components
				   (id, status, since, last_checked, latency_ms, detail, pending_status, pending_count, pending_since)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT(id) DO UPDATE SET
				   status = excluded.status, since = excluded.since, last_checked = excluded.last_checked,
				   latency_ms = excluded.latency_ms, detail = excluded.detail,
				   pending_status = excluded.pending_status, pending_count = excluded.pending_count,
				   pending_since = excluded.pending_since`
			)
			.bind(
				id,
				s.status,
				s.since,
				at,
				reading.latencyMs,
				reading.detail,
				s.pendingStatus,
				s.pendingCount,
				s.pendingSince
			)
			.run();
		// The column name comes from the fixed status set, never from input.
		const column = s.status === 'operational' ? 'operational' : s.status;
		await db
			.prepare(
				`INSERT INTO status_daily (component, day, checks, ${column})
				 VALUES (?, ?, 1, 1)
				 ON CONFLICT(component, day) DO UPDATE SET
				   checks = checks + 1, ${column} = ${column} + 1`
			)
			.bind(id, dayOf(at))
			.run();
		if (step.changed) {
			await followIncident(db, id, step.from, s.status, s.since, reading.detail, at);
		}
		result[id] = { status: s.status, raw: reading.status, changed: step.changed };
	}

	// Once a day, drop history older than the page can show.
	if (now.getUTCHours() === 3 && now.getUTCMinutes() === 0) {
		const cutoff = sqlTime(new Date(now.getTime() - KEEP_DAILY_DAYS * 86_400_000)).slice(0, 10);
		await db.prepare(`DELETE FROM status_daily WHERE day < ?`).bind(cutoff).run();
	}
	return { checkedAt: at, components: result };
}

// --- incidents from a person ------------------------------------------------------------

const asImpact = (v: unknown): Impact =>
	(IMPACTS as string[]).includes(String(v)) ? (v as Impact) : 'minor';
const asIncidentStatus = (v: unknown): IncidentStatus =>
	(INCIDENT_STATUSES as string[]).includes(String(v)) ? (v as IncidentStatus) : 'investigating';

export interface NewIncident {
	title: string;
	impact?: string;
	status?: string;
	components?: string[];
	message?: string;
	by?: string | null;
}

export async function createIncident(db: Db, input: NewIncident, now: Date = new Date()) {
	const title = cleanText(input.title, 120);
	if (!title) return { ok: false as const, error: 'Give the incident a title.' };
	const status = asIncidentStatus(input.status);
	const components = (input.components ?? []).filter((c) => COMPONENT_IDS.includes(c));
	const at = sqlTime(now);
	const res: any = await db
		.prepare(
			`INSERT INTO status_incidents (title, impact, status, components, auto, started_at, resolved_at, created_by)
			 VALUES (?, ?, ?, ?, 0, ?, ?, ?)`
		)
		.bind(
			title,
			asImpact(input.impact),
			status,
			JSON.stringify(components),
			at,
			status === 'resolved' ? at : null,
			input.by ?? null
		)
		.run();
	const id = Number(res?.meta?.last_row_id);
	const message = cleanText(input.message, 2000) || 'We are looking into this.';
	await addUpdate(db, id, status, message, at, input.by ?? null);
	return { ok: true as const, id };
}

export async function addIncidentUpdate(
	db: Db,
	input: { incidentId: number; status: string; message: string; by?: string | null },
	now: Date = new Date()
) {
	const message = cleanText(input.message, 2000);
	if (!message) return { ok: false as const, error: 'Write what changed.' };
	const incident: any = await db
		.prepare(`SELECT id FROM status_incidents WHERE id = ?`)
		.bind(input.incidentId)
		.first();
	if (!incident) return { ok: false as const, error: 'That incident does not exist.' };
	const status = asIncidentStatus(input.status);
	const at = sqlTime(now);
	await db
		.prepare(`UPDATE status_incidents SET status = ?, resolved_at = ? WHERE id = ?`)
		.bind(status, status === 'resolved' ? at : null, input.incidentId)
		.run();
	await addUpdate(db, input.incidentId, status, message, at, input.by ?? null);
	return { ok: true as const };
}

// --- reading it back --------------------------------------------------------------------

export interface IncidentUpdate {
	id: number;
	status: IncidentStatus;
	body: string;
	createdAt: string;
	byPerson: boolean;
}

export interface Incident {
	id: number;
	title: string;
	impact: Impact;
	status: IncidentStatus;
	components: string[];
	auto: boolean;
	startedAt: string;
	resolvedAt: string | null;
	updates: IncidentUpdate[];
}

async function loadIncidents(db: Db, where: string, bind: unknown[], limit: number) {
	const rows: any[] =
		(
			await db
				.prepare(
					`SELECT id, title, impact, status, components, auto, started_at, resolved_at
					   FROM status_incidents WHERE ${where} ORDER BY started_at DESC, id DESC LIMIT ?`
				)
				.bind(...bind, limit)
				.all()
		)?.results ?? [];
	if (!rows.length) return [] as Incident[];
	const ids = rows.map((r) => r.id);
	const updates: any[] =
		(
			await db
				.prepare(
					`SELECT id, incident_id, status, body, created_at, created_by
					   FROM status_incident_updates
					  WHERE incident_id IN (${ids.map(() => '?').join(',')})
					  ORDER BY id DESC`
				)
				.bind(...ids)
				.all()
		)?.results ?? [];
	return rows.map((r): Incident => ({
		id: r.id,
		title: r.title,
		impact: r.impact,
		status: r.status,
		components: parseComponents(r.components),
		auto: Boolean(r.auto),
		startedAt: r.started_at,
		resolvedAt: r.resolved_at ?? null,
		updates: updates
			.filter((u) => u.incident_id === r.id)
			.map((u) => ({
				id: u.id,
				status: u.status,
				body: u.body,
				createdAt: u.created_at,
				byPerson: Boolean(u.created_by),
			})),
	}));
}

export interface ComponentView {
	id: string;
	name: string;
	description: string;
	status: Status;
	since: string | null;
	detail: string | null;
	latencyMs: number | null;
	uptimePercent: number | null;
	days: { day: string; level: ReturnType<typeof dayLevel> }[];
}

export interface StatusSnapshot {
	generatedAt: string;
	overall: Status;
	headline: string;
	/** True when no check has run lately: the page must not claim everything is fine. */
	stale: boolean;
	lastChecked: string | null;
	components: ComponentView[];
	openIncidents: Incident[];
	recentIncidents: Incident[];
}

export async function getStatusSnapshot(db: Db, now: Date = new Date()): Promise<StatusSnapshot> {
	const at = sqlTime(now);
	const today = dayOf(at);
	const days = lastDays(today, HISTORY_DAYS);

	const [compRows, dayRows, open, recent] = await Promise.all([
		db
			.prepare(
				`SELECT id, status, since, last_checked, latency_ms, detail FROM status_components`
			)
			.all(),
		db
			.prepare(
				`SELECT component, day, checks, operational, degraded, down
				   FROM status_daily WHERE day >= ?`
			)
			.bind(days[0])
			.all(),
		loadIncidents(db, `resolved_at IS NULL`, [], 20),
		loadIncidents(
			db,
			`resolved_at IS NOT NULL AND resolved_at >= ?`,
			[sqlTime(new Date(now.getTime() - RECENT_INCIDENT_DAYS * 86_400_000))],
			30
		),
	]);

	const stateById = new Map<string, any>(
		((compRows as any)?.results ?? []).map((r: any) => [r.id, r])
	);
	const byComponent = new Map<string, Map<string, DayCounts>>();
	for (const r of (dayRows as any)?.results ?? []) {
		if (!byComponent.has(r.component)) byComponent.set(r.component, new Map());
		byComponent.get(r.component)!.set(r.day, {
			day: r.day,
			checks: r.checks,
			operational: r.operational,
			degraded: r.degraded,
			down: r.down,
		});
	}

	const components: ComponentView[] = COMPONENTS.map((c) => {
		const state = stateById.get(c.id);
		const counts = byComponent.get(c.id) ?? new Map<string, DayCounts>();
		return {
			id: c.id,
			name: c.name,
			description: c.description,
			status: (state?.status as Status) ?? 'operational',
			since: state?.since ?? null,
			detail: state?.detail ?? null,
			latencyMs: state?.latency_ms ?? null,
			uptimePercent: uptimePercent([...counts.values()]),
			days: days.map((day) => ({ day, level: dayLevel(counts.get(day)) })),
		};
	});

	const checkedTimes = components
		.map((c) => stateById.get(c.id)?.last_checked as string | undefined)
		.filter(Boolean) as string[];
	const lastChecked = checkedTimes.length === COMPONENTS.length ? checkedTimes.sort()[0] : null;
	const stale =
		!lastChecked ||
		now.getTime() - Date.parse(lastChecked.replace(' ', 'T') + 'Z') >
			STALE_CHECK_SECONDS * 1000;

	const worst = overall(components.map((c) => c.status));
	return {
		generatedAt: at,
		overall: worst,
		headline: stale ? 'Status checks are delayed' : overallHeadline(worst, open.length > 0),
		stale,
		lastChecked,
		components,
		openIncidents: open,
		recentIncidents: recent,
	};
}
