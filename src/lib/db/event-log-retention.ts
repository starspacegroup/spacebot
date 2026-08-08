/**
 * Retention for the raw `event_logs` firehose.
 *
 * The long-term record is already handled: events roll up into hourly
 * `aggregated_stats`, hourly rolls up into **daily**, hourly is pruned at 30
 * days, and nothing ever deletes daily. A daily row is ~18 small columns, so one
 * guild costs ~365 rows/year — charts and trends can keep working essentially
 * forever for nothing.
 *
 * What was missing is pruning the raw rows underneath. `pruneOldLogs()` existed
 * but had no caller, so `event_logs` grew without bound and every scan over it
 * (see the 2026-08-03 logs-page incident) got slower forever.
 *
 * Two rules make this safe and cheap:
 *
 * 1. **Never delete ahead of the permanent record.** A guild's cutoff is capped
 *    at its newest *daily* `period_end`. Daily is the artifact that survives, so
 *    anything older than it has been preserved in aggregate. A guild with no
 *    daily aggregate at all is skipped entirely rather than trusted to a clock.
 *
 * 2. **The prune must not become the next blowout.** The 2026-07-27 incident was
 *    partly a retention query that scanned the table twice per flush. So this
 *    deletes in bounded batches keyed on `(guild_id, created_at)`
 *    (idx_event_logs_guild_created), with a hard per-run row budget — a large
 *    backlog drains over several nightly runs instead of blowing a day's quota
 *    in one pass.
 */

import { DISTINCT_GUILD_IDS_SQL } from './distinct-guilds.js';
import { getEnv } from '../env.js';
import { log } from '../log.js';

/** How long raw events stay queryable in the log viewer. Aggregates are unaffected. */
export const DEFAULT_EVENT_LOG_RETENTION_DAYS = 90;

/** Rows per DELETE. Small enough that one statement is never a large scan. */
export const DEFAULT_BATCH_SIZE = 2000;

/**
 * Ceiling on rows removed per run.
 *
 * Sized against D1's **write** cap, not its read cap — that is the binding
 * constraint here. The free tier allows ~100k rows written/day, and `event_logs`
 * carries **seven** indexes, so each deleted row costs roughly 8 row-writes once
 * index maintenance is counted.
 *
 * Crucially this is one of FOUR retention deletes in the same nightly job
 * (event_logs, voice_sessions, hourly aggregated_stats, server_stats). Sized in
 * isolation they summed to ~88k row-writes — ~88% of the daily allowance,
 * leaving almost nothing for live logging. They now share one budget totalling
 * ~44k, of which this is the largest slice: 2,500 x ~8 = 20k.
 *
 * The trade-off is deliberate: a large backlog drains over weeks rather than in
 * one pass. That is the correct direction — a retention job that trips the write
 * cap would take live event logging down with it. Raise it with
 * `EVENT_LOG_RETENTION_MAX_ROWS_PER_RUN` on Workers Paid, where the cap is far
 * higher.
 */
export const DEFAULT_MAX_ROWS_PER_RUN = 2500;

export interface PruneResult {
	deleted: number;
	guildsProcessed: number;
	guildsSkipped: number;
	budgetExhausted: boolean;
}

/**
 * Resolve this job's env overrides, for every caller that schedules it.
 *
 * Deliberately **not** `getEnvNumber`: that helper treats any non-positive value
 * as "unset", which would silently turn `EVENT_LOG_RETENTION_MAX_ROWS_PER_RUN=0`
 * — the kill switch `pruneAggregatedEventLogs` explicitly implements, and the
 * one thing an operator reaches for mid-incident — back into the default budget.
 * Zero has to survive the parse. An unset or empty value still means "default",
 * since `Number('')` is 0 and would otherwise disable retention by accident.
 *
 * Shared rather than repeated per call site so the default can never again drift
 * between the paths that run this (see the hardcoded 5000 that outlived the drop
 * to 2,500).
 */
export function resolveEventLogRetentionEnv(platform: any = null): {
	retentionDays: number;
	maxRowsPerRun: number;
} {
	const read = (name: string) => {
		const raw = getEnv(name, platform);
		if (raw === undefined || raw === null || String(raw).trim() === '') return Number.NaN;
		return Number(raw);
	};

	const days = read('EVENT_LOG_RETENTION_DAYS');
	const rows = read('EVENT_LOG_RETENTION_MAX_ROWS_PER_RUN');

	return {
		retentionDays:
			Number.isFinite(days) && days > 0 ? Math.floor(days) : DEFAULT_EVENT_LOG_RETENTION_DAYS,
		maxRowsPerRun:
			Number.isFinite(rows) && rows >= 0 ? Math.floor(rows) : DEFAULT_MAX_ROWS_PER_RUN,
	};
}

/**
 * The newest point we can safely delete up to for one guild: whichever is
 * earlier of the retention cutoff and the guild's daily-aggregate watermark.
 * Returns null when the guild has no daily aggregate — nothing is safe to drop.
 */
