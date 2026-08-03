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
 * index maintenance is counted. 5,000 deletions is therefore ~40k writes,
 * comfortably under half the daily allowance with room left for normal logging.
 *
 * The trade-off is deliberate: a large backlog drains over weeks rather than in
 * one pass. That is the correct direction — a retention job that trips the write
 * cap would take live event logging down with it. Raise it with
 * `EVENT_LOG_RETENTION_MAX_ROWS_PER_RUN` on Workers Paid, where the cap is far
 * higher.
 */
export const DEFAULT_MAX_ROWS_PER_RUN = 5000;

export interface PruneResult {
	deleted: number;
	guildsProcessed: number;
	guildsSkipped: number;
	budgetExhausted: boolean;
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

		for (const { guild_id: guildId } of guildRows) {
			if (result.deleted >= budget) {
				result.budgetExhausted = true;
				break;
			}

			const cutoff = await resolveGuildCutoff(db, guildId, retentionCutoff);
			if (!cutoff) {
				// No daily aggregate yet: its history is not preserved anywhere else.
				result.guildsSkipped++;
				continue;
			}
			result.guildsProcessed++;

			// Batched so no single statement is a large scan, and so the run stops
			// cleanly on the budget rather than mid-table.
			for (;;) {
				const remaining = budget - result.deleted;
				if (remaining <= 0) {
					result.budgetExhausted = true;
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
				if (removed === 0) break;
			}
		}

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
