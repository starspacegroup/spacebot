/**
 * Retention for the append-only tables that had none.
 *
 * `event_logs`, `voice_sessions`, hourly `aggregated_stats` and `server_stats`
 * were already pruned (event-log-retention.ts, stats-aggregation.ts). Every
 * other log-shaped table grew forever, and they are most of the 1.2 GB in
 * `spacebot-logs` (docs/SCALE_ARCHITECTURE.md). This module prunes them.
 *
 * Shape, and why:
 *
 * - **Each table has its own budget.** The older jobs share one small nightly
 *   budget, so a busy table starved the rest. Here a table that is behind only
 *   slows itself down.
 *
 * - **Windows walk the primary key, not the timestamp.** Most of these tables
 *   have no index on `created_at` (button_click_logs, workflow runs, the cron
 *   claims). A `WHERE created_at < ?` delete would scan the whole table on the
 *   night there is nothing to delete. Instead each step reads the next
 *   `batchSize` rows by rowid (ids are AUTOINCREMENT, so id order is insert
 *   order) and deletes the expired ones inside that window. Rows read per step
 *   are bounded by the window, and the walk stops at the first window whose
 *   newest row is inside the retention period.
 *
 * - **Finished only, where a row can still be live.** ai_jobs and workflow runs
 *   keep anything that is not in a terminal state, however old. A stuck row at
 *   the front does not block the walk: the cursor moves past it.
 *
 * - **Children first.** ai_job_events has a foreign key to ai_jobs with no
 *   cascade, so a job's events go before the job. A job whose events did not
 *   all go (budget) stays until the next run.
 *
 * - **The backlog is visible.** Each table logs the age of its oldest remaining
 *   row. If that number grows night over night, the budget is too small.
 *
 * SECURITY: table/column names below are internal constants, never user input.
 */

import { getEnv } from '../env.js';
import { log } from '../log.js';

export interface RetentionChild {
	table: string;
	/** Column in the child that points at the parent's id. */
	fk: string;
}

export interface RetentionTable {
	/** Short name, used for env keys: LOG_RETENTION_<KEY>_DAYS / _MAX_ROWS. */
	key: string;
	table: string;
	/** Rowid-like column, monotonic with insert time. */
	idColumn: string;
	/** Timestamp column in 'YYYY-MM-DD HH:MM:SS' form. */
	timeColumn: string;
	defaultDays: number;
	defaultMaxRows: number;
	/** Extra predicate a row must also meet to be deleted (internal constant). */
	extraWhere?: string;
	children?: RetentionChild[];
}

export const AI_JOB_TERMINAL = `status IN ('completed', 'failed_terminal', 'canceled')`;
export const WORKFLOW_RUN_TERMINAL = `status IN ('completed', 'failed', 'cancelled', 'canceled')`;
export const CRON_HISTORY_TERMINAL = `status <> 'running'`;

/**
 * Defaults.
 *
 * 90 days for logs matches event_logs and voice_sessions, so every "recent
 * activity" view has the same horizon. Readers checked 2026-11-05:
 * - log viewers (command/automation/button/user activity) page newest-first;
 * - automation sparklines read 14 days, member activity reads <= 90 days;
 * - profile `command_count` and automation success totals count all rows, so
 *   they become 90-day counts. voice_seconds on the same profile is already a
 *   90-day number (voice_sessions retention), so the profile stays consistent.
 *   `commands.use_count` is the all-time counter and is untouched.
 *
 * Budgets: the DB is past the free-tier 500 MB size, so it is on Workers Paid
 * (50M row-writes/month included). 10k rows x ~5 indexes is ~50k writes per
 * table per night, well inside that.
 */
