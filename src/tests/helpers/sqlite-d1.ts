/**
 * A minimal D1-shaped wrapper around real SQLite (better-sqlite3).
 *
 * Used where the behaviour under test lives in the SQL itself — date arithmetic,
 * LIKE escaping, join semantics — so a hand-written fake would only be testing
 * the fake. `better-sqlite3` is stubbed at *build* time for the Workers bundle
 * (`excludeNativeModules` is `apply: 'build'`), so it is available under vitest.
 */
import Database from 'better-sqlite3';

class Statement {
	private stmt: any;
	private args: any[] = [];

	constructor(db: any, sql: string) {
		this.stmt = db.prepare(sql);
	}

	bind(...args: any[]) {
		this.args = args;
		return this;
	}

	async first() {
		return this.stmt.get(...this.args) ?? null;
	}

	async all() {
		return { results: this.stmt.all(...this.args) };
	}

	async run() {
		const info = this.stmt.run(...this.args);
		return { meta: { changes: info.changes } };
	}
}

export interface SqliteD1 {
	prepare(sql: string): Statement;
	exec(sql: string): void;
	close(): void;
}

export function createSqliteD1(schema?: string): SqliteD1 {
	const db = new Database(':memory:');
	if (schema) db.exec(schema);
	return {
		prepare: (sql: string) => new Statement(db, sql),
		exec: (sql: string) => db.exec(sql),
		close: () => db.close(),
	};
}
