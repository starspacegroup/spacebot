/**
 * Gateway Benchmarks Database Helper
 * 
 * Stores and retrieves Discord WebSocket gateway latency snapshots.
 */

import { log } from "$lib/log.js";

/**
 * Record a gateway benchmark snapshot
 * @param {D1Database} db
 * @param {Object} data
 * @param {number} data.heartbeat_latency_ms - WebSocket heartbeat round-trip in ms
 * @param {string} [data.gateway_url] - Discord gateway URL
 * @param {number} [data.shard_id] - Shard ID (0 for single-shard bots)
 * @param {number} [data.guild_count] - Number of guilds the bot is in
 * @param {number} [data.uptime_seconds] - Bot uptime in seconds
 * @param {string} [data.status] - Connection status (connected, reconnecting, etc.)
 */
export async function recordGatewayBenchmark(db, data) {
	if (!db) return { success: false, error: "Database not available" };

	try {
		await db.prepare(`
			INSERT INTO gateway_benchmarks 
				(heartbeat_latency_ms, gateway_url, shard_id, guild_count, uptime_seconds, status)
			VALUES (?, ?, ?, ?, ?, ?)
		`).bind(
			data.heartbeat_latency_ms ?? null,
			data.gateway_url ?? null,
			data.shard_id ?? 0,
			data.guild_count ?? 0,
			data.uptime_seconds ?? 0,
			data.status ?? "connected",
		).run();

		return { success: true };
	} catch (error) {
		log.error("[GatewayBenchmarks] Failed to record:", error);
		return { success: false, error: error.message };
	}
}

/**
 * Get recent gateway benchmark snapshots
 * @param {D1Database} db
 * @param {number} [limit=100] - Max rows to return
 */
export async function getRecentBenchmarks(db, limit = 100) {
	if (!db) return [];

	try {
		const result = await db.prepare(`
			SELECT * FROM gateway_benchmarks
			ORDER BY recorded_at DESC
			LIMIT ?
		`).bind(limit).all();

		return result?.results || [];
	} catch (error) {
		log.error("[GatewayBenchmarks] Failed to fetch recent:", error);
		return [];
	}
}

/**
 * Get benchmark statistics for a time range
 * @param {D1Database} db
 * @param {string} range - "1h", "6h", "24h", "7d", "30d"
 */
export async function getBenchmarkStats(db, range = "24h") {
	if (!db) return null;

	const rangeMap = {
		"1h": "-1 hour",
		"6h": "-6 hours",
		"24h": "-24 hours",
		"7d": "-7 days",
		"30d": "-30 days",
	};
	const sqlRange = rangeMap[range] || "-24 hours";

	try {
		const stats = await db.prepare(`
			SELECT 
				COUNT(*) as total_snapshots,
				ROUND(AVG(heartbeat_latency_ms), 1) as avg_latency,
				MIN(heartbeat_latency_ms) as min_latency,
				MAX(heartbeat_latency_ms) as max_latency,
				ROUND(AVG(CASE WHEN heartbeat_latency_ms IS NOT NULL THEN heartbeat_latency_ms END), 1) as avg_latency_connected,
				SUM(CASE WHEN status != 'connected' THEN 1 ELSE 0 END) as disconnection_count,
				MIN(recorded_at) as earliest,
				MAX(recorded_at) as latest
			FROM gateway_benchmarks
			WHERE recorded_at >= datetime('now', ?)
		`).bind(sqlRange).first();

		return stats;
	} catch (error) {
		log.error("[GatewayBenchmarks] Failed to fetch stats:", error);
		return null;
	}
}

/**
 * Get benchmark chart data (time series) for a time range
 * @param {D1Database} db
 * @param {string} range - "1h", "6h", "24h", "7d", "30d"
 */
export async function getBenchmarkChartData(db, range = "24h") {
	if (!db) return [];

	const rangeMap = {
		"1h": "-1 hour",
		"6h": "-6 hours",
		"24h": "-24 hours",
		"7d": "-7 days",
		"30d": "-30 days",
	};
	const sqlRange = rangeMap[range] || "-24 hours";

	try {
		const result = await db.prepare(`
			SELECT 
				heartbeat_latency_ms,
				guild_count,
				uptime_seconds,
				status,
				recorded_at
			FROM gateway_benchmarks
			WHERE recorded_at >= datetime('now', ?)
			ORDER BY recorded_at ASC
		`).bind(sqlRange).all();

		return result?.results || [];
	} catch (error) {
		log.error("[GatewayBenchmarks] Failed to fetch chart data:", error);
		return [];
	}
}

/**
 * Prune old benchmark data
 * @param {D1Database} db
 * @param {number} [retentionDays=30] - Keep data for this many days
 */
export async function pruneOldBenchmarks(db, retentionDays = 30) {
	if (!db) return { success: false, error: "Database not available" };

	try {
		const result = await db.prepare(`
			DELETE FROM gateway_benchmarks
			WHERE recorded_at < datetime('now', ?)
		`).bind(`-${retentionDays} days`).run();

		return { success: true, deleted: result?.changes || 0 };
	} catch (error) {
		log.error("[GatewayBenchmarks] Failed to prune:", error);
		return { success: false, error: error.message };
	}
}
