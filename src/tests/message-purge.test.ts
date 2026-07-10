import { describe, it, expect } from 'vitest';
import {
	initialPurgeState,
	runPurgeBatch,
	decidePurgeOutcome,
	type DiscordApi,
	type PurgeDescriptor,
	type PurgeMessage,
	type PurgeState,
} from '../lib/server/message-purge.js';

/**
 * In-memory Discord double. Message ids are numeric strings; larger = newer, so
 * `before` pagination is a simple descending-id filter — the same ordering the
 * real API guarantees.
 */
class FakeDiscord implements DiscordApi {
	channels = new Map<string, PurgeMessage[]>();
	/** Optional: queue of rate-limit hits keyed by "op" to exercise resume. */
	private rateLimitOnce = new Set<string>();

	addChannel(id: string, messages: PurgeMessage[]) {
		// Store newest → oldest.
		this.channels.set(
			id,
			[...messages].sort((a, b) => Number(b.id) - Number(a.id))
		);
	}

	rateLimitNext(op: string) {
		this.rateLimitOnce.add(op);
	}

	async listGuildChannels() {
		return [...this.channels.keys()].map((id) => ({ id, type: 0 }));
	}

	async fetchMessages(channelId: string, opts: { limit: number; before?: string | null }) {
		if (this.rateLimitOnce.delete(`fetch:${channelId}`)) return { rateLimited: 1 } as const;
		const all = this.channels.get(channelId);
		if (!all) return { skip: true } as const;
		const before = opts.before ? Number(opts.before) : Infinity;
		const messages = all.filter((m) => Number(m.id) < before).slice(0, opts.limit);
		return { messages } as const;
	}

	private remove(channelId: string, ids: string[]) {
		const set = new Set(ids);
		const remaining = (this.channels.get(channelId) ?? []).filter((m) => !set.has(m.id));
		this.channels.set(channelId, remaining);
	}

	async bulkDelete(channelId: string, ids: string[]) {
		if (this.rateLimitOnce.delete(`bulk:${channelId}`)) return { rateLimited: 1 } as const;
		this.remove(channelId, ids);
		return { ok: true } as const;
	}

	async deleteMessage(channelId: string, id: string) {
		if (this.rateLimitOnce.delete(`del:${channelId}`)) return { rateLimited: 1 } as const;
		this.remove(channelId, [id]);
		return { ok: true } as const;
	}
}

/** Drive a purge to completion, returning the final state. */
async function runToCompletion(state: PurgeState, api: DiscordApi, maxBatches = 500) {
	let current = state;
	for (let i = 0; i < maxBatches; i += 1) {
		const res = await runPurgeBatch(current, api);
		current = res.state;
		if (res.done) return current;
	}
	throw new Error('purge did not complete within batch budget');
}

const now = Date.now();
let seq = 1_000_000;
function msg(overrides: Partial<PurgeMessage> = {}): PurgeMessage {
	seq += 1;
	return {
		id: String(seq),
		authorId: 'other',
		timestamp: now - 60_000, // recent by default (< 14 days)
		pinned: false,
		mentionIds: [],
		...overrides,
	};
}

const baseDescriptor: PurgeDescriptor = {
	guild_id: 'g1',
	user_id: 'target',
	mode: 'user',
	channel_ids: 'ALL',
	max_age_days: null,
	max_messages: null,
	skip_pinned: true,
};

