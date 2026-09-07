/**
 * Database Migration Runner
 * Automatically runs all SQL migration files in the migrations folder
 * Tracks applied migrations in a _migrations table to avoid re-running them.
 *
 * Usage:
 *   bun scripts/migrate.js         # Run against remote D1
 *   bun scripts/migrate.js --local # Run against local D1
 */

try {
	// Optional in CI/build images; local runs can still use dotenv when installed.
	await import('dotenv/config');
} catch {
	// No .env loader available; continue with existing process environment.
}
import { execFileSync, execSync } from 'child_process';
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
	isAlreadyAppliedError,
	isTransientD1Error,
	shouldFallbackToCommandExecution,
} from './lib/d1-errors.js';
import { columnValues, parseD1Rows } from './lib/d1-json.js';
import {
	hasExecutableSql,
	splitSqlStatements,
	stripLeadingComments,
} from './lib/sql-statements.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..', 'migrations');

// Check for --local flag
const isLocal = process.argv.includes('--local');
const dbName = 'spacebot-logs';
const locationFlag = isLocal ? '--local' : '--remote';
const maxD1Retries = isLocal ? 1 : 3;

// Cloudflare Pages applies ONE build command to every environment, so a preview
// build for any branch runs this script too — and --remote points at the same
// production database id that production migrates. A preview build of an open
// PR was therefore trying to apply that branch's unmerged migrations to the
// live database. It only ever failed because the preview environment's API
// token lacks D1 write access, which is luck, not a guard.
//
// Migrate from the production branch only. Preview builds skip straight to the
// build step, which is all a preview needs.
const productionBranch = process.env.PAGES_PRODUCTION_BRANCH || 'main';
const pagesBranch = process.env.CF_PAGES_BRANCH;

if (!isLocal && pagesBranch && pagesBranch !== productionBranch) {
	console.log(
		`⏭️  Preview build on "${pagesBranch}" — skipping remote migrations ` +
			`(only "${productionBranch}" migrates ${dbName}).`
	);
	process.exit(0);
}

