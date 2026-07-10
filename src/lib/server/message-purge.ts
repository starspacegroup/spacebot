/**
 * Durable message-purge state machine.
 *
 * Deleting a user's messages "across every channel" can be far more work than a
 * single Cloudflare request is allowed to do — each Discord REST call is a
 * subrequest, and Pages Functions cap those per invocation. This module models
 * the sweep as a *resumable* series of small batches so a durable driver (the
 * MessagePurgeWorkflow in the orchestrator worker) can run one bounded batch per
 * step, sleeping between them for rate-limit safety and surviving restarts.
 *
 * The state is fully serialisable so it can round-trip through the workflow
 * driver as plain JSON. All Discord I/O is injected via {@link DiscordApi} so
 * the batch logic is unit-testable without a network.
 */

/** Guild channel types that can hold user messages we might delete. */
const TEXT_CHANNEL_TYPES = new Set([
	0, // GUILD_TEXT
	5, // GUILD_ANNOUNCEMENT
	10, // ANNOUNCEMENT_THREAD
	11, // PUBLIC_THREAD
	12, // PRIVATE_THREAD
	15, // GUILD_FORUM
]);

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Upper bound on individual (>14-day) deletes performed in a single batch.
 * Recent messages are removed in one bulk-delete call regardless of count, so
 * this only limits the slow, per-message old-message path — keeping any one
 * batch well under the per-invocation subrequest ceiling and short enough that
 * the driver stays responsive.
 */
const MAX_OLD_DELETES_PER_BATCH = 30;

/** Messages fetched per page (Discord's hard maximum). */
const PAGE_SIZE = 100;

export type PurgeMode = 'user' | 'mentions';

/** The immutable description of what to purge — set once when the job starts. */
export interface PurgeDescriptor {
	guild_id: string;
	/** Whose messages (mode 'user') or whose mentions (mode 'mentions'). */
	user_id: string;
	mode: PurgeMode;
	/** 'ALL' for every text channel, or a comma-separated list of channel ids. */
	channel_ids: string;
	/** Only delete messages newer than this many days; null = no age limit. */
	max_age_days: number | null;
	/** Stop after deleting this many messages total; null = no cap. */
	max_messages: number | null;
	skip_pinned: boolean;
}

/** Mutable progress carried between batches. */
export interface PurgeProgress {
	/** Resolved channel ids to sweep; null until the first batch resolves them. */
	channels: string[] | null;
	/** Index of the channel currently being swept. */
	channel_index: number;
	/** Pagination cursor within the current channel (fetch messages before this). */
	before_id: string | null;
	deleted_total: number;
	scanned_total: number;
	/** Channels skipped because the bot lacked access / they vanished. */
	skipped_channels: number;
	/** Batches run so far — the advance driver increments and caps this. */
	batches: number;
	done: boolean;
}

export type PurgeState = PurgeDescriptor & PurgeProgress;

/** A message reduced to just the fields the purge decision needs. */
export interface PurgeMessage {
	id: string;
	authorId: string;
	/** Epoch milliseconds. */
	timestamp: number;
	pinned: boolean;
	/** User ids mentioned by the message. */
	mentionIds: string[];
}

export type FetchMessagesResult =
	| { messages: PurgeMessage[] }
	/** Channel is inaccessible or gone — skip it, don't retry. */
	| { skip: true }
	/** Rate limited — retry the same cursor after `retryAfter` seconds. */
	| { rateLimited: number };

export type DeleteResult = { ok: true } | { rateLimited: number };

/** Injected Discord REST surface. Real impl lives in message-purge-discord.ts. */
export interface DiscordApi {
	listGuildChannels(guildId: string): Promise<Array<{ id: string; type: number }>>;
	fetchMessages(
		channelId: string,
		opts: { limit: number; before?: string | null }
	): Promise<FetchMessagesResult>;
	/** Bulk-delete 2–100 recent (<14 day) message ids in one call. */
	bulkDelete(channelId: string, ids: string[]): Promise<DeleteResult>;
	deleteMessage(channelId: string, id: string): Promise<DeleteResult>;
}

export interface PurgeBatchResult {
	state: PurgeState;
	done: boolean;
	deletedThisBatch: number;
	/** How long the driver should sleep before the next batch. */
	sleepSeconds: number;
	/** Short human-readable status for progress reporting. */
	note: string;
}

