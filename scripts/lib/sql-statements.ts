/**
 * SQL statement splitting for the D1 migration runner.
 *
 * Lives apart from scripts/migrate.ts because that file is a script: importing
 * it runs migrations. These are the pure pieces, so they can be tested.
 */

export function splitSqlStatements(sql) {
	const statements = [];
	let current = '';
	let inSingle = false;
	let inDouble = false;
	let inLineComment = false;
	let inBlockComment = false;

	for (let i = 0; i < sql.length; i++) {
		const ch = sql[i];
		const next = i + 1 < sql.length ? sql[i + 1] : '';

		if (inLineComment) {
			current += ch;
			if (ch === '\n') {
				inLineComment = false;
			}
			continue;
		}

		if (inBlockComment) {
			current += ch;
			if (ch === '*' && next === '/') {
				current += next;
				i++;
				inBlockComment = false;
			}
			continue;
		}

		if (!inSingle && !inDouble) {
			if (ch === '-' && next === '-') {
				current += ch + next;
				i++;
				inLineComment = true;
				continue;
			}
			if (ch === '/' && next === '*') {
				current += ch + next;
				i++;
				inBlockComment = true;
				continue;
			}
		}

		if (ch === "'" && !inDouble) {
			if (inSingle && next === "'") {
				current += ch + next;
				i++;
				continue;
			}
			inSingle = !inSingle;
			current += ch;
			continue;
		}

		if (ch === '"' && !inSingle) {
			inDouble = !inDouble;
			current += ch;
			continue;
		}

		if (ch === ';' && !inSingle && !inDouble) {
			const stmt = current.trim();
			if (stmt.length > 0) {
				statements.push(stmt);
			}
			current = '';
			continue;
		}

		current += ch;
	}

	const tail = current.trim();
	if (tail.length > 0) {
		statements.push(tail);
	}

	return statements;
}

/**
 * True when a statement contains executable SQL once comments are removed.
 * splitSqlStatements keeps trailing/standalone comments attached, so a chunk
 * like "-- note" after the final semicolon becomes a comment-only "statement".
 * Passing that to `wrangler d1 execute --command` fails with "Missing required
 * option --command" because the effective SQL is empty.
 */
export function hasExecutableSql(statement) {
	const withoutComments = statement
		.replace(/\/\*[\s\S]*?\*\//g, '') // block comments
		.replace(/--[^\n]*/g, ''); // line comments
	return withoutComments.trim().length > 0;
}

/**
 * Strip the comment lines a statement carries in front of its SQL.
 *
 * `splitSqlStatements` keeps a statement's leading comments attached, which is
 * good for error messages and fatal on a command line: the value then starts
 * with `--`, and Wrangler's argument parser has read that as more flags rather
 * than as the value. It failed two different ways in two different builds —
 * "Missing required option --command or --file", and then "Unknown arguments:"
 * followed by the words of the comment.
 *
 * Statements now go to Wrangler in a file, so nothing depends on this any more.
 * It stays because a statement is easier to read in a log without its preamble.
 */
export function stripLeadingComments(statement) {
	let rest = String(statement ?? '');

	// Loop: a statement can carry several comments, and a block comment can be
	// followed by a line comment.
	for (;;) {
		const trimmed = rest.replace(/^\s+/, '');
		if (trimmed.startsWith('--')) {
			const newline = trimmed.indexOf('\n');
			rest = newline === -1 ? '' : trimmed.slice(newline + 1);
			continue;
		}
		if (trimmed.startsWith('/*')) {
			const end = trimmed.indexOf('*/');
			rest = end === -1 ? '' : trimmed.slice(end + 2);
			continue;
		}
		return trimmed;
	}
}