function sleepMs(ms) {
	if (ms <= 0) return;
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function extractErrorOutput(error) {
	return error?.stderr?.toString() || error?.stdout?.toString() || error?.message || '';
}

/**
 * Run a query and return its rows.
 *
 * `--json` gives Wrangler's result set with none of the banner around it, so
 * this parses JSON instead of scraping names out of console output with a
 * regex. The old scraper could not tell an empty table from an unreadable one,
 * and both produced "no migrations are applied" in silence.
 *
 * Throws on anything it cannot read, so the caller decides what that means.
 */
function d1Query(sql) {
	return parseD1Rows(d1Execute(sql, ['--json']));
}

/**
 * A scratch directory for the SQL this script hands to Wrangler.
 *
 * Deliberately not `migrations/`: the runner picks up every `*.sql` in there,
 * so a temp file left behind by a crashed run would be applied as a migration
 * on the next build. Created lazily, because most runs never need it.
 */
let scratchDir: string | null = null;

function scratchPath(name) {
	if (!scratchDir) scratchDir = mkdtempSync(join(tmpdir(), 'spacebot-d1-'));
	return join(scratchDir, name);
}

function cleanupScratchDir() {
	if (!scratchDir) return;
	try {
		rmSync(scratchDir, { recursive: true, force: true });
	} catch {
		// Best-effort; the OS reclaims it either way.
	}
	scratchDir = null;
}

/**
 * Apply a migration one statement at a time.
 *
 * Each statement goes to Wrangler in a **file**, never as `--command`. A
 * statement usually carries its leading comment, so the value would start with
 * `--`, and Wrangler's argument parser has mis-read that in two different
 * builds — first as a missing value, then as a run of unknown positional
 * arguments (`Unknown arguments: Migration:, Support, multiple, ...`, which
 * failed a production deploy on 0004). A file has no such ambiguity, and it is
 * the same mechanism the whole-file path already uses.
 */
function executeSqlFileStatementwise(filePath) {
	const sql = readFileSync(filePath, 'utf8');
	const statements = splitSqlStatements(sql);
	let index = 0;

	for (const statement of statements) {
		if (!hasExecutableSql(statement)) continue;
		index += 1;

		const statementPath = scratchPath(`statement-${process.pid}-${index}.sql`);
		writeFileSync(statementPath, `${stripLeadingComments(statement)}\n`, 'utf8');

		try {
			d1CliExecute(['--file', statementPath]);
		} catch (error) {
			// The whole-file path treats "already exists" / "no such column" as a
			// migration that has nothing left to do and moves on. This path has to
			// agree, or a re-run fails the build on work that is already done —
			// which is how a production deploy died on 0033_drop_welcome_messages.
			//
			// Skipping the one statement rather than the whole file matters too:
			// 0033 drops three columns, so aborting on the first would leave the
			// other two behind and the file recorded as applied.
			const output = extractErrorOutput(error);
			if (!isAlreadyAppliedError(output)) throw error;
			console.log('     ⏭️  Statement already applied; continuing');
		} finally {
			try {
				unlinkSync(statementPath);
			} catch {
				// Best-effort cleanup.
			}
		}
	}
}

function commandExists(command) {
	try {
		const probe = process.platform === 'win32' ? `where ${command}` : `command -v ${command}`;
		execSync(probe, { stdio: 'pipe' });
		return true;
	} catch {
		return false;
	}
}

function resolveWranglerCommand() {
	const localWrangler = join(
		__dirname,
		'..',
		'node_modules',
		'.bin',
		process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler'
	);

	if (existsSync(localWrangler)) {
		return {
			command: localWrangler,
			prefixArgs: [],
			display: localWrangler,
		};
	}
	if (commandExists('bunx')) {
		return {
			command: 'bunx',
			prefixArgs: ['wrangler'],
			display: 'bunx wrangler',
		};
	}

	throw new Error('Wrangler CLI not found. Install wrangler or make bunx available in PATH.');
}

const wranglerCommand = resolveWranglerCommand();

console.log(`🗄️  Running migrations ${isLocal ? '(local)' : '(remote)'}...\n`);
console.log(`Using Wrangler command: ${wranglerCommand.display}`);

// Get all .sql files sorted alphabetically (ensures order like 0001, 0002, etc.)
const migrationFiles = readdirSync(migrationsDir)
	.filter((file) => file.endsWith('.sql'))
	.sort();

if (migrationFiles.length === 0) {
	console.log('No migration files found.');
	process.exit(0);
}

function d1CliExecute(args) {
	let lastError;
	for (let attempt = 1; attempt <= maxD1Retries; attempt++) {
		try {
			return execFileSync(
				wranglerCommand.command,
				[...wranglerCommand.prefixArgs, 'd1', 'execute', dbName, locationFlag, ...args],
				{ stdio: 'pipe', encoding: 'utf8' }
			);
		} catch (error) {
			lastError = error;
			const errorOutput = extractErrorOutput(error);
			const canRetry = attempt < maxD1Retries && isTransientD1Error(errorOutput);

			if (!canRetry) {
				throw error;
			}

			console.log(
				`     🔁 Transient D1 API error (attempt ${attempt}/${maxD1Retries}); retrying...`
			);
			sleepMs(attempt * 1000);
		}
	}

	throw lastError;
}

/**
 * Execute a SQL command string against D1 and return stdout
 */
function d1Execute(sql, extraArgs: string[] = []) {
	const tempSqlPath = scratchPath(`exec-${process.pid}-${Date.now()}.sql`);

	writeFileSync(tempSqlPath, `${sql.trim()}\n`, 'utf8');
	try {
		return d1CliExecute(['--file', tempSqlPath, ...extraArgs]);
	} finally {
		try {
			unlinkSync(tempSqlPath);
		} catch {
			// Best-effort cleanup.
		}
	}
}

// Ensure the _migrations tracking table exists
d1Execute(
	"CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))"
);

/**
 * Which migrations the database already has recorded.
 *
 * A failure here is not fatal — the migrations themselves are written to be
 * re-runnable, and the loop treats "already exists" / "duplicate column" as a
 * skip. But it is not free either: every file gets handed to Wrangler again,
 * which is minutes of build time and a much wider blast radius than a skip.
 *
 * So it is reported. The old code swallowed the error and left an empty set,
 * which is indistinguishable from a genuinely empty table — a production build
 * re-applied 37 migrations that way and said nothing about why.
 */
let appliedMigrations = new Set<string>();
let trackingReadable = false;

try {
	appliedMigrations = new Set(columnValues(d1Query('SELECT name FROM _migrations'), 'name'));
	trackingReadable = true;
} catch (error) {
	console.warn(
		`⚠️  Could not read the _migrations tracking table: ${extractErrorOutput(error).trim()}`
	);
	console.warn(
		'   Every migration will be re-attempted. That is safe but slow, and it means\n' +
			'   nothing has been recorded as applied — check the D1 binding and token.\n'
	);
}

// Nothing to do: the tracking table already names every file on disk.
if (trackingReadable && migrationFiles.every((file) => appliedMigrations.has(file))) {
	console.log(`\n✅ No new migrations to apply (${appliedMigrations.size} tracked).`);
	cleanupScratchDir();
	process.exit(0);
}

console.log(`Found ${migrationFiles.length} migration file(s):\n`);

let successCount = 0;
let skippedCount = 0;
let errorCount = 0;
/** Files this run either applied or found already present. */
const settledMigrations: string[] = [];

for (const file of migrationFiles) {
	console.log(`  📄 ${file}`);

	// Skip if already applied
	if (appliedMigrations.has(file)) {
		console.log(`     ⏭️  Already recorded (skipped)\n`);
		skippedCount++;
		settledMigrations.push(file);
		continue;
	}

	const filePath = join(migrationsDir, file);

	try {
		d1CliExecute(['--file', filePath]);

		// Record successful migration
		try {
			d1Execute(`INSERT OR IGNORE INTO _migrations (name) VALUES ('${file}')`);
			appliedMigrations.add(file);
		} catch (trackingError) {
			// Non-fatal: migration ran but tracking insert failed
			const trackingOutput = extractErrorOutput(trackingError);
			if (trackingOutput) {
				console.log(
					`     ⚠️  Migration ran but failed to record in tracking table: ${trackingOutput.trim()}\n`
				);
			} else {
				console.log(`     ⚠️  Migration ran but failed to record in tracking table\n`);
			}
		}

		console.log(`     ✅ Success\n`);
		successCount++;
		settledMigrations.push(file);
	} catch (error) {
		const errorOutput = extractErrorOutput(error);

		if (isAlreadyAppliedError(errorOutput)) {
			// Migration was already applied before tracking existed — record it now
			try {
				d1Execute(`INSERT OR IGNORE INTO _migrations (name) VALUES ('${file}')`);
				appliedMigrations.add(file);
			} catch {
				// Non-fatal
			}
			console.log(`     ⏭️  Already in the database, recording it (skipped)\n`);
			skippedCount++;
			settledMigrations.push(file);
		} else if (!isLocal && shouldFallbackToCommandExecution(errorOutput)) {
			try {
				console.log(
					'     ⚠️  Wrangler file import failed; retrying migration with statement-by-statement execution...'
				);
				executeSqlFileStatementwise(filePath);

				try {
					d1Execute(`INSERT OR IGNORE INTO _migrations (name) VALUES ('${file}')`);
					appliedMigrations.add(file);
				} catch (trackingError) {
					const trackingOutput = extractErrorOutput(trackingError);
					if (trackingOutput) {
						console.log(
							`     ⚠️  Migration ran but failed to record in tracking table: ${trackingOutput.trim()}\n`
						);
					} else {
						console.log(
							`     ⚠️  Migration ran but failed to record in tracking table\n`
						);
					}
				}

				console.log(`     ✅ Success (fallback)\n`);
				successCount++;
				settledMigrations.push(file);
			} catch (fallbackError) {
				const fallbackOutput = extractErrorOutput(fallbackError);

				// Same rule as the primary path above: already-applied is a skip,
				// not a build failure.
				if (isAlreadyAppliedError(fallbackOutput)) {
					try {
						d1Execute(`INSERT OR IGNORE INTO _migrations (name) VALUES ('${file}')`);
						appliedMigrations.add(file);
					} catch {
						// Non-fatal
					}
					console.log(`     ⏭️  Already in the database, recording it (skipped)\n`);
					skippedCount++;
					settledMigrations.push(file);
				} else {
					console.error(`     ❌ Error: ${fallbackOutput || fallbackError.message}\n`);
					errorCount++;
				}
			}
		} else {
			console.error(`     ❌ Error: ${errorOutput || error.message}\n`);
			errorCount++;
		}
	}
}

/**
 * Record everything this run settled, in one write, and check it stuck.
 *
 * The per-file inserts above are the primary path. This is the backstop, and
 * it is the part that makes a broken tracking table *visible*: if the count
 * that comes back does not cover what we just applied, the next build will
 * re-run everything again, and that is worth a line in the log rather than
 * four silent minutes.
 */
function reconcileTracking(settled: string[]) {
	if (settled.length === 0) return;

	try {
		const values = settled.map((file) => `('${file.replace(/'/g, "''")}')`).join(', ');
		d1Execute(`INSERT OR IGNORE INTO _migrations (name) VALUES ${values}`);
	} catch (error) {
		console.warn(
			`\n⚠️  Could not record this run in _migrations: ${extractErrorOutput(error).trim()}`
		);
		return;
	}

	try {
		const rows = d1Query('SELECT COUNT(*) AS n FROM _migrations');
		const tracked = Number(rows[0]?.n ?? 0);
		if (tracked >= settled.length) {
			console.log(`\n🗂️  Tracking table holds ${tracked} migration(s).`);
			return;
		}
		console.warn(
			`\n⚠️  Tracking table holds ${tracked} migration(s) but ${settled.length} are applied.\n` +
				'   The next build will re-run the difference. Writes to _migrations are\n' +
				'   not sticking — check the D1 binding and the build token.'
		);
	} catch (error) {
		console.warn(
			`\n⚠️  Could not verify the tracking table: ${extractErrorOutput(error).trim()}`
		);
	}
}

reconcileTracking(settledMigrations);

cleanupScratchDir();

console.log(`\n📊 Migration Summary:`);
console.log(`   ✅ ${successCount} succeeded`);
if (skippedCount > 0) {
	console.log(`   ⏭️  ${skippedCount} already applied`);
}
if (errorCount > 0) {
	console.log(`   ❌ ${errorCount} failed`);
	process.exit(1);
}

console.log(`\n✨ All migrations complete!`);
