/**
 * Gateway Benchmark API
 * 
 * POST /api/gateway/benchmark - Record a benchmark snapshot (bot token auth)
 * GET  /api/gateway/benchmark - Retrieve benchmark data (superadmin only)
 */

import { json } from "@sveltejs/kit";
import { recordGatewayBenchmark, getBenchmarkStats, getBenchmarkChartData, getRecentBenchmarks } from "$lib/db/gateway-benchmarks.js";
import { getGlobalSetting, setGlobalSetting } from "$lib/db/global-settings.js";
import { log } from "$lib/log.js";

const DEFAULT_BENCHMARK_INTERVAL = 60;

/**
 * Check if user is a superadmin
 */
function checkIsSuperAdmin(userId, platform) {
	if (!userId) return false;
	const adminUserIds = platform?.env?.ADMIN_USER_IDS || process.env.ADMIN_USER_IDS || "";
	return adminUserIds.split(",").map((id) => id.trim()).filter(Boolean).includes(userId);
}

function checkIsBotRequest(request, platform) {
	const authHeader = request.headers.get("Authorization");
	const botToken = platform?.env?.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;
	return Boolean(botToken) && authHeader === `Bot ${botToken}`;
}

/**
 * POST - Record gateway benchmark data from the gateway process
 * Authenticated via bot token
 */
export async function POST({ request, platform }) {
	const authHeader = request.headers.get("Authorization");
	const botToken = platform?.env?.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;

	if (!authHeader || authHeader !== `Bot ${botToken}`) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}

	const db = platform?.env?.DB;
	if (!db) {
		return json({ error: "Database not available" }, { status: 503 });
	}

	try {
		const data = await request.json();

		const result = await recordGatewayBenchmark(db, {
			heartbeat_latency_ms: data.heartbeat_latency_ms,
			gateway_url: data.gateway_url,
			shard_id: data.shard_id,
			guild_count: data.guild_count,
			uptime_seconds: data.uptime_seconds,
			status: data.status,
		});

		if (!result.success) {
			return json({ error: result.error }, { status: 500 });
		}

		// Return the current benchmark interval so the gateway can adjust
		const intervalStr = await getGlobalSetting(db, "benchmark_interval_seconds", String(DEFAULT_BENCHMARK_INTERVAL));
		const interval = parseInt(intervalStr, 10) || DEFAULT_BENCHMARK_INTERVAL;

		return json({ success: true, benchmark_interval_seconds: interval });
	} catch (error) {
		log.error("[GatewayBenchmark API] POST error:", error);
		return json({ error: "Invalid request body" }, { status: 400 });
	}
}

/**
 * GET - Retrieve benchmark data for the superadmin dashboard
 * Authenticated via superadmin cookie
 */
export async function GET({ request, cookies, platform, url }) {
	const db = platform?.env?.DB;
	if (!db) {
		return json({ error: "Database not available" }, { status: 503 });
	}

	const isBotRequest = checkIsBotRequest(request, platform);
	if (!isBotRequest) {
		const userId = cookies.get("discord_user_id");
		if (!checkIsSuperAdmin(userId, platform)) {
			return json({ error: "Unauthorized" }, { status: 401 });
		}
	}

	const range = url.searchParams.get("range") || "24h";
	const validRanges = ["1h", "6h", "24h", "7d", "30d"];
	const safeRange = validRanges.includes(range) ? range : "24h";

	try {
		const intervalStr = await getGlobalSetting(db, "benchmark_interval_seconds", String(DEFAULT_BENCHMARK_INTERVAL));
		const benchmarkInterval = parseInt(intervalStr, 10) || DEFAULT_BENCHMARK_INTERVAL;

		if (isBotRequest) {
			return json({ success: true, benchmark_interval_seconds: benchmarkInterval });
		}

		const [stats, chartData, recentSnapshots] = await Promise.all([
			getBenchmarkStats(db, safeRange),
			getBenchmarkChartData(db, safeRange),
			getRecentBenchmarks(db, 10),
		]);

		return json({
			stats,
			chartData,
			recentSnapshots,
			range: safeRange,
			benchmarkInterval,
			requestOrigin: url.origin,
		});
	} catch (error) {
		log.error("[GatewayBenchmark API] GET error:", error);
		return json({ error: "Failed to fetch benchmark data" }, { status: 500 });
	}
}

/**
 * PATCH - Update benchmark settings (superadmin only)
 */
export async function PATCH({ request, cookies, platform }) {
	const userId = cookies.get("discord_user_id");
	if (!checkIsSuperAdmin(userId, platform)) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}

	const db = platform?.env?.DB;
	if (!db) {
		return json({ error: "Database not available" }, { status: 503 });
	}

	try {
		const data = await request.json();
		const validIntervals = [30, 60, 120, 300, 600, 1800, 3600, 7200, 14400, 28800, 43200, 86400];

		if (data.benchmark_interval_seconds !== undefined) {
			const interval = parseInt(data.benchmark_interval_seconds, 10);
			if (!validIntervals.includes(interval)) {
				return json({ error: "Invalid interval. Must be one of: " + validIntervals.join(", ") }, { status: 400 });
			}

			const result = await setGlobalSetting(db, "benchmark_interval_seconds", String(interval));
			if (!result.success) {
				return json({ error: result.error }, { status: 500 });
			}

			return json({ success: true, benchmark_interval_seconds: interval });
		}

		return json({ error: "No valid settings provided" }, { status: 400 });
	} catch (error) {
		log.error("[GatewayBenchmark API] PATCH error:", error);
		return json({ error: "Invalid request body" }, { status: 400 });
	}
}
