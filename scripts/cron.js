/**
 * Cron Scheduler for SpaceBot
 *
 * Lightweight PM2-managed process that calls the /api/cron endpoint
 * on schedule. Runs alongside the gateway and tunnel processes.
 *
 * Schedules:
 *   - Every minute:  send_scheduled_messages
 *   - Every hour:    hourly_aggregation
 *   - Every day:     daily_refresh (midnight UTC)
 */

import { loadSecrets, getSecret } from '../src/lib/secrets.js';

const API_BASE = process.env.API_BASE || 'https://spacebot.starspace.group';

/** @type {{ job: string, intervalMs: number, lastRun: number, description: string, getNextRun?: () => boolean }[]} */
const schedules = [
	{
		job: 'send_scheduled_messages',
		intervalMs: 60_000, // 1 minute
		lastRun: 0,
		description: 'Send scheduled messages',
	},
	{
		job: 'hourly_aggregation',
		intervalMs: 3_600_000, // 1 hour
		lastRun: 0,
		description: 'Hourly stats aggregation',
	},
	{
		job: 'daily_refresh',
		intervalMs: 86_400_000, // 24 hours
		lastRun: 0,
		description: 'Daily Discord refresh & cleanup',
		// Only run around midnight UTC
		getNextRun() {
			const now = new Date();
			return now.getUTCHours() === 0 && now.getUTCMinutes() < 5;
		},
	},
];

/**
 * Call the /api/cron endpoint to trigger a job
 */
async function triggerJob(jobName, cronSecret) {
	const url = `${API_BASE}/api/cron`;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 120_000); // 2min timeout

	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${cronSecret}`,
			},
			body: JSON.stringify({ jobName }),
			signal: controller.signal,
		});

		const data = await res.json();

		if (!res.ok) {
			console.error(`[Cron] ${jobName} failed (${res.status}):`, data.error || data);
			return false;
		}

		console.log(`[Cron] ${jobName} completed in ${data.duration}ms`);
		return true;
	} catch (err) {
		if (err.name === 'AbortError') {
			console.error(`[Cron] ${jobName} timed out after 120s`);
		} else {
			console.error(`[Cron] ${jobName} error:`, err.message);
		}
		return false;
	} finally {
		clearTimeout(timeout);
	}
}

/**
 * Main loop — checks every 30 seconds if any job is due
 */
async function main() {
	await loadSecrets();

	const cronSecret = getSecret('CRON_SECRET');
	if (!cronSecret) {
		console.error('[Cron] CRON_SECRET not configured. Set it in GCP Secret Manager or .env');
		process.exit(1);
	}

	console.log(`[Cron] Scheduler started — targeting ${API_BASE}`);
	console.log(`[Cron] Jobs: ${schedules.map(s => s.job).join(', ')}`);

	// Run the tick loop every 30 seconds
	const tick = async () => {
		const now = Date.now();

		for (const schedule of schedules) {
			const elapsed = now - schedule.lastRun;

			if (elapsed < schedule.intervalMs) continue;

			// For jobs with a specific time window, check if we're in it
			if (schedule.getNextRun && !schedule.getNextRun()) continue;

			schedule.lastRun = now;

			// Fire and forget — don't block other jobs
			triggerJob(schedule.job, cronSecret).catch(err => {
				console.error(`[Cron] Unhandled error in ${schedule.job}:`, err);
			});
		}
	};

	// Initial tick
	await tick();

	// Then every 30 seconds
	setInterval(tick, 30_000);
}

main().catch(err => {
	console.error('[Cron] Fatal error:', err);
	process.exit(1);
});
