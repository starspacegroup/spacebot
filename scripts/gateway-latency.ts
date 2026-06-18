/**
 * Gateway Latency CLI
 * Run a live latency test against the Discord API/gateway, or view historical data from D1.
 *
 * Usage:
 *   node scripts/gateway-latency.js              # Live test (connect + API pings)
 *   node scripts/gateway-latency.js --history     # Show historical data from D1
 *   node scripts/gateway-latency.js --history --local           # Query local D1
 *   node scripts/gateway-latency.js --history --range 1h        # Custom range (1h, 6h, 24h, 7d, 30d)
 *   node scripts/gateway-latency.js --history --recent 20       # Show last N snapshots
 */

import "dotenv/config";
import { execSync } from "child_process";

const args = process.argv.slice(2);
const isHistoryMode = args.includes("--history");

if (isHistoryMode) {
	await runHistory();
} else {
	await runLiveTest();
}

// ─── Live Test ───────────────────────────────────────────────────────────────

async function runLiveTest() {
	const token = process.env.DISCORD_BOT_TOKEN;
	if (!token) {
		console.error("Missing DISCORD_BOT_TOKEN in environment. Add it to your .env file.");
		process.exit(1);
	}

	console.log("\n⚡ Gateway Latency Test\n");

	const headers = { Authorization: `Bot ${token}` };

	// 1. Get bot info + measure first API call
	const infoStart = Date.now();
	const infoRes = await fetch("https://discord.com/api/v10/users/@me", { headers });
	const infoMs = Date.now() - infoStart;

	if (!infoRes.ok) {
		console.error(`  Auth failed: ${infoRes.status} ${infoRes.statusText}`);
		process.exit(1);
	}
	const bot = await infoRes.json();

	// 2. Get gateway URL
	const gwStart = Date.now();
	const gwRes = await fetch("https://discord.com/api/v10/gateway/bot", { headers });
	const gwMs = Date.now() - gwStart;
	const gwData = gwRes.ok ? await gwRes.json() : null;

	// 3. Run 5 rapid API pings
	const pings = [];
	for (let i = 0; i < 5; i++) {
		const start = Date.now();
		await fetch("https://discord.com/api/v10/users/@me", { headers });
		pings.push(Date.now() - start);
	}

	const avg = Math.round(pings.reduce((a, b) => a + b, 0) / pings.length);
	const min = Math.min(...pings);
	const max = Math.max(...pings);

	console.log(`  Bot:             ${bot.username}#${bot.discriminator}`);
	if (gwData?.url) {
		console.log(`  Gateway:         ${gwData.url}`);
	}
	if (gwData?.shards) {
		console.log(`  Shards:          ${gwData.shards}`);
	}
	if (gwData?.session_start_limit) {
		const ssl = gwData.session_start_limit;
		console.log(`  Sessions:        ${ssl.remaining}/${ssl.total} remaining`);
	}
	console.log();

	console.log("  API Pings (5x /users/@me):");
	for (let i = 0; i < pings.length; i++) {
		console.log(`    ${i + 1}.  ${pings[i]} ms  ${latencyLabel(pings[i])}`);
	}

	console.log();
	console.log("─".repeat(40));
	console.log(`  /users/@me:    ${infoMs} ms`);
	console.log(`  /gateway/bot:  ${gwMs} ms`);
	console.log(`  Avg latency:   ${avg} ms  ${latencyLabel(avg)}`);
	console.log(`  Min:           ${min} ms`);
	console.log(`  Max:           ${max} ms`);
	console.log(`  Jitter:        ${max - min} ms`);
	console.log("─".repeat(40));
	console.log();
}

function latencyLabel(ms) {
	if (ms < 100) return "🟢 excellent";
	if (ms < 200) return "🟡 ok";
	if (ms < 500) return "🟠 fair";
	return "🔴 poor";
}

// ─── History Mode ────────────────────────────────────────────────────────────

