/**
 * Gateway Benchmark API
 * 
 * POST /api/gateway/benchmark - Record a benchmark snapshot (bot token auth)
 * GET  /api/gateway/benchmark - Retrieve benchmark data (superadmin only)
 */

import { json } from "@sveltejs/kit";
import { recordGatewayBenchmark, getBenchmarkStats, getBenchmarkChartData } from "$lib/db/gateway-benchmarks.js";
import { log } from "$lib/log.js";

/**
 * Check if user is a superadmin
 */
function checkIsSuperAdmin(userId, platform) {
	if (!userId) return false;
	const adminUserIds = platform?.env?.ADMIN_USER_IDS || process.env.ADMIN_USER_IDS || "";
	return adminUserIds.split(",").map((id) => id.trim()).filter(Boolean).includes(userId);
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

		return json({ success: true });
	} catch (error) {
		log.error("[GatewayBenchmark API] POST error:", error);
		return json({ error: "Invalid request body" }, { status: 400 });
	}
}

/**
 * GET - Retrieve benchmark data for the superadmin dashboard
 * Authenticated via superadmin cookie
 */
export async function GET({ cookies, platform, url }) {
	const userId = cookies.get("discord_user_id");
	if (!checkIsSuperAdmin(userId, platform)) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}

	const db = platform?.env?.DB;
	if (!db) {
		return json({ error: "Database not available" }, { status: 503 });
	}

	const range = url.searchParams.get("range") || "24h";
	const validRanges = ["1h", "6h", "24h", "7d", "30d"];
	const safeRange = validRanges.includes(range) ? range : "24h";

	try {
		const [stats, chartData] = await Promise.all([
			getBenchmarkStats(db, safeRange),
			getBenchmarkChartData(db, safeRange),
		]);

		return json({ stats, chartData, range: safeRange });
	} catch (error) {
		log.error("[GatewayBenchmark API] GET error:", error);
		return json({ error: "Failed to fetch benchmark data" }, { status: 500 });
	}
}
