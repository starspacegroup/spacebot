/**
 * Two production deploys have died in the migration runner's
 * statement-by-statement fallback, both on the same root cause: the statement
 * was passed to Wrangler on the command line, and almost every migration
 * statement carries its leading `--` comment.
 *
 * First it was `--command <statement>`, which Wrangler read as more flags and
 * rejected with "Missing required option --command or --file". The `=` form
 * fixed that locally and failed anyway on the Pages build image, this time as
 * "Unknown arguments: Migration:, Support, multiple, trigger, events, per,
 * automation" — the words of 0004's own comment, parsed as positionals.
 *
 * Statements now go to Wrangler in a file, so no argument parser sees SQL at
 * all. These tests hold the line at the boundary: nothing handed to the CLI may
 * begin with a dash.
 *
 * The fallback only runs when a file import trips over a transient D1 error,
 * which is why this sat latent for months at a time.
 */
import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import {
	hasExecutableSql,
	splitSqlStatements,
	stripLeadingComments,
} from '../../scripts/lib/sql-statements';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../../migrations');

/** Every statement the fallback would actually hand to Wrangler. */
function executableStatements(sql: string) {
	return splitSqlStatements(sql).filter(hasExecutableSql);
}

describe('stripLeadingComments', () => {
	it('removes the comment a statement leads with', () => {
		const statement = '-- Add permission controls\nALTER TABLE commands ADD COLUMN x TEXT';

		expect(stripLeadingComments(statement)).toBe('ALTER TABLE commands ADD COLUMN x TEXT');
	});

	it('removes several stacked comments', () => {
		const statement = '-- one\n-- two\n\n-- three\nSELECT 1';

		expect(stripLeadingComments(statement)).toBe('SELECT 1');
	});

	it('removes a leading block comment', () => {
		expect(stripLeadingComments('/* note\n   more */\nSELECT 1')).toBe('SELECT 1');
	});

	it('keeps a comment that comes after the SQL starts', () => {
		const statement = 'SELECT 1 -- trailing note';

		expect(stripLeadingComments(statement)).toBe('SELECT 1 -- trailing note');
	});

	it('leaves a statement with no comment alone', () => {
		expect(stripLeadingComments('SELECT 1')).toBe('SELECT 1');
	});

	it('returns empty for a comment with nothing after it', () => {
		expect(stripLeadingComments('-- just a note')).toBe('');
		expect(stripLeadingComments('/* unterminated')).toBe('');
	});
});

describe('splitSqlStatements', () => {
	it('splits on statement boundaries and keeps leading comments attached', () => {
		const statements = splitSqlStatements(
			'-- one\nALTER TABLE a ADD COLUMN b TEXT;\n-- two\nCREATE INDEX i ON a(b);\n'
		);

		expect(statements).toHaveLength(2);
		expect(statements[0]).toContain('-- one');
		expect(statements[0]).toContain('ALTER TABLE a');
		expect(statements[1]).toContain('CREATE INDEX');
	});

	it('does not split on a semicolon inside a string literal', () => {
		const statements = splitSqlStatements("INSERT INTO t (v) VALUES ('a;b');");

		expect(statements).toHaveLength(1);
		expect(statements[0]).toContain("'a;b'");
	});

	it('drops a trailing comment that has no SQL of its own', () => {
		const statements = splitSqlStatements('SELECT 1;\n-- just a note\n');

		expect(statements.filter(hasExecutableSql)).toHaveLength(1);
	});
});

describe('every migration survives the statement-by-statement fallback', () => {
	const migrationFiles = readdirSync(migrationsDir)
		.filter((file) => file.endsWith('.sql'))
		.sort();

	it('has migrations to check', () => {
		expect(migrationFiles.length).toBeGreaterThan(0);
	});

	it.each(migrationFiles)('%s never hands the CLI something dash-leading', (file) => {
		const sql = readFileSync(join(migrationsDir, file), 'utf8');

		for (const statement of executableStatements(sql)) {
			const written = stripLeadingComments(statement);

			// The bug in one line: SQL that starts with a dash gets read as a flag.
			expect(written.startsWith('-')).toBe(false);
			expect(written.length).toBeGreaterThan(0);
		}
	});

	it.each(['0004_multi_trigger_automations.sql', '0005_command_permissions.sql'])(
		'%s is a case that broke production',
		(file) => {
			const sql = readFileSync(join(migrationsDir, file), 'utf8');
			const statements = executableStatements(sql);

			// Every statement in these files leads with a comment — the shape
			// neither command-line form could carry.
			expect(statements.length).toBeGreaterThan(0);
			expect(statements.every((s) => s.trimStart().startsWith('--'))).toBe(true);
			expect(statements.every((s) => !stripLeadingComments(s).startsWith('-'))).toBe(true);
		}
	);
});
