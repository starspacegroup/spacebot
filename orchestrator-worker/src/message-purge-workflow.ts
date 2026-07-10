import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

interface MessagePurgeEnv {
	SPACEBOT_API_BASE?: string;
	CRON_SECRET?: string;
}

interface PurgeDescriptor {
	guild_id: string;
	user_id: string;
	mode: 'user' | 'mentions';
	channel_ids: string;
	max_age_days: number | null;
	max_messages: number | null;
	skip_pinned: boolean;
}

/** Descriptor + progress, threaded through the advance endpoint as JSON. Fields
 * are concrete (all serializable) so step.do() types cleanly. */
interface PurgeState extends PurgeDescriptor {
	channels: string[] | null;
	channel_index: number;
	before_id: string | null;
	deleted_total: number;
	scanned_total: number;
	skipped_channels: number;
	batches: number;
	done: boolean;
}

interface MessagePurgeParams {
	purge?: PurgeDescriptor;
	meta?: Record<string, unknown>;
	/** Present on a checkpoint continuation — resume from this state instead of
	 * starting fresh. */
	resume_state?: PurgeState;
	continuation?: number;
}

interface AdvanceResponse {
	state: PurgeState;
	done: boolean;
	deleted_this_batch: number;
	sleep_seconds: number;
	note: string;
}

/**
 * Safety backstop only. The real per-run batch cap is a superadmin setting
 * enforced Pages-side (the advance endpoint returns done once it's hit, then
 * optionally re-enqueues a continuation). This just bounds the loop if the
 * endpoint never reports done — set well above any sane configured cap.
 */
const MAX_ITERATIONS = 2000;

/**
 * Durable driver for a server-wide message purge.
 *
 * Each Discord REST call is a subrequest, and a Pages Function caps those per
 * invocation — so a purge that pages through the whole history of every channel
 * can't run in one request. This Workflow loops the Pages
 * /api/discord/purge/advance endpoint, which does exactly one bounded batch
 * (one channel page) per call and returns the advanced state. Each `step.do`
 * gets a fresh subrequest budget; the endpoint owns all Discord I/O and progress
 * reporting, so this worker only needs SPACEBOT_API_BASE + CRON_SECRET.
 *
 * We only `step.sleep` when the endpoint reports rate-limit backoff
 * (`sleep_seconds > 1`); normal batches proceed immediately (the HTTP round-trip
 * paces them and keeps the step count near the page count).
 */
export class MessagePurgeWorkflow extends WorkflowEntrypoint<MessagePurgeEnv, MessagePurgeParams> {
	async run(event: WorkflowEvent<MessagePurgeParams>, step: WorkflowStep): Promise<void> {
		const purge = event.payload?.purge;
		const meta = event.payload?.meta ?? {};
		if (!purge?.guild_id || !purge?.user_id) return;

		const base = String(this.env.SPACEBOT_API_BASE || '').replace(/\/$/, '');
		const cronSecret = this.env.CRON_SECRET || '';

		// A continuation resumes from its saved cursor; a fresh run starts from
		// descriptor + zeroed progress. Kept inline so the worker needs no import
		// from the Pages app (initialPurgeState in message-purge.ts is the source
		// of truth for these defaults).
		let state: PurgeState = event.payload?.resume_state ?? {
			...purge,
			channels: null,
			channel_index: 0,
			before_id: null,
			deleted_total: 0,
			scanned_total: 0,
			skipped_channels: 0,
			batches: 0,
			done: false,
		};
		const continuation = Number(event.payload?.continuation) || 0;

		const advance = (iteration: number, current: PurgeState) =>
			step.do(
				`advance-${iteration}`,
				{
					retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
					timeout: '2 minutes',
				},
				async (): Promise<AdvanceResponse> => {
					if (!base) throw new Error('SPACEBOT_API_BASE is not configured');
					if (!cronSecret) throw new Error('CRON_SECRET is not configured');

					const response = await fetch(`${base}/api/discord/purge/advance`, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							Authorization: `Bearer ${cronSecret}`,
						},
						body: JSON.stringify({ state: current, meta, continuation }),
					});
					if (!response.ok) {
						const text = await response.text().catch(() => '');
						throw new Error(
							`purge advance failed (${response.status}): ${text.slice(0, 300)}`
						);
					}
					return (await response.json()) as AdvanceResponse;
				}
			);

		for (let i = 0; i < MAX_ITERATIONS; i += 1) {
			const result = await advance(i, state);
			state = result.state;
			if (result.done) return;
			// Only sleep on real rate-limit backoff; normal pacing is the HTTP hop.
			if (result.sleep_seconds > 1) {
				await step.sleep(`sleep-${i}`, `${Math.ceil(result.sleep_seconds)} seconds`);
			}
		}
	}
}
