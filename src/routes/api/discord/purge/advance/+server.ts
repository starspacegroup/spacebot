import { json } from '@sveltejs/kit';
import { checkBearerAuth } from '$lib/server/superadmin-guard.js';
import { createDiscordApi } from '$lib/server/message-purge-discord.js';
import { runPurgeBatch, decidePurgeOutcome, type PurgeState } from '$lib/server/message-purge.js';
import { getMessagePurgeSettings, MAX_CONTINUATIONS } from '$lib/server/message-purge-settings.js';
import {
	enqueueMessagePurgeContinuation,
	type PurgeMeta,
} from '$lib/server/message-purge-queue.js';
import { log } from '$lib/log.js';

/**
 * POST /api/discord/purge/advance
 *
 * Runs at most one bounded batch of a message-purge sweep and returns the
 * advanced state. The orchestrator worker's MessagePurgeWorkflow drives a purge
 * by looping durable step.do() calls over this endpoint, sleeping `sleep_seconds`
 * between them. Keeping the Discord REST + reporting here means the bot token and
 * D1 stay on Pages; the worker only needs CRON_SECRET.
 *
 * Auth: Bearer CRON_SECRET / INTERNAL_API_KEY.
 * Body: { state: PurgeState, meta: { application_id, interaction_token, channel_id, command_name } }
 * 200:  { state, done, deleted_this_batch, sleep_seconds, note }
 */

function envValue(platform: unknown, name: string): string {
	const fromPlatform = (platform as { env?: Record<string, string> })?.env?.[name];
	if (fromPlatform) return fromPlatform;
	if (typeof process !== 'undefined' && process.env) return process.env[name] || '';
	return '';
}

/** Best-effort edit of the deferred interaction reply (valid ~15 min). */
async function editInteraction(
	botToken: string,
	meta: Partial<PurgeMeta>,
	content: string,
	fetchImpl: typeof fetch
) {
	if (!meta.application_id || !meta.interaction_token) return;
	try {
		await fetchImpl(
			`https://discord.com/api/v10/webhooks/${meta.application_id}/${meta.interaction_token}/messages/@original`,
			{
				method: 'PATCH',
				headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
				body: JSON.stringify({ content }),
			}
		);
	} catch (err) {
		log.debug('[Purge] interaction edit failed (likely token expiry):', err);
	}
}

/** Durable final report: a normal channel message, so it survives the 15-minute
 * interaction-token window that a long sweep can outlast. */
async function postChannelMessage(
	botToken: string,
	channelId: string | undefined,
	content: string,
	fetchImpl: typeof fetch
) {
	if (!channelId) return;
	try {
		await fetchImpl(`https://discord.com/api/v10/channels/${channelId}/messages`, {
			method: 'POST',
			headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ content }),
		});
	} catch (err) {
		log.error('[Purge] final channel message failed:', err);
	}
}

export async function POST({ request, platform, fetch }) {
	if (!checkBearerAuth(request, platform)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const botToken = envValue(platform, 'DISCORD_BOT_TOKEN');
	if (!botToken) return json({ error: 'Bot token unavailable' }, { status: 503 });

	const body = (await request.json().catch(() => ({}))) as {
		state?: PurgeState;
		meta?: Partial<PurgeMeta>;
		continuation?: number;
	};
	const state = body.state;
	const meta = body.meta ?? {};
	const continuation = Number(body.continuation) || 0;
	if (!state || !state.guild_id || !state.user_id) {
		return json({ error: 'Invalid purge state' }, { status: 400 });
	}

	const db = (platform as { env?: { DB?: unknown } })?.env?.DB;
	const { maxBatches, checkpointContinue } = await getMessagePurgeSettings(db);

	const api = createDiscordApi(botToken, fetch);
	const result = await runPurgeBatch(state, api);
	// Count this batch. `batches` is maintained here (not in the pure state
	// machine) and reset to 0 on each checkpoint continuation.
	const advanced: PurgeState = {
		...result.state,
		batches: (state.batches ?? 0) + 1,
	};

	const outcome = decidePurgeOutcome({
		done: result.done,
		batches: advanced.batches,
		maxBatches,
		checkpointContinue,
		continuation,
		maxContinuations: MAX_CONTINUATIONS,
	});

	if (outcome === 'complete') {
		const summary = `✅ ${result.note}`;
		await editInteraction(botToken, meta, summary, fetch);
		await postChannelMessage(botToken, meta.channel_id, summary, fetch);
		return respond(advanced, true, result.deletedThisBatch, 0, result.note);
	}

	if (outcome === 'checkpoint') {
		// Cap hit with checkpoint-continue on: hand a fresh run the saved cursor.
		const resumeState: PurgeState = { ...advanced, batches: 0 };
		const handedOff = await enqueueMessagePurgeContinuation(
			platform,
			resumeState,
			meta as PurgeMeta,
			continuation + 1
		);
		if (handedOff) {
			await editInteraction(
				botToken,
				meta,
				`🧹 Purging… ${advanced.deleted_total} deleted so far (continuing in the background)`,
				fetch
			);
			// Tell the current driver it's done; the continuation run takes over.
			return respond(advanced, true, result.deletedThisBatch, 0, 'checkpoint-continue');
		}
		// Enqueue failed → fall through to the stop-and-re-run report below.
	}

	if (outcome === 'stop_capped' || outcome === 'checkpoint') {
		const capNote =
			continuation >= MAX_CONTINUATIONS
				? `⏸️ Purge stopped after ${advanced.deleted_total} deleted (continuation limit reached). Run again to resume.`
				: `⏸️ Reached the scan limit — deleted ${advanced.deleted_total}. Run the command again to continue.`;
		await editInteraction(botToken, meta, capNote, fetch);
		await postChannelMessage(botToken, meta.channel_id, capNote, fetch);
		return respond(advanced, true, result.deletedThisBatch, 0, 'cap-reached');
	}

	// Normal progress.
	await editInteraction(
		botToken,
		meta,
		`🧹 Purging… ${advanced.deleted_total} deleted so far`,
		fetch
	);
	return respond(advanced, false, result.deletedThisBatch, result.sleepSeconds, result.note);
}

function respond(
	state: PurgeState,
	done: boolean,
	deletedThisBatch: number,
	sleepSeconds: number,
	note: string
) {
	return json({
		state,
		done,
		deleted_this_batch: deletedThisBatch,
		sleep_seconds: sleepSeconds,
		note,
	});
}
