/**
 * Read-only query access to the production D1 database.
 *
 * Why this exists: diagnosing anything that happened in production — did an
 * automation match, did the gateway ever see the event, what is this guild
 * actually configured with — means reading `event_logs`, `automation_logs`,
 * `automations`, `gateway_logs` and `guild_settings`. Without a way in, the
 * answer to every "why didn't X fire?" is a guess plus a list of things for
 * someone else to go and check by hand.
 *
 * It is deliberately read-only. Not "read-only by convention" — the statement is
 * parsed and anything that is not a SELECT / WITH…SELECT / EXPLAIN / PRAGMA is
 * refused before a request is made. Prod data cannot be changed through this
 * tool no matter what is passed to it, which is what makes it safe to reach for
 * without ceremony. Schema changes go through `migrations/` as they always have.
 *
 * Usage:
 *   bun run db:query "SELECT * FROM automations WHERE guild_id = '123'"
 *   bun run db:query --json "SELECT event_type, COUNT(*) c FROM event_logs GROUP BY 1"
 *   bun run db:query --file scripts/queries/bump-debug.sql
 *
 * Auth: CLOUDFLARE_D1_TOKEN (preferred) or CLOUDFLARE_API_TOKEN, needing the
 * account-scoped "D1 → Read" permission. See docs/production-queries.md.
 */

import { readFileSync } from 'node:fs';

const WRANGLER_TOML = new URL('../wrangler.toml', import.meta.url).pathname;

/** Read-shaped statements. Everything else is refused. */
const READ_ONLY_START = /^\s*(select|with|explain|pragma\s+table_info|pragma\s+table_list)\b/i;

/**
 * Statements that mutate, even buried mid-query (a CTE can hold an INSERT in
 * SQLite, and `PRAGMA writable_schema` is a way to edit the schema in place).
 */
const MUTATING =
	/\b(insert|update|delete|drop|alter|create|replace|attach|detach|vacuum|reindex|writable_schema)\b/i;

function fail(message: string): never {
	console.error(`\n✗ ${message}\n`);
	process.exit(1);
}

/** Account and database ids come from wrangler.toml so they cannot drift. */
function readConfig() {
	const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
	if (!accountId) fail('CLOUDFLARE_ACCOUNT_ID is not set (it lives in .env).');

	let databaseId = process.env.D1_DATABASE_ID;
	if (!databaseId) {
		const toml = readFileSync(WRANGLER_TOML, 'utf8');
		databaseId = toml.match(/\[\[d1_databases\]\][\s\S]*?database_id\s*=\s*"([^"]+)"/)?.[1];
	}
	if (!databaseId) fail('No D1 database id in wrangler.toml or D1_DATABASE_ID.');

	const token = process.env.CLOUDFLARE_D1_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
	if (!token) fail('Set CLOUDFLARE_D1_TOKEN (or CLOUDFLARE_API_TOKEN) in .env.');

	return { accountId, databaseId, token };
}

function assertReadOnly(sql: string) {
	const stripped = sql
		.replace(/--[^\n]*/g, ' ')
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.trim();

	if (!stripped) fail('Empty query.');
	if (!READ_ONLY_START.test(stripped)) {
		fail(
			`Refused: this tool only runs reads (SELECT / WITH / EXPLAIN / PRAGMA table_info).\n` +
				`  Got: ${stripped.slice(0, 80)}${stripped.length > 80 ? '…' : ''}\n` +
				`  Schema and data changes belong in migrations/, applied by the Pages build.`
		);
	}
	const mutation = stripped.match(MUTATING);
	if (mutation) {
		fail(
			`Refused: the query contains "${mutation[0]}", which can modify data.\n` +
				`  Schema and data changes belong in migrations/, applied by the Pages build.`
		);
	}
}

async function run(sql: string) {
	const { accountId, databaseId, token } = readConfig();

	const response = await fetch(
		`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,
		{
			method: 'POST',
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ sql }),
		}
	);

	const body: any = await response.json().catch(() => ({}));

	if (!body?.success) {
		const error = body?.errors?.[0];
		if (error?.code === 7403 || response.status === 403) {
			fail(
				`Cloudflare refused the request (${error?.code || response.status}): the token cannot read D1.\n` +
					`  Add an account-scoped "D1 → Read" permission to the token, or mint a\n` +
					`  read-only one and put it in .env as CLOUDFLARE_D1_TOKEN.\n` +
					`  Steps: docs/production-queries.md`
			);
		}
		fail(`D1 query failed: ${error?.message || `HTTP ${response.status}`}`);
	}

	return body.result?.[0];
}

/** Aligned columns, because most of these queries are read by eye. */
function printTable(rows: any[]) {
	if (!rows.length) return console.log('(no rows)');

	const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
	const cell = (value: any) => {
		if (value === null || value === undefined) return '';
		const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
		return text.length > 120 ? `${text.slice(0, 117)}…` : text.replace(/\n/g, '⏎');
	};

	const widths = columns.map((column) =>
		Math.max(column.length, ...rows.map((row) => cell(row[column]).length))
	);
	const line = (cells: string[]) =>
		cells
			.map((text, i) => text.padEnd(widths[i]))
			.join('  ')
			.trimEnd();

	console.log(line(columns));
	console.log(line(widths.map((width) => '─'.repeat(width))));
	for (const row of rows) console.log(line(columns.map((column) => cell(row[column]))));
}

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const fileFlag = args.indexOf('--file');
const sql =
	fileFlag !== -1
		? readFileSync(args[fileFlag + 1], 'utf8')
		: args.filter((arg) => !arg.startsWith('--')).join(' ');

if (!sql.trim()) {
	console.error('Usage: bun run db:query [--json] "SELECT …"  |  --file <path.sql>');
	process.exit(1);
}

assertReadOnly(sql);

const result = await run(sql);
const rows = result?.results ?? [];

if (asJson) {
	console.log(JSON.stringify(rows, null, 2));
} else {
	printTable(rows);
	const meta = result?.meta;
	if (meta) {
		console.error(
			`\n${rows.length} row(s) · ${meta.rows_read ?? '?'} read · ${
				meta.duration != null ? `${Math.round(meta.duration)}ms` : '?'
			}`
		);
	}
}