describe('runPurgeBatch', () => {
	it('deletes the user’s messages beyond the first 100-message page', async () => {
		const api = new FakeDiscord();
		// 250 messages, every 4th from the target → 63 to delete, spread across 3 pages.
		const messages = Array.from({ length: 250 }, (_, i) =>
			msg({ authorId: i % 4 === 0 ? 'target' : 'other' })
		);
		const expected = messages.filter((m) => m.authorId === 'target').length;
		api.addChannel('c1', messages);

		const state = initialPurgeState({ ...baseDescriptor, channel_ids: 'c1' });
		const final = await runToCompletion(state, api);

		expect(final.deleted_total).toBe(expected);
		expect(api.channels.get('c1')!.some((m) => m.authorId === 'target')).toBe(false);
	});

	it('stops at max_messages', async () => {
		const api = new FakeDiscord();
		api.addChannel(
			'c1',
			Array.from({ length: 300 }, () => msg({ authorId: 'target' }))
		);
		const state = initialPurgeState({
			...baseDescriptor,
			channel_ids: 'c1',
			max_messages: 42,
		});
		const final = await runToCompletion(state, api);
		expect(final.deleted_total).toBe(42);
		expect(api.channels.get('c1')!.length).toBe(258);
	});

	it('respects max_age_days (stops at the cutoff)', async () => {
		const api = new FakeDiscord();
		const day = 24 * 60 * 60 * 1000;
		// Snowflake ids increase with time, so create the older messages first
		// (lower seq) and the recent ones second (higher seq) — the recent target
		// messages then sort newest and the 40-day-old ones fall past the cutoff.
		const old = Array.from({ length: 20 }, () =>
			msg({ authorId: 'target', timestamp: now - 40 * day })
		);
		const recent = Array.from({ length: 5 }, () =>
			msg({ authorId: 'target', timestamp: now - day })
		);
		api.addChannel('c1', [...old, ...recent]);

		const state = initialPurgeState({
			...baseDescriptor,
			channel_ids: 'c1',
			max_age_days: 7,
		});
		const final = await runToCompletion(state, api);
		expect(final.deleted_total).toBe(5);
	});

	it('skips pinned messages when skip_pinned is set', async () => {
		const api = new FakeDiscord();
		api.addChannel('c1', [
			msg({ authorId: 'target', pinned: true }),
			msg({ authorId: 'target' }),
			msg({ authorId: 'target' }),
		]);
		const state = initialPurgeState({ ...baseDescriptor, channel_ids: 'c1' });
		const final = await runToCompletion(state, api);
		expect(final.deleted_total).toBe(2);
		expect(api.channels.get('c1')!.filter((m) => m.pinned).length).toBe(1);
	});

	it('deletes messages mentioning the user in mentions mode', async () => {
		const api = new FakeDiscord();
		api.addChannel('c1', [
			msg({ authorId: 'someone', mentionIds: ['target'] }),
			msg({ authorId: 'someone', mentionIds: ['other'] }),
			msg({ authorId: 'someone', mentionIds: ['target', 'x'] }),
		]);
		const state = initialPurgeState({
			...baseDescriptor,
			channel_ids: 'c1',
			mode: 'mentions',
		});
		const final = await runToCompletion(state, api);
		expect(final.deleted_total).toBe(2);
	});

	it('sweeps every channel for ALL', async () => {
		const api = new FakeDiscord();
		api.addChannel(
			'c1',
			Array.from({ length: 10 }, () => msg({ authorId: 'target' }))
		);
		api.addChannel(
			'c2',
			Array.from({ length: 7 }, () => msg({ authorId: 'target' }))
		);
		api.addChannel('c3', [msg({ authorId: 'other' })]);
		const state = initialPurgeState(baseDescriptor);
		const final = await runToCompletion(state, api);
		expect(final.deleted_total).toBe(17);
	});

	it('resumes correctly after a rate limit on delete', async () => {
		const api = new FakeDiscord();
		// Use old messages so they go through the individual-delete path.
		const day = 24 * 60 * 60 * 1000;
		api.addChannel(
			'c1',
			Array.from({ length: 5 }, () => msg({ authorId: 'target', timestamp: now - 30 * day }))
		);
		api.rateLimitNext('del:c1');
		const state = initialPurgeState({ ...baseDescriptor, channel_ids: 'c1' });
		const final = await runToCompletion(state, api);
		expect(final.deleted_total).toBe(5);
		expect(api.channels.get('c1')!.length).toBe(0);
	});

	it('starts with a zeroed batch counter', () => {
		expect(initialPurgeState(baseDescriptor).batches).toBe(0);
	});
});

describe('decidePurgeOutcome', () => {
	const cfg = {
		batches: 5,
		maxBatches: 33,
		checkpointContinue: false,
		continuation: 0,
		maxContinuations: 100,
	};

	it('completes when the sweep is done, regardless of batch count', () => {
		expect(decidePurgeOutcome({ ...cfg, done: true, batches: 999 })).toBe('complete');
	});

	it('continues while under the cap', () => {
		expect(decidePurgeOutcome({ ...cfg, done: false, batches: 32 })).toBe('continue');
	});

	it('stops at the cap when checkpoint-continue is off', () => {
		expect(decidePurgeOutcome({ ...cfg, done: false, batches: 33 })).toBe('stop_capped');
	});

	it('checkpoints at the cap when checkpoint-continue is on', () => {
		expect(
			decidePurgeOutcome({ ...cfg, done: false, batches: 33, checkpointContinue: true })
		).toBe('checkpoint');
	});

	it('stops instead of checkpointing once the continuation limit is reached', () => {
		expect(
			decidePurgeOutcome({
				...cfg,
				done: false,
				batches: 33,
				checkpointContinue: true,
				continuation: 100,
				maxContinuations: 100,
			})
		).toBe('stop_capped');
	});
});