export const LOG_RETENTION_TABLES: RetentionTable[] = [
	{
		key: 'COMMAND_LOGS',
		table: 'command_logs',
		idColumn: 'id',
		timeColumn: 'created_at',
		defaultDays: 90,
		defaultMaxRows: 10000,
	},
	{
		key: 'AUTOMATION_LOGS',
		table: 'automation_logs',
		idColumn: 'id',
		timeColumn: 'created_at',
		defaultDays: 90,
		defaultMaxRows: 10000,
	},
	{
		key: 'BUTTON_CLICK_LOGS',
		table: 'button_click_logs',
		idColumn: 'id',
		timeColumn: 'created_at',
		defaultDays: 90,
		defaultMaxRows: 10000,
	},
	{
		// Holds IP addresses and user agents: 90 days is also the privacy line.
		key: 'USER_ACTIVITY_LOGS',
		table: 'user_activity_logs',
		idColumn: 'id',
		timeColumn: 'created_at',
		defaultDays: 90,
		defaultMaxRows: 10000,
	},
	{
		key: 'AI_JOBS',
		table: 'ai_jobs',
		idColumn: 'id',
		timeColumn: 'created_at',
		defaultDays: 30,
		defaultMaxRows: 5000,
		extraWhere: AI_JOB_TERMINAL,
		children: [{ table: 'ai_job_events', fk: 'job_id' }],
	},
	{
		key: 'CRON_JOB_HISTORY',
		table: 'cron_job_history',
		idColumn: 'id',
		timeColumn: 'started_at',
		defaultDays: 90,
		defaultMaxRows: 5000,
		extraWhere: CRON_HISTORY_TERMINAL,
	},
	{
		key: 'WORKFLOW_RUNS',
		table: 'superadmin_workflow_runs',
		idColumn: 'id',
		timeColumn: 'created_at',
		defaultDays: 90,
		defaultMaxRows: 5000,
		extraWhere: WORKFLOW_RUN_TERMINAL,
		children: [{ table: 'superadmin_workflow_run_steps', fk: 'run_id' }],
	},
	{
		// One row per template per minute. Only the current minute matters to
		// the INSERT OR IGNORE claim; a day is generous.
		key: 'WORKFLOW_CRON_CLAIMS',
		table: 'superadmin_workflow_cron_claims',
		idColumn: 'rowid',
		timeColumn: 'claimed_at',
		defaultDays: 1,
		defaultMaxRows: 20000,
	},
];

export interface TableRetentionResult {
	table: string;
	deleted: number;
	childrenDeleted: number;
	budgetExhausted: boolean;
	/** Age in days of the oldest row left, or null for an empty table. */
	oldestRemainingDays: number | null;
	error?: string;
}

function readNumber(name: string, platform: any): number {
	const raw = getEnv(name, platform);
	if (raw === undefined || raw === null || String(raw).trim() === '') return Number.NaN;
	return Number(raw);
}

/** Env overrides. 0 for MAX_ROWS is the kill switch and must survive the parse. */
export function resolveTableRetention(
	spec: RetentionTable,
	platform: any = null
): { days: number; maxRows: number } {
	const days = readNumber(`LOG_RETENTION_${spec.key}_DAYS`, platform);
	const rows = readNumber(`LOG_RETENTION_${spec.key}_MAX_ROWS`, platform);
	return {
		days: Number.isFinite(days) && days > 0 ? Math.floor(days) : spec.defaultDays,
		maxRows: Number.isFinite(rows) && rows >= 0 ? Math.floor(rows) : spec.defaultMaxRows,
	};
}

async function oldestAgeDays(db: any, spec: RetentionTable): Promise<number | null> {
	const row = await db
		.prepare(
			`SELECT (julianday('now') - julianday(${spec.timeColumn})) AS age
			 FROM ${spec.table} ORDER BY ${spec.idColumn} LIMIT 1`
		)
		.first();
	if (!row || row.age === null || row.age === undefined) return null;
	return Math.round(Number(row.age) * 10) / 10;
}

