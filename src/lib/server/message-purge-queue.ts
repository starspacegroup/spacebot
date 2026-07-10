/**
 * Producer helper for offloading a large message-purge sweep to the durable
 * `spacebot-workflow-runs` queue. The orchestrator worker consumes the
 * `message_purge_start` message and creates a MessagePurgeWorkflow instance
 * (deterministic id `purge-<interaction_id>`), which drives the Pages
 * /api/discord/purge/advance endpoint one bounded batch at a time.
 *
 * Reuses the same queue + gating as superadmin runs — see
 * [[superadmin-workflow-queue]] — so no new binding or queue is needed.
 */

import type { PurgeDescriptor, PurgeState } from './message-purge.js';
import { hasWorkflowRunsQueue } from './superadmin-workflow-queue.js';
import { log } from '$lib/log.js';

function getQueue(platform) {
	return (
		platform as { env?: { WORKFLOW_RUNS_QUEUE?: { send: (msg: unknown) => Promise<void> } } }
	)?.env?.WORKFLOW_RUNS_QUEUE;
}

/** Static context the workflow needs to report back to the invoking user. */
export interface PurgeMeta {
	interaction_id: string;
	application_id: string;
	interaction_token: string;
	channel_id: string;
	command_name: string;
}

/** True when the durable purge path is available (queue bound + a consumer
 * running). Callers fall back to inline execution when this is false. */
export function canOffloadPurge(platform): boolean {
	return hasWorkflowRunsQueue(platform);
}

/**
 * Enqueue a purge job for durable execution. Returns false when the queue is
 * unavailable (dev / no worker) so the caller can run the sweep inline instead.
 */
export async function enqueueMessagePurge(
	platform,
	descriptor: PurgeDescriptor,
	meta: PurgeMeta
): Promise<boolean> {
	if (!hasWorkflowRunsQueue(platform)) return false;
	const queue = getQueue(platform);
	if (!queue?.send) return false;

	try {
		await queue.send({ type: 'message_purge_start', purge: descriptor, meta });
		return true;
	} catch (error) {
		log.error('[Purge] Failed to enqueue purge job:', error);
		return false;
	}
}

/**
 * Enqueue a continuation of a purge that hit its per-run batch cap (checkpoint
 * mode). A fresh workflow instance resumes from `resumeState`; the `continuation`
 * index keeps the deterministic instance id unique so it isn't deduped against
 * the run that just paused.
 */
export async function enqueueMessagePurgeContinuation(
	platform,
	resumeState: PurgeState,
	meta: PurgeMeta,
	continuation: number
): Promise<boolean> {
	if (!hasWorkflowRunsQueue(platform)) return false;
	const queue = getQueue(platform);
	if (!queue?.send) return false;

	try {
		await queue.send({
			type: 'message_purge_start',
			purge: resumeState,
			meta,
			resume_state: resumeState,
			continuation,
		});
		return true;
	} catch (error) {
		log.error('[Purge] Failed to enqueue purge continuation:', error);
		return false;
	}
}
