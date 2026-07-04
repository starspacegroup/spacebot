import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

interface SuperadminRunEnv {
	SPACEBOT_API_BASE?: string;
	CRON_SECRET?: string;
}

interface SuperadminRunParams {
	runId?: number;
}

interface AdvanceResponse {
	run_id: number;
	status: string;
	done: boolean;
	executed_step?: { step_key: string; status: string; duration_ms: number | null } | null;
	wait?: {
		type: 'sleep' | 'approval';
		seconds?: number;
		until?: string;
		step_key?: string;
		timeout_seconds?: number | null;
	} | null;
}

/** Hard budget on driver iterations — well above the Pages-side 500-step
 * guard, so it only trips if the advance endpoint misbehaves. */
const MAX_ITERATIONS = 600;

/**
 * Durable driver for a single superadmin workflow run.
 *
 * All graph semantics live in the Pages app; this Workflow just loops the
 * idempotent advance endpoint, turning its wait instructions into durable
 * `step.sleep` / `step.waitForEvent` calls. Instance ids are deterministic
 * (`sa-run-<runId>`), so duplicate queue deliveries can't double-drive a run.
 *
 * Approval gates: the operator's decision is recorded in D1 by the Pages
 * approval endpoint; the "approval" event delivered via queue consumer →
 * `sendEvent` is only a wake-up. On waitForEvent timeout the next advance
 * call applies the node's timeout route, so a lost event degrades to a slow
 * decision, never a lost one.
 */
export class SuperadminRunWorkflow extends WorkflowEntrypoint<
	SuperadminRunEnv,
	SuperadminRunParams
> {
	async run(event: WorkflowEvent<SuperadminRunParams>, step: WorkflowStep): Promise<void> {
		const runId = Number(event.payload?.runId);
		if (!runId) return;

		const base = String(this.env.SPACEBOT_API_BASE || '').replace(/\/$/, '');
		const cronSecret = this.env.CRON_SECRET || '';
		const instanceId = `sa-run-${runId}`;

		const callApi = async (path: string, body: unknown): Promise<AdvanceResponse> => {
			if (!base) throw new Error('SPACEBOT_API_BASE is not configured');
			if (!cronSecret) throw new Error('CRON_SECRET is not configured');

			const response = await fetch(`${base}${path}`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${cronSecret}`,
				},
				body: JSON.stringify(body || {}),
			});

			if (!response.ok) {
				const text = await response.text().catch(() => '');
				throw new Error(`${path} failed (${response.status}): ${text.slice(0, 300)}`);
			}

			return (await response.json().catch(() => ({}))) as AdvanceResponse;
		};

		const advance = (iteration: number) =>
			step.do(
				`advance-${iteration}`,
				{
					retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
					timeout: '10 minutes',
				},
				() =>
					callApi(`/api/superadmin/workflows/runs/${runId}/advance`, {
						instance_id: instanceId,
					})
			);

		const markFailed = (reason: string) =>
			step
				.do(
					`mark-failed`,
					{ retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' } },
					() => callApi(`/api/superadmin/workflows/runs/${runId}/fail`, { reason })
				)
				.catch(() => {});

		try {
			for (let i = 0; i < MAX_ITERATIONS; i += 1) {
				const result = await advance(i);
				if (result.done) return;

				if (result.wait?.type === 'sleep') {
					const seconds = Math.max(1, Number(result.wait.seconds) || 60);
					await step.sleep(`sleep-${i}`, `${seconds} seconds`);
					continue;
				}

				if (result.wait?.type === 'approval') {
					const timeoutSeconds = Math.max(
						60,
						Number(result.wait.timeout_seconds) || 72 * 3600
					);
					try {
						await step.waitForEvent(`approval-${i}`, {
							type: 'approval',
							timeout: `${timeoutSeconds + 300} seconds`,
						});
					} catch {
						// Timeout: the next advance call applies the gate's timeout route.
					}
					continue;
				}

				// status "running" with no wait → advance to the next node immediately.
			}

			await markFailed('Workflow driver iteration budget exhausted');
		} catch (error) {
			// Advance retries exhausted (Pages unreachable / persistent 5xx).
			await markFailed(
				`Workflow driver failed: ${error instanceof Error ? error.message : String(error)}`
			);
			throw error;
		}
	}
}