export async function resolveGuildCutoff(
	db: any,
	guildId: string,
	retentionCutoff: string
): Promise<string | null> {
	const row = await db
		.prepare(
			`SELECT MAX(period_end) AS watermark
			 FROM aggregated_stats
			 WHERE guild_id = ? AND period_type = 'daily'`
		)
		.bind(guildId)
		.first();

	const watermark = row?.watermark;
	if (!watermark) return null;

	// String compare is valid here: both sides are 'YYYY-MM-DD HH:MM:SS'.
	return watermark < retentionCutoff ? watermark : retentionCutoff;
}

/**
 * Delete raw events that are both past the retention window and already rolled
 * up into a daily aggregate.
 */
export async function pruneAggregatedEventLogs(
	db: any,
	{
		retentionDays = DEFAULT_EVENT_LOG_RETENTION_DAYS,
		batchSize = DEFAULT_BATCH_SIZE,
		maxRowsPerRun = DEFAULT_MAX_ROWS_PER_RUN,
	}: { retentionDays?: number; batchSize?: number; maxRowsPerRun?: number } = {}
): Promise<PruneResult> {
	const result: PruneResult = {
		deleted: 0,
		guildsProcessed: 0,
		guildsSkipped: 0,
		budgetExhausted: false,
	};
	if (!db) return result;

	const days = Math.max(1, Math.floor(Number(retentionDays) || DEFAULT_EVENT_LOG_RETENTION_DAYS));
	const size = Math.max(1, Math.min(10000, Math.floor(Number(batchSize) || DEFAULT_BATCH_SIZE)));
	// `??` would be dead here — Number() yields NaN, never nullish — and a NaN
	// budget would reach the query as `LIMIT NaN`. 0 must stay meaningful (an
	// explicit "do nothing this run"), so this can't collapse to `|| default`.
	const parsedBudget = Number(maxRowsPerRun);
	const budget = Number.isFinite(parsedBudget)
		? Math.max(0, Math.floor(parsedBudget))
		: DEFAULT_MAX_ROWS_PER_RUN;
	if (budget === 0) return result;

	try {
		const cutoffRow = await db
			.prepare(`SELECT datetime('now', ?) AS cutoff`)
			.bind(`-${days} days`)
			.first();
		const retentionCutoff = cutoffRow?.cutoff;
		if (!retentionCutoff) return result;

		// O(guilds), not O(events) — see distinct-guilds.ts.
		const guildRows = (await db.prepare(DISTINCT_GUILD_IDS_SQL).all()).results || [];

		// Guilds arrive in ascending guild_id order, and that order is stable from
		// night to night. Spending the whole budget on whoever comes first would
		// mean the lowest-id guild with a real backlog is the ONLY guild ever
		// pruned — every other guild's event_logs would keep growing forever,
		// which is the exact failure this job exists to stop. So the run is two
		// sweeps: everyone gets a fair share first, then whatever is left over is
		// offered to the guilds that could still use it.
		const cutoffs = new Map<string, string>();
		const drained = new Set<string>();

		const sweep = async (perGuildCap: number) => {
			for (const { guild_id: guildId } of guildRows) {
				if (result.deleted >= budget) {
					result.budgetExhausted = true;
					return;
				}
				if (drained.has(guildId)) continue;

				let cutoff = cutoffs.get(guildId);
				if (cutoff === undefined) {
					const resolved = await resolveGuildCutoff(db, guildId, retentionCutoff);
					if (!resolved) {
						// No daily aggregate yet: its history is not preserved anywhere else.
						result.guildsSkipped++;
						drained.add(guildId);
						continue;
					}
					cutoff = resolved;
					cutoffs.set(guildId, cutoff);
					result.guildsProcessed++;
				}

				// Batched so no single statement is a large scan, and so the run stops
				// cleanly on the budget rather than mid-table.
				let deletedHere = 0;
				for (;;) {
					const remaining = Math.min(budget - result.deleted, perGuildCap - deletedHere);
					if (remaining <= 0) {
						if (result.deleted >= budget) result.budgetExhausted = true;
						break;
					}

					const deleteResult = await db
						.prepare(
							`DELETE FROM event_logs
							 WHERE id IN (
								 SELECT id FROM event_logs
								 WHERE guild_id = ? AND created_at < ?
								 ORDER BY id
								 LIMIT ?
							 )`
						)
						.bind(guildId, cutoff, Math.min(size, remaining))
						.run();

					const removed = Number(deleteResult?.meta?.changes || 0);
					result.deleted += removed;
					deletedHere += removed;
					if (removed === 0) {
						// Nothing left past this guild's cutoff — don't revisit it.
						drained.add(guildId);
						break;
					}
				}
			}
		};

		await sweep(Math.max(1, Math.ceil(budget / Math.max(1, guildRows.length))));
		// Leftovers: with one guild, or when most guilds are already clean, this
		// keeps throughput identical to an unshared budget.
		if (result.deleted < budget) await sweep(budget);

		if (result.deleted > 0 || result.guildsSkipped > 0) {
			log.info(
				`[Retention] event_logs pruned: ${result.deleted} rows across ` +
					`${result.guildsProcessed} guild(s), ${result.guildsSkipped} skipped ` +
					`(no daily aggregate)${result.budgetExhausted ? ', budget exhausted' : ''}`
			);
		}
	} catch (error: any) {
		log.error('[Retention] Failed to prune event_logs:', error?.message || error);
	}

	return result;
}
