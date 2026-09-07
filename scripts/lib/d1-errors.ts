/**
 * Classifying what Wrangler tells the D1 migration runner.
 *
 * Lives apart from scripts/migrate.ts for the same reason sql-statements.ts
 * does: importing that file runs migrations, so nothing in it can be tested.
 * These three questions decide whether a failed statement retries, skips or
 * fails the build, and getting one wrong takes a production deploy down with
 * it — so they belong somewhere a test can reach.
 */

/** Worth retrying: D1's API was briefly unavailable, the SQL was never judged. */
export function isTransientD1Error(output) {
	const normalized = output.toLowerCase();
	return (
		normalized.includes('upstream service unavailable') ||
		normalized.includes('[code: 7009]') ||
		normalized.includes('internal error') ||
		normalized.includes('timed out') ||
		normalized.includes('econnreset') ||
		normalized.includes('etimedout') ||
		normalized.includes('too many requests') ||
		normalized.includes(' code: 429')
	);
}

/**
 * The migration has nothing left to do.
 *
 * A re-run reaches this whenever the tracking table has lost an entry the
 * database itself still reflects: `CREATE TABLE` says "already exists", `ADD
 * COLUMN` says "duplicate column name", and `DROP COLUMN` says "no such
 * column". None of them is a broken migration, so none of them fails a build.
 */
export function isAlreadyAppliedError(output) {
	const normalized = output.toLowerCase();
	return (
		normalized.includes('already exists') ||
		normalized.includes('duplicate') ||
		normalized.includes('duplicate column name') ||
		normalized.includes('no such column')
	);
}

/**
 * The file import died inside D1 rather than on the SQL, so the same migration
 * is worth another try one statement at a time.
 */
export function shouldFallbackToCommandExecution(output) {
	const normalized = output.toLowerCase();
	return (
		normalized.includes('d1_reset_do') || normalized.includes('reset before execute completed')
	);
}