/** Build the starting state for a fresh purge job. */
export function initialPurgeState(descriptor: PurgeDescriptor): PurgeState {
	return {
		...descriptor,
		channels: null,
		channel_index: 0,
		before_id: null,
		deleted_total: 0,
		scanned_total: 0,
		skipped_channels: 0,
		batches: 0,
		done: false,
	};
}

/**
 * What the advance driver should do after a batch, given the run's batch count
 * and the superadmin cap settings. Kept pure so the branching is unit-tested
 * independently of the endpoint's Discord/queue I/O.
 *
 * - `complete`: the sweep finished naturally.
 * - `checkpoint`: cap hit, checkpoint-continue on → re-enqueue a continuation.
 * - `stop_capped`: cap hit, no continuation → stop and invite a re-run.
 * - `continue`: under the cap → run another batch.
 */
export type PurgeOutcome = 'complete' | 'checkpoint' | 'stop_capped' | 'continue';

export function decidePurgeOutcome(params: {
	done: boolean;
	batches: number;
	maxBatches: number;
	checkpointContinue: boolean;
	continuation: number;
	maxContinuations: number;
}): PurgeOutcome {
	if (params.done) return 'complete';
	if (params.batches >= params.maxBatches) {
		if (params.checkpointContinue && params.continuation < params.maxContinuations) {
			return 'checkpoint';
		}
		return 'stop_capped';
	}
	return 'continue';
}

function cutoffTime(state: PurgeState): number | null {
	return state.max_age_days ? Date.now() - state.max_age_days * 24 * 60 * 60 * 1000 : null;
}

function matchesTarget(state: PurgeState, m: PurgeMessage): boolean {
	if (state.mode === 'mentions') return m.mentionIds.includes(state.user_id);
	return m.authorId === state.user_id;
}

/**
 * Run one bounded batch of the purge and return the advanced state.
 *
 * Progress guarantee: every non-rate-limited batch either advances the
 * pagination cursor (moving toward older messages / the next channel) or
 * deletes at least one message (shrinking the current window), so the sweep
 * always terminates. On a rate limit the state is returned unchanged with a
 * `sleepSeconds` hint and the driver simply retries the same cursor.
 */
