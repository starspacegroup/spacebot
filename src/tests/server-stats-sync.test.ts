import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchGuildStatsFromDiscord, syncServerStatsIfStale } from "../lib/db/server-stats.js";

class FakeStatement {
	db: FakeServerStatsDb;
	sql: string;
	args: any[] = [];

	constructor(db: FakeServerStatsDb, sql: string) {
		this.db = db;
		this.sql = sql;
	}

	bind(...args: any[]) {
		this.args = args;
		return this;
	}

	async first() {
		if (this.sql.includes("SELECT * FROM server_stats")) {
			const [guildId] = this.args;
			const rows = this.db.rows.filter((r) => r.guild_id === guildId);
			return rows[rows.length - 1] ?? null;
		}
		return null;
	}

	async run() {
		if (this.sql.includes("INSERT INTO server_stats")) {
			const [guildId, member_count, online_count, bot_count, human_count] = this.args;
			this.db.rows.push({
				guild_id: guildId,
				member_count,
				online_count,
				bot_count,
				human_count,
				recorded_at: new Date().toISOString(),
			});
			return { meta: { changes: 1 } };
		}
		return { meta: { changes: 0 } };
	}

	async all() {
		return { results: [] };
	}
}

class FakeServerStatsDb {
	rows: any[] = [];

	prepare(sql: string) {
		return new FakeStatement(this, sql);
	}
}

afterEach(() => {
	(global as any).fetch = undefined;
});

describe("fetchGuildStatsFromDiscord includeBotCount option", () => {
	it("skips the member-list pagination when includeBotCount is false", async () => {
		const fetchMock = vi.fn(async (url: string) => {
			expect(String(url)).toContain("/guilds/123?with_counts=true");
			return {
				ok: true,
				json: async () => ({ approximate_member_count: 500, approximate_presence_count: 50, roles: [], emojis: [] }),
			};
		});
		(global as any).fetch = fetchMock;

		const result = await fetchGuildStatsFromDiscord("token", "123", { includeBotCount: false });

		expect(result?.stats.member_count).toBe(500);
		expect(result?.stats.bot_count).toBeNull();
		// Only the single guild-info call should happen — no /members pagination.
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("still counts bots when includeBotCount is true (default)", async () => {
		const fetchMock = vi.fn(async (url: string) => {
			if (String(url).includes("/members")) {
				return { ok: true, json: async () => [] };
			}
			return {
				ok: true,
				json: async () => ({ approximate_member_count: 10, roles: [], emojis: [] }),
			};
		});
		(global as any).fetch = fetchMock;

		const result = await fetchGuildStatsFromDiscord("token", "123");

		expect(result?.stats.bot_count).toBe(0);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});

describe("syncServerStatsIfStale", () => {
	it("does a single fast Discord call and carries forward the last known bot/human split", async () => {
		const db = new FakeServerStatsDb();
		db.rows.push({
			guild_id: "123",
			member_count: 100,
			online_count: 20,
			bot_count: 5,
			human_count: 95,
			recorded_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1h old → stale
		});

		const fetchMock = vi.fn(async () => ({
			ok: true,
			json: async () => ({ approximate_member_count: 110, roles: [], emojis: [] }),
		}));
		(global as any).fetch = fetchMock;

		const result = await syncServerStatsIfStale(db, "123", "token");

		expect(result.refreshed).toBe(true);
		// No /members pagination call should have happened.
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(result.latest.member_count).toBe(110);
		expect(result.latest.bot_count).toBe(5);
		expect(result.latest.human_count).toBe(105);
	});
});
