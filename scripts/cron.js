/**
 * Cron tick for SpaceBot
 *
 * Lightweight PM2-managed process. Schedules no longer live here — they are
 * defined on superadmin workflow templates in D1 (cron_expression) and fired
 * by POST /api/superadmin/workflows/dispatch, which this process simply ticks
 * every 30 seconds. Manage schedules in Admin → Superadmin → Workflows.
 *
 * Also polls for remote deploys (unchanged).
 */

import 'dotenv/config';
import { loadSecrets, getSecret } from '../src/lib/secrets.js';
import { deploy, getRemoteDeployPlan } from './deploy-runner.js';

const API_BASE = process.env.API_BASE || 'https://spacebot.starspace.group';
const TICK_INTERVAL_MS = Number(process.env.CRON_TICK_INTERVAL_MS || 30_000);
const autoDeployIntervalMs = Number(process.env.AUTO_DEPLOY_INTERVAL_MS || 60_000);

/**
 * Tick the workflow dispatcher. It decides what is due, dedupes per minute,
 * and executes due workflows server-side.
 */
async function tickDispatcher(cronSecret) {
	const url = `${API_BASE}/api/superadmin/workflows/dispatch`;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 120_000);

	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${cronSecret}`,
			},
			body: JSON.stringify({}),
			signal: controller.signal,
		});

		const data = await res.json().catch(() => ({}));

		if (!res.ok) {
			console.error(`[Cron] Dispatch failed (${res.status}):`, data.error || data);
			return false;
		}

		if (Array.isArray(data.dispatched) && data.dispatched.length > 0) {
			console.log(`[Cron] Dispatched ${data.dispatched.length} workflow(s): ${data.dispatched.map((d) => d.slug).join(', ')}`);
		}
		if (Array.isArray(data.seeded) && data.seeded.length > 0) {
			console.log(`[Cron] Seeded workflow presets: ${data.seeded.join(', ')}`);
		}
		if (Array.isArray(data.failures) && data.failures.length > 0) {
			console.error('[Cron] Dispatch failures:', data.failures);
		}
		return true;
	} catch (err) {
		if (err.name === 'AbortError') {
			console.error('[Cron] Dispatch timed out after 120s');
		} else {
			console.error('[Cron] Dispatch error:', err.message);
		}
		return false;
	} finally {
		clearTimeout(timeout);
	}
}

let lastDeployCheck = 0;
let deployInProgress = false;

function checkForRemoteDeploy(now) {
	if (deployInProgress) return;
	if (now - lastDeployCheck < autoDeployIntervalMs) return;

	lastDeployCheck = now;
	deployInProgress = true;

	queueMicrotask(() => {
		try {
			const plan = getRemoteDeployPlan();
			if (!plan) {
				return;
			}

			console.log(
				`[Deploy] New commit detected: ${plan.localHead.slice(0, 7)} -> ${plan.remoteHead.slice(0, 7)}`
			);
			deploy(plan.changedFiles, {
				trigger: 'cron-poll',
				branch: plan.branch,
				remote: plan.remote,
				remoteHead: plan.remoteHead,
			});
		} catch (err) {
			console.error('[Deploy] Auto-deploy check failed:', err.message);
		} finally {
			deployInProgress = false;
		}
	});
}

/**
 * Main loop — tick the dispatcher every 30 seconds
 */
async function main() {
	await loadSecrets();

	const cronSecret = getSecret('CRON_SECRET');
	if (!cronSecret) {
		console.error('[Cron] CRON_SECRET not configured. Set it in GCP Secret Manager or .env');
		process.exit(1);
	}

	console.log(`[Cron] Workflow dispatcher tick started — targeting ${API_BASE} every ${Math.round(TICK_INTERVAL_MS / 1000)}s`);
	console.log('[Cron] Schedules are managed in Admin → Superadmin → Workflows (D1 templates)');
	console.log(`[Deploy] Auto-deploy polling every ${Math.round(autoDeployIntervalMs / 1000)}s`);

	let dispatching = false;
	const tick = async () => {
		const now = Date.now();
		checkForRemoteDeploy(now);

		if (dispatching) return; // Don't stack ticks behind a slow dispatch
		dispatching = true;
		try {
			await tickDispatcher(cronSecret);
		} finally {
			dispatching = false;
		}
	};

	// Initial tick
	await tick();

	// Then on the configured interval
	setInterval(tick, TICK_INTERVAL_MS);
}

main().catch(err => {
	console.error('[Cron] Fatal error:', err);
	process.exit(1);
});
