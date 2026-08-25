/**
 * A production deploy failed on 0005_command_permissions.sql with "Missing
 * required option --command or --file". The migration was fine. The runner's
 * statement-by-statement fallback passed `--command <statement>`, and almost
 * every migration statement carries its leading `--` comment, so Wrangler's
 * argument parser read the value as more flags and found no value at all.
 *
 * The fallback only runs when a file import trips over a transient D1 error,
 * which is why this sat latent for months and then broke a deploy.
 */
import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { commandArg, hasExecutableSql, splitSqlStatements } from '../../scripts/lib/sql-statements';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../../migrations');

/** Every statement the fallback would actually hand to Wrangler. */
function executableStatements(sql: string) {
	return splitSqlStatements(sql).filter(hasExecutableSql);
}

describe('commandArg', () => {
	it('uses the = form, so a value starting with -- is not read as flags', () => {
		const statement = '-- Add permission controls\nALTER TABLE commands ADD COLUMN x TEXT';

		expect(commandArg(statement)).toBe(`--command=${statement}`);
		expect(commandArg(statement).startsWith('--command=')).toBe(true);
	});

	it('keeps the statement intact', () => {
		expect(commandArg('SELECT 1')).toBe('--command=SELECT 1');
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

	it.each(migrationFiles)('%s produces only parseable --command args', (file) => {
		const sql = readFileSync(join(migrationsDir, file), 'utf8');

		for (const statement of executableStatements(sql)) {
			const arg = commandArg(statement);

			// The bug in one line: an argv entry that is exactly "--command"
			// leaves the statement to be parsed as flags.
			expect(arg).not.toBe('--command');
			expect(arg.startsWith('--command=')).toBe(true);
			expect(arg.slice('--command='.length)).toBe(statement);
		}
	});

	it('0005_command_permissions.sql is the case that broke production', () => {
		const sql = readFileSync(join(migrationsDir, '0005_command_permissions.sql'), 'utf8');
		const statements = executableStatements(sql);

		// Every statement in this file leads with a comment — the shape that the
		// old `--command <value>` form could not pass through.
		expect(statements.length).toBeGreaterThan(0);
		expect(statements.every((s) => s.trimStart().startsWith('--'))).toBe(true);
		expect(statements.every((s) => commandArg(s).startsWith('--command='))).toBe(true);
	});
});
