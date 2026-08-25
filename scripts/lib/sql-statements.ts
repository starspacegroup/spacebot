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
 * Build the `--command` argv entry for a statement.
 *
 * `--command <value>` is not safe here: a migration statement usually carries
 * its leading comment, so the value starts with `--`, and Wrangler's argument
 * parser reads that as more flags rather than as the value. The build then
 * dies with "Missing required option --command or --file" — which is exactly
 * how a production deploy failed on 0005_command_permissions.sql. The
 * `--command=<value>` form has no such ambiguity.
 */
export function commandArg(statement) {
	return `--command=${statement}`;
}
