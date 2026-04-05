/**
 * Gateway Benchmark Page - Server Load
 * 
 * Loads initial benchmark data for the superadmin gateway page.
 * The layout already verifies superadmin access.
 */

import { redirect } from "@sveltejs/kit";
import { getBenchmarkStats, getBenchmarkChartData, getRecentBenchmarks } from "$lib/db/gateway-benchmarks.js";
import { getGlobalSetting } from "$lib/db/global-settings.js";

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform, url }) {
	const userId = cookies.get("discord_user_id");
	if (!userId) throw redirect(302, "/admin");

	const db = platform?.env?.DB;

	const defaultRange = "24h";

	const [stats, chartData, recentSnapshots, intervalStr] = await Promise.all([
		getBenchmarkStats(db, defaultRange),
		getBenchmarkChartData(db, defaultRange),
		getRecentBenchmarks(db, 10),
		getGlobalSetting(db, "benchmark_interval_seconds", "60"),
	]);

	return {
		stats,
		chartData,
		recentSnapshots,
		range: defaultRange,
		benchmarkInterval: parseInt(intervalStr, 10) || 60,
		requestOrigin: url.origin,
	};
}
