import { describe, expect, it } from "vitest";
import { runStatsAggregation } from "../lib/db/stats-aggregation.js";

function sqlDateTime(date: Date) {
	return date.toISOString().slice(0, 19).replace("T", " ");
}

function countHourBuckets(effectiveStartStr: string) {
	const start = new Date(`${effectiveStartStr.replace(" ", "T")}Z`);
	const currentHourStart = new Date();
	currentHourStart.setUTCMinutes(0, 0, 0);

	const bucketStart = new Date(start);
	bucketStart.setUTCMinutes(0, 0, 0);
	if (bucketStart < start) bucketStart.setUTCHours(bucketStart.getUTCHours() + 1);

	let count = 0;
	while (bucketStart < currentHourStart) {
		count++;
		bucketStart.setUTCHours(bucketStart.getUTCHours() + 1);
	}
	return count;
}

class FakeAggDb {
	hourlyCheckpoint: string;
	prepareCount = 0;

	constructor(hourlyCheckpoint: string) {
		this.hourlyCheckpoint = hourlyCheckpoint;
	}

	prepare(sql: string) {
		this.prepareCount++;
		const db = this;
		let boundArgs: any[] = [];
		return {
			bind(...args: any[]) {
				boundArgs = args;
				return this;
			},
			async first() {
				if (sql.includes("FROM stats_processing_checkpoint")) return null;
				if (sql.includes("MAX(period_end)") && sql.includes("period_type = 'hourly'")) {
					return { last_period: db.hourlyCheckpoint };
				}
				if (sql.includes("MAX(period_end)") && sql.includes("period_type = 'daily'")) {
					return { last_period: null };
				}
				// Any other per-hour-loop lookup (memberStats, voiceStats, baseline,
				// peakConcurrent, messageStats, totalEvents) — count as zero.
				return { count: 0, joins: 0, leaves: 0, unique_users: 0, total_seconds: 0, peak: 0, last_id: null };
			},
			async all() {
				if (sql.includes("FROM event_logs") && sql.includes("event_type IN ('VOICE_JOIN'")) {
					return { results: [] }; // processVoiceSessions: nothing unprocessed
				}
				if (sql.includes("FROM aggregated_stats") && sql.includes("period_type = 'hourly'")) {
					return { results: [] }; // buildDailyStats roll-up source — nothing to roll up
				}
				if (sql.includes("SELECT DISTINCT") && sql.includes("period_start")) {
					const effectiveStart = boundArgs[1];
					const n = countHourBuckets(effectiveStart);
					return { results: Array.from({ length: n }, () => ({ period_start: "x", period_end: "y" })) };
				}
				return { results: [] };
			},
			async run() {
				return { meta: { changes: 1 } };
			},
		};
	}
}

describe("runStatsAggregation repair option", () => {
	it("repair: false only processes hours since the last checkpoint", async () => {
		const checkpoint = sqlDateTime(new Date(Date.now() - 2 * 60 * 60 * 1000));
		const db = new FakeAggDb(checkpoint);

		const result = await runStatsAggregation(db, "guild1", { repair: false });

		expect(result.hourly.success).toBe(true);
		// ~2 hours of backlog, not the full 7-day repair window.
		expect(result.hourly.periodsProcessed).toBeLessThanOrEqual(3);
	});

	it("repair: true (default) re-walks the full multi-day window regardless of checkpoint", async () => {
		const checkpoint = sqlDateTime(new Date(Date.now() - 2 * 60 * 60 * 1000));
		const db = new FakeAggDb(checkpoint);

		const result = await runStatsAggregation(db, "guild1");

		expect(result.hourly.success).toBe(true);
		// 7-day HOURLY_REPAIR_DAYS window ≈ 168 hourly buckets, far more than the
		// ~2 hours of actual backlog — this is the cost the interactive path now avoids.
		expect(result.hourly.periodsProcessed).toBeGreaterThan(150);
	});
});
