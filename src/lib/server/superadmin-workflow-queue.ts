/**
 * Producer helpers for the `spacebot-workflow-runs` queue.
 *
 * Pages can't bind Cloudflare Workflows directly, so durable execution routes
 * through this queue: the orchestrator worker consumes messages and creates /
 * wakes `SuperadminRunWorkflow` instances (deterministic id `sa-run-<runId>`).
 *
 * When the binding is absent (local `bun run dev`, tests), callers fall back
 * to driving the run inline — see driveSuperadminWorkflowRunInline.
 */

import { dev } from '$app/environment';
import { log } from '$lib/log.js';

function getQueue(platform) {
	return (
		platform as { env?: { WORKFLOW_RUNS_QUEUE?: { send: (msg: unknown) => Promise<void> } } }
	)?.env?.WORKFLOW_RUNS_QUEUE;
}

/**
 * The queue only helps when the orchestrator worker is consuming it. In vite
 * dev the platform proxy binds a local queue nobody consumes, so runs would
 * hang `queued` — treat dev as queueless (inline execution) unless
 * WORKFLOW_DURABLE_EXECUTION=true forces it. Setting it to `false` disables
 * the queue anywhere (e.g. wrangler pages dev without the worker running).
 */
function queueDisabled(platform) {
	const flag = String(
		(platform as { env?: Record<string, string> })?.env?.WORKFLOW_DURABLE_EXECUTION ??
			(typeof process !== 'undefined' ? process.env?.WORKFLOW_DURABLE_EXECUTION : '') ??
			''
	).toLowerCase();
	if (flag === 'false') return true;
	if (flag === 'true') return false;
	return dev;
}

export function hasWorkflowRunsQueue(platform) {
	if (queueDisabled(platform)) return false;
	return Boolean(getQueue(platform)?.send);
}

/**
 * Run work after the response via platform.context.waitUntil when available
 * (must be invoked ON the context object — an unbound reference throws
 * "Illegal invocation"), else await it inline.
 */
export async function runInBackground(platform, promise: Promise<unknown>) {
	const context = (platform as { context?: { waitUntil?: (p: Promise<unknown>) => void } })
		?.context;
	if (context?.waitUntil) {
		context.waitUntil(promise);
	} else {
		await promise;
	}
}

/** Ask the worker to start a Workflow instance for the run. Idempotent on the
 * consumer side (deterministic instance id). Returns false if unavailable. */
export async function enqueueWorkflowRunStart(platform, runId) {
	if (queueDisabled(platform)) return false;
	const queue = getQueue(platform);
	if (!queue?.send) return false;

	try {
		await queue.send({ type: 'superadmin_run_start', runId: Number(runId) });
		return true;
	} catch (error) {
		log.error(`[Workflows] Failed to enqueue run start for #${runId}:`, error);
		return false;
	}
}

/** Wake the run's Workflow instance after an approval decision. */
export async function enqueueWorkflowRunApproval(platform, runId, stepKey) {
	if (queueDisabled(platform)) return false;
	const queue = getQueue(platform);
	if (!queue?.send) return false;

	try {
		await queue.send({
			type: 'superadmin_run_approval',
			runId: Number(runId),
			stepKey: String(stepKey),
		});
		return true;
	} catch (error) {
		log.error(`[Workflows] Failed to enqueue approval wake for #${runId}:`, error);
		return false;
	}
}
