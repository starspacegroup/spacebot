import { CronDispatchWorkflow } from './cron-dispatch-workflow';
import { SuperadminRunWorkflow } from './superadmin-run-workflow';
import { MessagePurgeWorkflow } from './message-purge-workflow';

export { CronDispatchWorkflow, SuperadminRunWorkflow, MessagePurgeWorkflow };

export interface Env {
	SPACEBOT_API_BASE?: string;
	CRON_SECRET?: string;
	AI_AUTOPILOT_INTERNAL_KEY?: string;
	CRON_DISPATCH_WORKFLOW: Workflow;
	SUPERADMIN_RUN_WORKFLOW: Workflow;
	MESSAGE_PURGE_WORKFLOW: Workflow;
	AI_AUTOPILOT_QUEUE: Queue<QueueMessage>;
}

interface QueueMessage {
	type?:
		| 'ai_job_created'
		| 'ai_job_due'
		| 'ai_watchdog_sweep'
		| 'superadmin_run_start'
		| 'superadmin_run_approval'
		| 'message_purge_start'
		| string;
	jobId?: string;
	runId?: number;
	stepKey?: string;
	/** message_purge_start payload. */
	purge?: Record<string, unknown>;
	meta?: Record<string, unknown>;
	/** Set on a checkpoint continuation — resume from this saved state. */
	resume_state?: Record<string, unknown>;
	continuation?: number;
}

async function postJson(url: string, body: unknown, env: Env): Promise<unknown> {
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${env.AI_AUTOPILOT_INTERNAL_KEY || ''}`,
		},
		body: JSON.stringify(body || {}),
	});

	if (!response.ok) {
		const text = await response.text().catch(() => '');
		throw new Error(`Request failed (${response.status}): ${text.slice(0, 300)}`);
	}

	return response.json().catch(() => ({}));
}

async function executeJob(jobId: string | undefined, env: Env): Promise<unknown> {
	const base = String(env.SPACEBOT_API_BASE || '').replace(/\/$/, '');
	if (!base) {
		throw new Error('SPACEBOT_API_BASE is not configured');
	}

	return postJson(`${base}/api/ai/jobs/execute`, { jobId }, env);
}

async function runWatchdogSweep(env: Env): Promise<unknown> {
	const base = String(env.SPACEBOT_API_BASE || '').replace(/\/$/, '');
	if (!base) {
		throw new Error('SPACEBOT_API_BASE is not configured');
	}

	return postJson(`${base}/api/ai/jobs/sweep`, {}, env);
}

function superadminInstanceId(runId: number): string {
	return `sa-run-${runId}`;
}

/** Start the durable driver Workflow for a superadmin workflow run. The
 * deterministic instance id makes duplicate queue deliveries no-ops. */
async function startSuperadminRun(runId: number | undefined, env: Env): Promise<void> {
	if (!runId) return;

	try {
		await env.SUPERADMIN_RUN_WORKFLOW.create({
			id: superadminInstanceId(runId),
			params: { runId },
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (/already exists|instance.*exists/i.test(message)) {
			return; // Duplicate delivery — the run is already being driven.
		}
		throw error;
	}
}

/** Start a durable message-purge Workflow. The instance id is derived from the
 * interaction id (plus continuation index) so duplicate queue deliveries are
 * no-ops while a checkpoint continuation still gets a fresh instance. */
async function startMessagePurge(payload: QueueMessage, env: Env): Promise<void> {
	const purge = payload.purge;
	const meta = payload.meta;
	if (!purge) return;

	const interactionId = meta?.interaction_id ? String(meta.interaction_id) : '';
	const continuation = Number(payload.continuation) || 0;
	const baseId = interactionId ? `purge-${interactionId}` : '';
	const id = baseId ? (continuation > 0 ? `${baseId}-c${continuation}` : baseId) : undefined;

	try {
		await env.MESSAGE_PURGE_WORKFLOW.create({
			...(id ? { id } : {}),
			params: { purge, meta, resume_state: payload.resume_state, continuation },
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (/already exists|instance.*exists/i.test(message)) {
			return; // Duplicate delivery — the purge is already running.
		}
		throw error;
	}
}

/** Wake a run's driver Workflow after an operator approval decision. The
 * decision itself is already durable in D1; failing to wake only means the
 * gate resolves at its waitForEvent timeout instead of instantly, so
 * failures are swallowed after logging. */
async function wakeSuperadminRun(
	runId: number | undefined,
	stepKey: string | undefined,
	env: Env
): Promise<void> {
	if (!runId) return;

	try {
		const instance = await env.SUPERADMIN_RUN_WORKFLOW.get(superadminInstanceId(runId));
		await instance.sendEvent({ type: 'approval', payload: { stepKey } });
	} catch (error) {
		console.error(
			'[AI Orchestrator] Failed to wake superadmin run',
			runId,
			error instanceof Error ? error.message : error
		);
	}
}

const handler: ExportedHandler<Env, QueueMessage> = {
	async queue(batch, env, _ctx) {
		for (const message of batch.messages) {
			const payload: QueueMessage = message.body || {};
			const type = payload.type;

			try {
				if (type === 'ai_job_created' || type === 'ai_job_due') {
					await executeJob(payload.jobId, env);
					message.ack();
					continue;
				}

				if (type === 'ai_watchdog_sweep') {
					// Ack even on failure: the sweep is periodic and idempotent, so a
					// failed one is superseded by the next tick — retrying it only
					// burns extra queue operations (2026-07-24 Queues-limit incident).
					try {
						await runWatchdogSweep(env);
					} catch (error) {
						console.error(
							'[AI Orchestrator] Watchdog sweep failed (not retried):',
							error instanceof Error ? error.message : error
						);
					}
					message.ack();
					continue;
				}

				if (type === 'superadmin_run_start') {
					await startSuperadminRun(payload.runId, env);
					message.ack();
					continue;
				}

				if (type === 'superadmin_run_approval') {
					// Best-effort wake-up; the dispatch watchdog is the safety net.
					await wakeSuperadminRun(payload.runId, payload.stepKey, env);
					message.ack();
					continue;
				}

				if (type === 'message_purge_start') {
					await startMessagePurge(payload, env);
					message.ack();
					continue;
				}

				// Unknown messages are acknowledged to avoid poison-looping.
				message.ack();
			} catch (error) {
				// Let Queue retry according to its configured retry policy.
				console.error(
					'[AI Orchestrator] Message failed:',
					error instanceof Error ? error.message : error,
					payload
				);
				message.retry();
			}
		}
	},

	async scheduled(event, env, _ctx) {
		if (event.cron === '* * * * *') {
			try {
				await env.CRON_DISPATCH_WORKFLOW.create({
					params: { firedAt: event.scheduledTime },
				});
			} catch (error) {
				console.error(
					'[AI Orchestrator] Failed to start dispatch workflow:',
					error instanceof Error ? error.message : error
				);
			}
			return;
		}

		if (event.cron === '*/15 * * * *') {
			try {
				await env.AI_AUTOPILOT_QUEUE.send({ type: 'ai_watchdog_sweep' });
			} catch (error) {
				console.error(
					'[AI Orchestrator] Failed to enqueue watchdog sweep:',
					error instanceof Error ? error.message : error
				);
			}
			return;
		}
	},
};

export default handler;
