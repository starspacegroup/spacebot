import { json } from '@sveltejs/kit';
import {
	appendAIJobEvent,
	countAIJobRequeues,
	deferAIJobRetry,
	failAIJobTerminal,
	getDuePendingAIJobs,
	MAX_WATCHDOG_REQUEUES,
	recoverStaleRunningAIJobs,
	watchdogBackoffMinutes,
} from '$lib/db/ai-orchestration.js';

function getEnv(platform, name) {
	return (
		platform?.env?.[name] ?? (typeof process !== 'undefined' ? process.env?.[name] : undefined)
	);
}

function checkIsAutopilotRequest(request, platform) {
	const authHeader = request.headers.get('Authorization') || '';
	const internalKey = getEnv(platform, 'AI_AUTOPILOT_INTERNAL_KEY');
	if (internalKey && authHeader === `Bearer ${internalKey}`) {
		return true;
	}

	const botToken = getEnv(platform, 'DISCORD_BOT_TOKEN');
	return Boolean(botToken) && authHeader === `Bot ${botToken}`;
}

export async function POST({ request, platform }) {
	if (!checkIsAutopilotRequest(request, platform)) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const db = (platform as any)?.env?.DB;
	if (!db) {
		return json({ error: 'Database not available' }, { status: 503 });
	}

	const queue = (platform as any)?.env?.AI_AUTOPILOT_QUEUE;
	const recovered = await recoverStaleRunningAIJobs(db);
	const pending = await getDuePendingAIJobs(db, 50);

	let queuedCount = 0;
	let queueErrors = 0;
	let deferredCount = 0;
	let cappedCount = 0;

	for (const job of pending) {
		if (!queue || typeof queue.send !== 'function') {
			break;
		}

		// Requeue policy (2026-07-24 Queues-limit incident): a job the watchdog
		// has already requeued MAX_WATCHDOG_REQUEUES times without progressing is
		// dead — fail it terminally instead of looping it forever. Below the cap,
		// every requeue pushes next_retry_at out exponentially so the same job
		// isn't re-enqueued by every 5-minute sweep (that loop is what burned the
		// 10k/day free-tier operations budget).
		const requeues = await countAIJobRequeues(db, job.id);
		if (requeues >= MAX_WATCHDOG_REQUEUES) {
			cappedCount += 1;
			await failAIJobTerminal(
				db,
				job.id,
				`Watchdog requeue budget exhausted (${requeues} requeues without progress)`
			);
			await appendAIJobEvent(db, job.id, {
				eventType: 'job.requeue_capped',
				source: 'autopilot_watchdog',
				step: 'sweep_requeue',
				message: 'Job failed terminally: watchdog requeue budget exhausted',
				metadata: { requeues },
			});
			continue;
		}

		try {
			await queue.send({
				type: 'ai_job_due',
				jobId: job.id,
				correlationId: job.correlation_id,
			});
			queuedCount += 1;
			const backoff = watchdogBackoffMinutes(requeues);
			const deferred = await deferAIJobRetry(db, job.id, backoff);
			if (deferred?.success) deferredCount += 1;
			await appendAIJobEvent(db, job.id, {
				eventType: 'job.requeued',
				source: 'autopilot_watchdog',
				step: 'sweep_requeue',
				message: 'Pending job was requeued by watchdog',
				metadata: { requeues: requeues + 1, next_retry_in_minutes: backoff },
			});
		} catch (err) {
			queueErrors += 1;
			// Back off failed enqueues too — when the queue itself is capped
			// (the exact incident scenario) hammering it every sweep only burns
			// more operations the moment the cap resets.
			await deferAIJobRetry(db, job.id, watchdogBackoffMinutes(requeues));
			await appendAIJobEvent(db, job.id, {
				eventType: 'job.requeue_failed',
				source: 'autopilot_watchdog',
				step: 'sweep_requeue',
				message: 'Watchdog failed to enqueue pending job',
				metadata: { error: err?.message || 'unknown' },
			});
		}
	}

	return json({
		ok: true,
		recovered,
		pendingDue: pending.length,
		queuedCount,
		deferredCount,
		cappedCount,
		queueErrors,
	});
}
