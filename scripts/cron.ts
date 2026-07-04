/**
 * Deploy-poll process for SpaceBot (PM2 app "spacebot-cron").
 *
 * Scheduling no longer happens here at all: the orchestrator worker's
 * Cloudflare Cron Trigger → CronDispatchWorkflow durably ticks
 * POST /api/superadmin/workflows/dispatch every minute, and due runs execute
 * as Cloudflare Workflow instances. Manage schedules in Admin → Superadmin →
 * Workflows.
 *
 * The only remaining responsibility is git-poll auto-deploy for the gateway
 * box's long-lived processes.
 */

import 'dotenv/config';
import { loadSecrets } from '../src/lib/secrets.js';
import { deploy, getRemoteDeployPlan } from './deploy-runner.js';

const autoDeployIntervalMs = Number(process.env.AUTO_DEPLOY_INTERVAL_MS || 60_000);

let deployInProgress = false;

function checkForRemoteDeploy() {
	if (deployInProgress) return;
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

async function main() {
	await loadSecrets();

	console.log(
		'[Cron] Scheduling has moved to the orchestrator worker (Cloudflare Cron Trigger).'
	);
	console.log(`[Deploy] Auto-deploy polling every ${Math.round(autoDeployIntervalMs / 1000)}s`);

	checkForRemoteDeploy();
	setInterval(checkForRemoteDeploy, autoDeployIntervalMs);
}

main().catch((err) => {
	console.error('[Cron] Fatal error:', err);
	process.exit(1);
});