async function runHistory() {
	const isLocal = args.includes("--local");
	const dbName = "spacebot-logs";
	const locationFlag = isLocal ? "--local" : "--remote";

	const rangeIdx = args.indexOf("--range");
	const range = rangeIdx !== -1 && args[rangeIdx + 1] ? args[rangeIdx + 1] : "24h";

	const recentIdx = args.indexOf("--recent");
	const recentLimit = recentIdx !== -1 && args[recentIdx + 1] ? parseInt(args[recentIdx + 1], 10) : 10;

	const rangeMap = {
		"1h": "-1 hour",
		"6h": "-6 hours",
		"24h": "-24 hours",
		"7d": "-7 days",
		"30d": "-30 days",
	};

	const sqlRange = rangeMap[range];
	if (!sqlRange) {
		console.error(`Invalid range "${range}". Use one of: 1h, 6h, 24h, 7d, 30d`);
		process.exit(1);
	}

	function d1Execute(sql) {
		return execSync(
			`wrangler d1 execute ${dbName} ${locationFlag} --command="${sql.replace(/"/g, '\\"')}"`,
			{ stdio: "pipe" },
		).toString();
	}

	function parseJsonResults(output) {
		const match = output.match(/\[[\s\S]*\]/);
		if (!match) return [];
		try {
			return JSON.parse(match[0]);
		} catch {
			return [];
		}
	}

	console.log(`\n⚡ Gateway Latency History ${isLocal ? "(local)" : "(remote)"} — range: ${range}\n`);

	// --- Aggregated Stats ---
	try {
		const statsSQL = `SELECT COUNT(*) as total_snapshots, ROUND(AVG(heartbeat_latency_ms), 1) as avg_latency, MIN(heartbeat_latency_ms) as min_latency, MAX(heartbeat_latency_ms) as max_latency, ROUND(AVG(CASE WHEN heartbeat_latency_ms IS NOT NULL THEN heartbeat_latency_ms END), 1) as avg_latency_connected, SUM(CASE WHEN status != 'connected' THEN 1 ELSE 0 END) as disconnection_count, MIN(recorded_at) as earliest, MAX(recorded_at) as latest FROM gateway_benchmarks WHERE recorded_at >= datetime('now', '${sqlRange}')`;

		const statsOutput = d1Execute(statsSQL);
		const statsRows = parseJsonResults(statsOutput);
		const s = statsRows[0];

		if (s && s.total_snapshots > 0) {
			console.log("📊 Statistics");
			console.log("─".repeat(45));
			console.log(`  Snapshots:       ${s.total_snapshots}`);
			console.log(`  Avg latency:     ${s.avg_latency ?? "—"} ms`);
			console.log(`  Min latency:     ${s.min_latency ?? "—"} ms`);
			console.log(`  Max latency:     ${s.max_latency ?? "—"} ms`);
			console.log(`  Disconnections:  ${s.disconnection_count ?? 0}`);
			console.log(`  From:            ${s.earliest ?? "—"}`);
			console.log(`  To:              ${s.latest ?? "—"}`);
			console.log();

			const avg = s.avg_latency;
			console.log(`  Quality:         ${latencyLabel(avg)} (${avg} ms avg)`);
		} else {
			console.log("  No data found for this range.");
		}
	} catch (error) {
		console.error("Failed to fetch stats:", error.message);
	}

	// --- Recent Snapshots ---
	console.log(`\n📋 Last ${recentLimit} Snapshots`);
	console.log("─".repeat(80));

	try {
		const recentSQL = `SELECT heartbeat_latency_ms, status, guild_count, uptime_seconds, recorded_at FROM gateway_benchmarks ORDER BY recorded_at DESC LIMIT ${recentLimit}`;

		const recentOutput = d1Execute(recentSQL);
		const rows = parseJsonResults(recentOutput);

		if (rows.length === 0) {
			console.log("  No snapshots found.");
		} else {
			console.log(
				`  ${"Latency".padEnd(10)} ${"Status".padEnd(14)} ${"Guilds".padEnd(8)} ${"Uptime".padEnd(12)} ${"Recorded At"}`,
			);
			console.log(`  ${"─".repeat(10)} ${"─".repeat(14)} ${"─".repeat(8)} ${"─".repeat(12)} ${"─".repeat(20)}`);

			for (const row of rows) {
				const latency = row.heartbeat_latency_ms != null ? `${row.heartbeat_latency_ms} ms` : "—";
				const uptime = row.uptime_seconds != null ? formatUptime(row.uptime_seconds) : "—";
				console.log(
					`  ${latency.padEnd(10)} ${(row.status || "—").padEnd(14)} ${String(row.guild_count ?? "—").padEnd(8)} ${uptime.padEnd(12)} ${row.recorded_at || "—"}`,
				);
			}
		}
	} catch (error) {
		console.error("Failed to fetch recent snapshots:", error.message);
	}

	console.log();
}

function formatUptime(seconds) {
	if (seconds < 60) return `${seconds}s`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
	if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
	return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}
