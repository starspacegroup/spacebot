import { describe, expect, it } from 'vitest';
import { handleGatewayLogsApi } from '../lib/server/gateway-logs-api.js';

const CAPTURE_KEY = 'gateway_log_capture_enabled';
const UPDATE_REQUIRED_KEY = 'gateway_update_required_version';
const UPDATE_LAST_ATTEMPT_KEY = 'gateway_update_last_attempt';

interface GatewayLogRow {
	id: number;
	level: unknown;
	message: unknown;
	source: unknown;
	logged_at: string;
	created_at: string;
}

class FakeStatement {
	db: FakeDb;
	sql: string;
	args: any[];

	constructor(db: FakeDb, sql: string) {
		this.db = db;
		this.sql = sql;
		this.args = [];
	}

	bind(...args: any[]) {
		this.args = args;
		return this;
	}

	async first() {
		return this.db.execute(this.sql, this.args, 'first');
	}

	async all() {
		return this.db.execute(this.sql, this.args, 'all');
	}

	async run() {
		return this.db.execute(this.sql, this.args, 'run');
	}
}

class FakeDb {
	globalSettings: Map<string, any>;
	logs: GatewayLogRow[];
	nextLogId: number;

	constructor() {
		this.globalSettings = new Map();
		this.logs = [];
		this.nextLogId = 1;
	}

	prepare(sql: string) {
		return new FakeStatement(this, sql);
	}

	execute(sql: string, args: any[], mode: string): any {
		if (sql.includes('SELECT value FROM global_settings')) {
			return { value: this.globalSettings.get(args[0]) };
		}

		if (sql.includes('INSERT INTO global_settings')) {
			this.globalSettings.set(args[0], args[1]);
			return { success: true };
		}

		if (sql.includes('INSERT INTO gateway_logs')) {
			const [level, message, source, loggedAt] = args;
			this.logs.push({
				id: this.nextLogId++,
				level,
				message,
				source,
				logged_at: loggedAt || new Date().toISOString(),
				created_at: new Date().toISOString(),
			});
			return { success: true };
		}

		if (sql.includes('DELETE FROM gateway_logs')) {
			const maxRows = args[0];
			this.logs = this.logs
				.sort((left, right) => right.id - left.id)
				.slice(0, maxRows)
				.sort((left, right) => left.id - right.id);
			return { success: true };
		}

		if (sql.includes('FROM gateway_logs') && sql.includes('WHERE id > ?')) {
			const [afterId, limit] = args;
			return {
				results: this.logs
					.filter((entry) => entry.id > afterId)
					.sort((left, right) => left.id - right.id)
					.slice(0, limit),
			};
		}

		if (sql.includes('FROM gateway_logs') && sql.includes('ORDER BY id DESC')) {
			const [limit] = args;
			return {
				results: [...this.logs]
					.sort((left, right) => right.id - left.id)
					.slice(0, limit),
			};
		}

		throw new Error(`Unhandled SQL in test fake: ${sql} (${mode})`);
	}
}

interface CreateEventOptions {
	method?: string;
	url?: string;
	body?: any;
	headers?: Record<string, string>;
	userId?: string | null;
	db?: FakeDb;
}

function createEvent({
	method = 'GET',
	url = 'http://localhost/api/gateway/logs?limit=10',
	body,
	headers = {},
	userId = null,
	db = new FakeDb(),
}: CreateEventOptions = {}) {
	return {
		request: new Request(url, {
			method,
			headers,
			body: body ? JSON.stringify(body) : undefined,
		}),
		cookies: {
			get(name) {
				return name === 'discord_user_id' ? userId : undefined;
			},
		},
		platform: {
			env: {
				DB: db,
				ADMIN_USER_IDS: 'super-1',
				DISCORD_BOT_TOKEN: 'bot-token',
			},
		},
		url: new URL(url),
	};
}

describe('gateway logs API', () => {
	it('records a gateway heartbeat on bot GET requests', async () => {
		const db = new FakeDb();
		db.globalSettings.set(UPDATE_REQUIRED_KEY, '2026.05.27.2');

		const response = await handleGatewayLogsApi(createEvent({
			headers: { Authorization: 'Bot bot-token' },
			db,
		}));
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.success).toBe(true);
		expect(body.enabled).toBe(false);
		expect(body.status.lastGatewaySeenAt).toBeTruthy();
		expect(body.status.lastGatewayConnected).toBe(true);
		expect(body.gatewayUpdate.requiredVersion).toBe('2026.05.27.2');
		expect(body.gatewayUpdate.suggestedCommand).toBe('git pull && bun run gateway');
	});

	it('stores gateway self-update attempt records via bot PUT', async () => {
		const db = new FakeDb();

		const response = await handleGatewayLogsApi(createEvent({
			method: 'PUT',
			headers: {
				Authorization: 'Bot bot-token',
				'Content-Type': 'application/json',
			},
			body: {
				type: 'gateway_update_attempt',
				targetVersion: '2026.05.27.9',
				gatewayVersion: '2026.05.27.1',
				status: 'started',
			},
			db,
		}));

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.success).toBe(true);
		expect(body.attempt.targetVersion).toBe('2026.05.27.9');

		const persisted = JSON.parse(db.globalSettings.get(UPDATE_LAST_ATTEMPT_KEY));
		expect(persisted.targetVersion).toBe('2026.05.27.9');
		expect(persisted.gatewayVersion).toBe('2026.05.27.1');
		expect(persisted.status).toBe('started');
	});

	it('stores bot log batches and exposes status metadata to superadmins', async () => {
		const db = new FakeDb();
		db.globalSettings.set(CAPTURE_KEY, 'true');

		const postResponse = await handleGatewayLogsApi(createEvent({
			method: 'POST',
			headers: {
				Authorization: 'Bot bot-token',
				'Content-Type': 'application/json',
			},
			body: {
				entries: [
					{
						level: 'info',
						message: 'Gateway capture test entry',
						source: 'gateway',
						logged_at: '2026-04-04T20:00:00.000Z',
					},
				],
			},
			db,
		}));

		expect(postResponse.status).toBe(200);
		expect(await postResponse.json()).toMatchObject({ success: true, stored: 1, enabled: true });

		const getResponse = await handleGatewayLogsApi(createEvent({
			userId: 'super-1',
			db,
		}));
		const getBody = await getResponse.json();

		expect(getResponse.status).toBe(200);
		expect(getBody.logs).toHaveLength(1);
		expect(getBody.logs[0].message).toBe('Gateway capture test entry');
		expect(getBody.status.lastStoredCount).toBe(1);
		expect(getBody.status.lastGatewayPostedAt).toBeTruthy();
	});
});