export async function runPurgeBatch(state: PurgeState, api: DiscordApi): Promise<PurgeBatchResult> {
	// 1. Resolve the channel list on the first batch.
	if (state.channels === null) {
		let channels: string[];
		if (!state.channel_ids || state.channel_ids === 'ALL') {
			const all = await api.listGuildChannels(state.guild_id);
			channels = all.filter((c) => TEXT_CHANNEL_TYPES.has(c.type)).map((c) => c.id);
		} else {
			channels = state.channel_ids
				.split(',')
				.map((id) => id.trim())
				.filter(Boolean);
		}
		const next: PurgeState = { ...state, channels, channel_index: 0, before_id: null };
		return {
			state: next,
			done: channels.length === 0,
			deletedThisBatch: 0,
			sleepSeconds: 0,
			note: `Resolved ${channels.length} channel${channels.length === 1 ? '' : 's'} to sweep`,
		};
	}

	// 2. Terminal conditions.
	const quotaReached = state.max_messages !== null && state.deleted_total >= state.max_messages;
	if (quotaReached || state.channel_index >= state.channels.length) {
		return finished(state);
	}

	const channelId = state.channels[state.channel_index];

	// 3. Fetch one page of the current channel.
	const page = await api.fetchMessages(channelId, { limit: PAGE_SIZE, before: state.before_id });

	if ('rateLimited' in page) {
		return {
			state,
			done: false,
			deletedThisBatch: 0,
			sleepSeconds: Math.max(1, Math.ceil(page.rateLimited)),
			note: 'Rate limited while listing messages — waiting',
		};
	}

	if ('skip' in page) {
		// Inaccessible or deleted channel — move on.
		const next: PurgeState = {
			...state,
			channel_index: state.channel_index + 1,
			before_id: null,
			skipped_channels: state.skipped_channels + 1,
		};
		return advanceOrFinish(next, 0, `Skipped inaccessible channel ${channelId}`);
	}

	const messages = page.messages; // newest → oldest
	const scannedTotal = state.scanned_total + messages.length;
	const pageOldestId = messages.length > 0 ? messages[messages.length - 1].id : null;
	const cutoff = cutoffTime(state);
	const remainingQuota =
		state.max_messages !== null ? state.max_messages - state.deleted_total : Infinity;

	// 4. Select this page's deletable messages, honouring age / pinned / quota.
	const recent: PurgeMessage[] = [];
	const old: PurgeMessage[] = [];
	let reachedCutoff = false;
	const now = Date.now();
	for (const m of messages) {
		if (cutoff !== null && m.timestamp < cutoff) {
			// Messages are newest→oldest; everything past here is older still.
			reachedCutoff = true;
			break;
		}
		if (!matchesTarget(state, m)) continue;
		if (state.skip_pinned && m.pinned) continue;
		if (recent.length + old.length >= remainingQuota) break;
		if (now - m.timestamp < FOURTEEN_DAYS_MS) recent.push(m);
		else old.push(m);
	}

	let deleted = 0;
	let stoppedEarly = false; // hit a cap or rate limit mid-page → resume same cursor
	let rateLimitSleep = 0;

	// 4a. Recent messages: one bulk-delete call per 100 (single id falls back to
	// an individual delete, which is all bulk-delete allows).
	for (let i = 0; i < recent.length; i += 100) {
		const chunk = recent.slice(i, i + 100);
		const res =
			chunk.length === 1
				? await api.deleteMessage(channelId, chunk[0].id)
				: await api.bulkDelete(
						channelId,
						chunk.map((m) => m.id)
					);
		if ('rateLimited' in res) {
			stoppedEarly = true;
			rateLimitSleep = res.rateLimited;
			break;
		}
		deleted += chunk.length;
	}

	// 4b. Old messages: deleted individually, capped per batch so the driver can
	// pace them. Any remainder is picked up next batch (cursor stays put).
	if (!stoppedEarly) {
		const oldBudget = Math.min(old.length, MAX_OLD_DELETES_PER_BATCH);
		for (let i = 0; i < oldBudget; i += 1) {
			const res = await api.deleteMessage(channelId, old[i].id);
			if ('rateLimited' in res) {
				stoppedEarly = true;
				rateLimitSleep = res.rateLimited;
				break;
			}
			deleted += 1;
		}
		if (!stoppedEarly && old.length > MAX_OLD_DELETES_PER_BATCH) {
			stoppedEarly = true; // more old messages remain in this window
		}
	}

	const deletedTotal = state.deleted_total + deleted;
	const base: PurgeState = {
		...state,
		scanned_total: scannedTotal,
		deleted_total: deletedTotal,
	};

	// 5. Decide the cursor for the next batch.
	if (stoppedEarly) {
		// Leave before_id where it is; re-fetching the (now shorter) window resumes
		// on whatever we couldn't finish. Sleep if we were rate limited.
		return {
			state: base,
			done: false,
			deletedThisBatch: deleted,
			sleepSeconds: rateLimitSleep > 0 ? Math.max(1, Math.ceil(rateLimitSleep)) : 1,
			note: `Deleted ${deleted} in <#${channelId}> (more remaining)`,
		};
	}

	// Whole page handled. Advance the cursor; if the page was short or we crossed
	// the age cutoff, this channel is done.
	const channelExhausted = reachedCutoff || messages.length < PAGE_SIZE || pageOldestId === null;
	const next: PurgeState = channelExhausted
		? { ...base, channel_index: state.channel_index + 1, before_id: null }
		: { ...base, before_id: pageOldestId };

	return advanceOrFinish(next, deleted, `Deleted ${deleted} in <#${channelId}>`);
}

/** Wrap a state that may have run past the last channel into a done result. */
function advanceOrFinish(
	next: PurgeState,
	deletedThisBatch: number,
	note: string
): PurgeBatchResult {
	const quotaReached = next.max_messages !== null && next.deleted_total >= next.max_messages;
	if (quotaReached || next.channel_index >= (next.channels?.length ?? 0)) {
		return finished(next);
	}
	return { state: next, done: false, deletedThisBatch, sleepSeconds: 1, note };
}

function finished(state: PurgeState): PurgeBatchResult {
	return {
		state: { ...state, done: true },
		done: true,
		deletedThisBatch: 0,
		sleepSeconds: 0,
		note: `Done — deleted ${state.deleted_total} message${
			state.deleted_total === 1 ? '' : 's'
		}${state.skipped_channels ? `, skipped ${state.skipped_channels} channel(s)` : ''}`,
	};
}
