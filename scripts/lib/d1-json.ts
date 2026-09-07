/**
 * Reading Wrangler's `--json` result set.
 *
 * Lives apart from scripts/migrate.ts because that file is a script: importing
 * it runs migrations. This is the pure piece, so it can be tested.
 *
 * The migration runner used to find applied migrations by regex-scraping
 * Wrangler's console output. That could not tell an empty tracking table from
 * an unreadable one — both produced "nothing is applied", in silence — and a
 * production build re-applied 37 migrations because of it.
 */

/**
 * Pull the rows out of a `wrangler d1 execute --json` response.
 *
 * Wrangler returns an array with one entry per statement; a single query is
 * still wrapped in that array. An object response is accepted too, because
 * that shape has appeared across versions.
 *
 * @throws when the output is not a result set — an empty table returns `[]`,
 *         which is a fact, while unparseable output is a failure the caller
 *         must not mistake for one.
 */
export function parseD1Rows(output: string): Array<Record<string, any>> {
	const text = String(output ?? '').trim();
	if (!text) throw new Error('Empty response from D1');

	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		// A banner, a warning, an error page — anything but a result set.
		throw new Error(`Response was not JSON: ${text.slice(0, 200)}`);
	}

	const rows = Array.isArray(parsed) ? parsed[0]?.results : parsed?.results;
	if (!Array.isArray(rows)) {
		throw new Error(`Response carried no result set: ${text.slice(0, 200)}`);
	}

	return rows;
}

/** One named column from every row, as strings. */
export function columnValues(rows: Array<Record<string, any>>, column: string): string[] {
	return rows
		.map((row) => row?.[column])
		.filter((value) => value !== null && value !== undefined)
		.map(String);
}
