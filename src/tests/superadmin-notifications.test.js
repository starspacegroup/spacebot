import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	getFirstLoginDmEnabled,
	notifySuperAdminsOfFirstLogin,
	setFirstLoginDmEnabled,
} from '../lib/server/superadmin-notifications.js';

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

class FakeSettingsDb {
	constructor() {
		this.globalSettings = new Map();
	}

	prepare(sql) {
		return new FakeStatement(this, sql);
	}

	execute(sql, args) {
		if (sql.includes('SELECT value FROM global_settings')) {
			return { value: this.globalSettings.get(args[0]) };
		}

		if (sql.includes('INSERT INTO global_settings')) {
			this.globalSettings.set(args[0], args[1]);
			return { success: true };
		}

		throw new Error(`Unhandled SQL in FakeSettingsDb: ${sql}`);
	}
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('superadmin notifications', () => {
	it('stores the first-login DM setting in global settings', async () => {
		const db = new FakeSettingsDb();

		await setFirstLoginDmEnabled(db, true);
		expect(await getFirstLoginDmEnabled(db)).toBe(true);

		await setFirstLoginDmEnabled(db, false);
		expect(await getFirstLoginDmEnabled(db)).toBe(false);
	});

	it('DMs all configured superadmins when enabled', async () => {
		const db = new FakeSettingsDb();
		await setFirstLoginDmEnabled(db, true);

		const fetchMock = vi.fn(async (url, options = {}) => {
			if (String(url).endsWith('/users/super-1')) {
				return new Response(JSON.stringify({ id: 'super-1', username: 'AdminOne' }), { status: 200 });
			}

			if (String(url).endsWith('/users/super-2')) {
				return new Response(JSON.stringify({ id: 'super-2', username: 'AdminTwo' }), { status: 200 });
			}

			if (String(url).endsWith('/users/@me/channels')) {
				const body = JSON.parse(options.body);
				return new Response(JSON.stringify({ id: `dm-${body.recipient_id}` }), { status: 200 });
			}

			if (String(url).includes('/channels/dm-super-') && String(url).endsWith('/messages')) {
				return new Response(JSON.stringify({ id: 'message-1' }), { status: 200 });
			}

			throw new Error(`Unexpected fetch call: ${url}`);
		});

		vi.stubGlobal('fetch', fetchMock);

		const result = await notifySuperAdminsOfFirstLogin(
			{
				env: {
					DB: db,
					DISCORD_BOT_TOKEN: 'bot-token',
					ADMIN_USER_IDS: 'super-1, super-2',
				},
			},
			{
				id: 'user-99',
				username: 'newuser',
				global_name: 'New User',
			},
		);

		expect(result.success).toBe(true);
		expect(result.deliveredTo).toEqual(['super-1', 'super-2']);
		expect(fetchMock).toHaveBeenCalled();
	});

	it('skips DM delivery when the setting is disabled', async () => {
		const db = new FakeSettingsDb();
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		const result = await notifySuperAdminsOfFirstLogin(
			{
				env: {
					DB: db,
					DISCORD_BOT_TOKEN: 'bot-token',
					ADMIN_USER_IDS: 'super-1',
				},
			},
			{ id: 'user-99', username: 'newuser' },
		);

		expect(result).toMatchObject({ success: true, skipped: true, reason: 'disabled' });
		expect(fetchMock).not.toHaveBeenCalled();
	});
});