import { describe, expect, it } from 'vitest';
import { upsertUser } from '../lib/db/users.js';

class FakeStatement {
	constructor(db, sql) {
		this.db = db;
		this.sql = sql;
		this.args = [];
	}

	bind(...args) {
		this.args = args;
		return this;
	}

	async first() {
		return this.db.execute(this.sql, this.args, 'first');
	}

	async run() {
		return this.db.execute(this.sql, this.args, 'run');
	}
}

class FakeUsersDb {
	constructor() {
		this.users = new Map();
	}

	prepare(sql) {
		return new FakeStatement(this, sql);
	}

	execute(sql, args) {
		if (sql.includes('SELECT id FROM users WHERE id = ?')) {
			const existing = this.users.get(args[0]);
			return existing ? { id: existing.id } : null;
		}

		if (sql.includes('INSERT INTO users')) {
			const [id, username, globalName, avatar, discriminator, email, isSuperAdmin] = args;
			const existing = this.users.get(id);

			this.users.set(id, {
				id,
				username,
				global_name: globalName,
				avatar,
				discriminator,
				email,
				is_superadmin: isSuperAdmin,
				login_count: existing ? existing.login_count + 1 : 1,
			});

			return { success: true };
		}

		throw new Error(`Unhandled SQL in FakeUsersDb: ${sql}`);
	}
}

describe('upsertUser', () => {
	it('marks the first recorded login as a new user', async () => {
		const db = new FakeUsersDb();

		const result = await upsertUser(db, {
			id: 'user-1',
			username: 'firstuser',
			global_name: 'First User',
			is_superadmin: false,
		});

		expect(result).toMatchObject({ success: true, isNewUser: true });
		expect(db.users.get('user-1')?.login_count).toBe(1);
	});

	it('does not mark subsequent logins as new', async () => {
		const db = new FakeUsersDb();

		await upsertUser(db, {
			id: 'user-1',
			username: 'firstuser',
			global_name: 'First User',
			is_superadmin: false,
		});

		const result = await upsertUser(db, {
			id: 'user-1',
			username: 'firstuser',
			global_name: 'First User',
			is_superadmin: false,
		});

		expect(result).toMatchObject({ success: true, isNewUser: false });
		expect(db.users.get('user-1')?.login_count).toBe(2);
	});
});