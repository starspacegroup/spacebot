/**
 * Batched, budgeted deletes for retention jobs.
 *
 * A retention `DELETE` is the most dangerous statement in this codebase. It runs
 * against the tables that grow fastest, it is usually written when those tables
 * are small, and it is the one query nobody re-reads once it works. Two D1
 * incidents already came from exactly that shape — the 2026-07-27 rows-read
 * blowout (a retention delete that scanned its table twice per flush) and the
 * unbounded `event_logs` growth that made every scan over it slower forever.
 *
 * The binding constraint is **writes**, not reads: D1's free tier allows roughly
 * 100k rows written per day, and a delete costs one row-write per row plus one
 * per index on that row. A single unbounded `DELETE` against a table that has
 * been accumulating for months can therefore exhaust the day's entire write
 * allowance in one statement — taking live logging down with it.
 *
 * So every retention delete goes through here: a bounded subselect on the
 * primary key, repeated until the budget is spent. A large backlog drains over
 * successive nights instead of in one destructive pass.
 *
 * SECURITY: `table` and `where` are interpolated into SQL. They are internal
 * constants only — never pass user input.
 */

import { log } from '../log.js';

export interface BoundedDeleteResult {
	deleted: number;
	budgetExhausted: boolean;
}

/**
 * Delete rows matching `where`, in batches, up to `budget` rows total.
 *
 * @param table      Table name (internal constant, never user input).
 * @param where      SQL predicate without the `WHERE` keyword (internal constant).
 * @param binds      Bind values for `where`.
 * @param idColumn   Primary key used to bound each batch. Defaults to `id`.
 */
export async function deleteInBatches(
	db: any,
	{
		table,
		where,
		binds = [],
		batchSize = 1000,
		budget = 5000,
		idColumn = 'id',
		label,
	}: {
		table: string;
		where: string;
		binds?: any[];
		batchSize?: number;
		budget?: number;
		idColumn?: string;
		label?: string;
	}
): Promise<BoundedDeleteResult> {
	const result: BoundedDeleteResult = { deleted: 0, budgetExhausted: false };
	if (!db) return result;

	// Number() yields NaN rather than nullish, so `??` would not catch garbage
	// here — and a NaN budget would reach the query as `LIMIT NaN`.
	const parsedBudget = Number(budget);
	const maxRows = Number.isFinite(parsedBudget) ? Math.max(0, Math.floor(parsedBudget)) : 5000;
	if (maxRows === 0) return result;

	const parsedBatch = Number(batchSize);
	const size = Number.isFinite(parsedBatch)
		? Math.max(1, Math.min(10000, Math.floor(parsedBatch)))
		: 1000;

	try {
		for (;;) {
			const remaining = maxRows - result.deleted;
			if (remaining <= 0) {
				result.budgetExhausted = true;
				break;
			}

			const deleted = await db
				.prepare(
					`DELETE FROM ${table}
					 WHERE ${idColumn} IN (
						 SELECT ${idColumn} FROM ${table}
						 WHERE ${where}
						 ORDER BY ${idColumn}
						 LIMIT ?
					 )`
				)
				.bind(...binds, Math.min(size, remaining))
				.run();

			const removed = Number(deleted?.meta?.changes || 0);
			result.deleted += removed;
			if (removed === 0) break;
		}

		if (result.deleted > 0) {
			log.info(
				`[Retention] ${label || table}: deleted ${result.deleted} row(s)` +
					(result.budgetExhausted ? ' (budget exhausted, will continue next run)' : '')
			);
		}
	} catch (error: any) {
		log.error(`[Retention] ${label || table} delete failed:`, error?.message || error);
	}

	return result;
}
