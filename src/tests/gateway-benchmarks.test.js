import { describe, expect, it } from 'vitest';
import { recordGatewayBenchmark } from '../lib/db/gateway-benchmarks.js';

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

class FakeBenchmarkDb {
	constructor() {
		this.rows = [];
		this.nextId = 1;
	}

	prepare(sql) {
		return new FakeStatement(this, sql);
	}

	seed(row) {
		this.rows.push({
			id: row.id ?? this.nextId++,
			heartbeat_latency_ms: row.heartbeat_latency_ms ?? null,
			gateway_url: row.gateway_url ?? null,
			shard_id: row.shard_id ?? 0,
			guild_count: row.guild_count ?? 0,
			uptime_seconds: row.uptime_seconds ?? 0,
			status: row.status ?? 'connected',
			recorded_at: row.recorded_at ?? new Date().toISOString(),
		});

		this.nextId = Math.max(this.nextId, this.rows[this.rows.length - 1].id + 1);
	}

	execute(sql, args, mode) {
		if (sql.includes('SELECT id, heartbeat_latency_ms, status') && mode === 'first') {
			return [...this.rows]
				.sort((left, right) => {
					const timeDelta = new Date(right.recorded_at).getTime() - new Date(left.recorded_at).getTime();
					return timeDelta !== 0 ? timeDelta : right.id - left.id;
				})
				.at(0) ?? null;
		}

		if (sql.includes('UPDATE gateway_benchmarks') && mode === 'run') {
			const [heartbeatLatency, gatewayUrl, shardId, guildCount, uptimeSeconds, status, id] = args;
			const row = this.rows.find((entry) => entry.id === id);
			if (!row) {
				throw new Error(`Missing row ${id}`);
			}

			row.heartbeat_latency_ms = heartbeatLatency;
			row.gateway_url = gatewayUrl;
			row.shard_id = shardId;
			row.guild_count = guildCount;
			row.uptime_seconds = uptimeSeconds;
			row.status = status;
			row.recorded_at = new Date().toISOString();
			return { success: true };
		}

		if (sql.includes('INSERT INTO gateway_benchmarks') && mode === 'run') {
			const [heartbeatLatency, gatewayUrl, shardId, guildCount, uptimeSeconds, status] = args;
			this.rows.push({
				id: this.nextId++,
				heartbeat_latency_ms: heartbeatLatency,
				gateway_url: gatewayUrl,
				shard_id: shardId,
				guild_count: guildCount,
				uptime_seconds: uptimeSeconds,
				status,
				recorded_at: new Date().toISOString(),
			});
			return { success: true };
		}

		throw new Error(`Unhandled SQL in test fake: ${sql} (${mode})`);
	}
}

describe('recordGatewayBenchmark', () => {
	it('inserts connected benchmark snapshots as new rows', async () => {
		const db = new FakeBenchmarkDb();

		const result = await recordGatewayBenchmark(db, {
			heartbeat_latency_ms: 42,
			gateway_url: 'wss://gateway.discord.gg/',
			guild_count: 8,
			uptime_seconds: 120,
			status: 'connected',
		});

		expect(result).toMatchObject({ success: true });
		expect(db.rows).toHaveLength(1);
		expect(db.rows[0]).toMatchObject({ heartbeat_latency_ms: 42, status: 'connected' });
	});

	it('updates the latest unhealthy snapshot instead of inserting duplicates', async () => {
		const db = new FakeBenchmarkDb();
		db.seed({
			heartbeat_latency_ms: null,
			gateway_url: 'wss://gateway.discord.gg/',
			guild_count: 8,
			uptime_seconds: 60,
			status: 'measuring',
			recorded_at: '2026-04-09T11:00:00.000Z',
		});

		const result = await recordGatewayBenchmark(db, {
			heartbeat_latency_ms: null,
			gateway_url: 'wss://gateway.discord.gg/',
			guild_count: 8,
			uptime_seconds: 180,
			status: 'disconnected',
		});

		expect(result).toMatchObject({ success: true, updated: true });
		expect(db.rows).toHaveLength(1);
		expect(db.rows[0]).toMatchObject({ heartbeat_latency_ms: null, status: 'disconnected', uptime_seconds: 180 });
	});

	it('starts a new unhealthy incident after a healthy snapshot', async () => {
		const db = new FakeBenchmarkDb();
		db.seed({
			heartbeat_latency_ms: null,
			status: 'measuring',
			recorded_at: '2026-04-09T10:58:00.000Z',
		});
		db.seed({
			heartbeat_latency_ms: 35,
			status: 'connected',
			recorded_at: '2026-04-09T11:00:00.000Z',
		});

		const result = await recordGatewayBenchmark(db, {
			heartbeat_latency_ms: null,
			status: 'measuring',
			guild_count: 8,
			uptime_seconds: 240,
		});

		expect(result).toMatchObject({ success: true });
		expect(db.rows).toHaveLength(3);
		expect(db.rows.at(-1)).toMatchObject({ heartbeat_latency_ms: null, status: 'measuring', uptime_seconds: 240 });
	});
});