/** Prune one table. Never throws; an error is reported in the result. */
export async function pruneTable(
	db: any,
	spec: RetentionTable,
	{ days, maxRows, batchSize = 1000 }: { days: number; maxRows: number; batchSize?: number }
): Promise<TableRetentionResult> {
	const result: TableRetentionResult = {
		table: spec.table,
		deleted: 0,
		childrenDeleted: 0,
		budgetExhausted: false,
		oldestRemainingDays: null,
	};
	if (!db) return result;

	const size = Math.max(1, Math.min(10000, Math.floor(batchSize)));
	const id = spec.idColumn;
	const ts = spec.timeColumn;
	const expired =
		`${ts} < datetime('now', ?)` + (spec.extraWhere ? ` AND ${spec.extraWhere}` : '');
	const offset = `-${days} days`;

	try {
		if (maxRows > 0) {
			// Bound on windows read, so a table full of live (non-terminal) rows
			// cannot make the walk long.
			const maxWindows = Math.ceil(maxRows / size) * 4 + 4;
			let cursor = -1;
			for (let w = 0; w < maxWindows; w++) {
				const remaining = maxRows - result.deleted - result.childrenDeleted;
				if (remaining <= 0) {
					result.budgetExhausted = true;
					break;
				}
				const win = Math.min(size, remaining);

				const bounds = await db
					.prepare(
						`SELECT MAX(${id}) AS hi, COUNT(*) AS n,
						        MAX(CASE WHEN ${ts} >= datetime('now', ?) THEN 1 ELSE 0 END) AS reached
						 FROM (SELECT ${id}, ${ts} FROM ${spec.table}
						       WHERE ${id} > ? ORDER BY ${id} LIMIT ?)`
					)
					.bind(offset, cursor, win)
					.first();
				const n = Number(bounds?.n || 0);
				if (n === 0 || bounds?.hi === null || bounds?.hi === undefined) break;
				const hi = Number(bounds.hi);

				let childrenOk = true;
				for (const child of spec.children || []) {
					const left = maxRows - result.deleted - result.childrenDeleted;
					if (left <= 0) {
						childrenOk = false;
						break;
					}
					const del = await db
						.prepare(
							`DELETE FROM ${child.table} WHERE rowid IN (
								 SELECT c.rowid FROM ${child.table} c
								 WHERE c.${child.fk} IN (
									 SELECT ${id} FROM ${spec.table}
									 WHERE ${id} > ? AND ${id} <= ? AND ${expired}
								 )
								 LIMIT ?
							 )`
						)
						.bind(cursor, hi, offset, left)
						.run();
					const removed = Number(del?.meta?.changes || 0);
					result.childrenDeleted += removed;
					if (removed >= left) childrenOk = false; // may be more; parent waits
				}

				if (childrenOk) {
					const childGuard = (spec.children || [])
						.map(
							(c) =>
								` AND NOT EXISTS (SELECT 1 FROM ${c.table} c WHERE c.${c.fk} = ${spec.table}.${id})`
						)
						.join('');
					const del = await db
						.prepare(
							`DELETE FROM ${spec.table}
							 WHERE ${id} > ? AND ${id} <= ? AND ${expired}${childGuard}`
						)
						.bind(cursor, hi, offset)
						.run();
					result.deleted += Number(del?.meta?.changes || 0);
				} else {
					result.budgetExhausted = true;
					break;
				}

				cursor = hi;
				// This window reached rows inside the retention period: everything
				// after it is newer still (id order is insert order).
				if (Number(bounds.reached) === 1 || n < win) break;
			}
		}

		result.oldestRemainingDays = await oldestAgeDays(db, spec);
		const total = result.deleted + result.childrenDeleted;
		if (total > 0 || (result.oldestRemainingDays ?? 0) > days + 1) {
			const msg =
				`[Retention] ${spec.table}: deleted ${result.deleted}` +
				(spec.children?.length ? ` (+${result.childrenDeleted} child rows)` : '') +
				`, oldest remaining ${result.oldestRemainingDays ?? '-'}d (keep ${days}d)` +
				(result.budgetExhausted ? ', budget exhausted, will continue next run' : '');
			// Behind by more than a week past the window: the budget is too small,
			// or a live row is old. Say so loudly.
			if ((result.oldestRemainingDays ?? 0) > days + 7 && !spec.extraWhere) log.warn(msg);
			else log.info(msg);
		}
	} catch (error: any) {
		result.error = String(error?.message || error);
		log.error(`[Retention] ${spec.table} prune failed:`, result.error);
	}

	return result;
}

/**
 * Prune every table in LOG_RETENTION_TABLES, each on its own budget. One
 * table's failure (missing in an old local DB, say) does not stop the others.
 */
export async function pruneAppendOnlyLogs(
	db: any,
	platform: any = null,
	tables: RetentionTable[] = LOG_RETENTION_TABLES
): Promise<TableRetentionResult[]> {
	if (!db) return [];
	const out: TableRetentionResult[] = [];
	for (const spec of tables) {
		out.push(await pruneTable(db, spec, resolveTableRetention(spec, platform)));
	}
	return out;
}
