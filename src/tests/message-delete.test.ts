import { describe, it, expect } from 'vitest';
import {
	deleteUserMessages,
	deleteMentionedMessages,
	deleteMessagesByUser,
} from '../lib/automation/message-delete.js';

/**
 * Minimal discord.js-shaped client double. Message ids are numeric strings
 * (larger = newer) so `before` pagination is a descending-id filter — matching
 * the real API's newest→oldest ordering.
 */
interface FakeMsg {
	id: string;
	authorId: string;
	createdTimestamp: number;
	pinned: boolean;
	mentions: string[];
}

function makeClient(channels: Record<string, FakeMsg[]>, opts: { voice?: string[] } = {}) {
	const voice = new Set(opts.voice ?? []);
	const store = new Map<string, FakeMsg[]>(
		Object.entries(channels).map(([id, msgs]) => [
			id,
			[...msgs].sort((a, b) => Number(b.id) - Number(a.id)),
		])
	);

	function wrap(channelId: string, m: FakeMsg) {
		return {
			id: m.id,
			author: { id: m.authorId },
			createdTimestamp: m.createdTimestamp,
			pinned: m.pinned,
			mentions: { has: (id: string) => m.mentions.includes(id) },
			delete: async () => {
				store.set(
					channelId,
					(store.get(channelId) ?? []).filter((x) => x.id !== m.id)
				);
			},
		};
	}

	function channelObj(channelId: string) {
		if (!store.has(channelId)) return null;
		return {
			id: channelId,
			name: channelId,
			isTextBased: () => !voice.has(channelId),
			isVoiceBased: () => voice.has(channelId),
			messages: {
				fetch: async (o: { limit: number; before?: string }) => {
					const all = store.get(channelId) ?? [];
					const before = o.before ? Number(o.before) : Infinity;
					const slice = all.filter((m) => Number(m.id) < before).slice(0, o.limit);
					const wrapped = slice.map((m) => wrap(channelId, m));
					const coll = new Map(wrapped.map((w) => [w.id, w]));
					return coll;
				},
			},
			bulkDelete: async (msgs: any[]) => {
				const ids = new Set(msgs.map((m) => m.id));
				store.set(
					channelId,
					(store.get(channelId) ?? []).filter((x) => !ids.has(x.id))
				);
			},
		};
	}

	return {
		store,
		guilds: {
			fetch: async () => ({
				channels: {
					fetch: async () => new Map([...store.keys()].map((id) => [id, channelObj(id)])),
				},
			}),
		},
		channels: { fetch: async (id: string) => channelObj(id) },
	};
}

const now = Date.now();
let seq = 500000;
function m(overrides: Partial<FakeMsg> = {}): FakeMsg {
	seq += 1;
	return {
		id: String(seq),
		authorId: 'other',
		createdTimestamp: now - 60_000,
		pinned: false,
		mentions: [],
		...overrides,
	};
}

describe('message-delete (shared engine/gateway logic)', () => {
	it('paginates past the first 100 messages for a user across ALL channels', async () => {
		const c1 = Array.from({ length: 250 }, (_, i) =>
			m({ authorId: i % 5 === 0 ? 'target' : 'other' })
		);
		const expected = c1.filter((x) => x.authorId === 'target').length;
		const client = makeClient({ c1 });

		const res = await deleteUserMessages(client, {
			guildId: 'g',
			channelIds: 'ALL',
			userId: 'target',
			maxMessages: null,
			maxAgeDays: null,
			skipPinned: true,
			maxScan: 100000,
			sleepMs: 0,
		});

		expect(res.totalDeleted).toBe(expected);
		expect(client.store.get('c1')!.some((x) => x.authorId === 'target')).toBe(false);
	});

	it('stops at the maxScan lookback ceiling', async () => {
		// 500 messages, all target; ceiling of 200 scanned = only first 200 examined.
		const c1 = Array.from({ length: 500 }, () => m({ authorId: 'target' }));
		const client = makeClient({ c1 });

		const res = await deleteUserMessages(client, {
			guildId: 'g',
			channelIds: 'c1',
			userId: 'target',
			maxMessages: null,
			maxAgeDays: null,
			skipPinned: false,
			maxScan: 200,
			sleepMs: 0,
		});

		expect(res.totalScanned).toBeLessThanOrEqual(200);
		expect(res.totalDeleted).toBe(200);
	});

	it('skips voice channels when resolving ALL', async () => {
		const client = makeClient(
			{ text1: [m({ authorId: 'target' })], voice1: [m({ authorId: 'target' })] },
			{ voice: ['voice1'] }
		);
		const res = await deleteUserMessages(client, {
			guildId: 'g',
			channelIds: 'ALL',
			userId: 'target',
			maxMessages: null,
			maxAgeDays: null,
			skipPinned: false,
			maxScan: 100000,
			sleepMs: 0,
		});
		expect(res.totalDeleted).toBe(1);
	});

	it('deletes messages mentioning a user (explicit channels required)', async () => {
		const client = makeClient({
			c1: [
				m({ authorId: 'x', mentions: ['target'] }),
				m({ authorId: 'x', mentions: ['other'] }),
			],
		});
		const res = await deleteMentionedMessages(client, {
			guildId: 'g',
			channelIds: 'c1',
			userId: 'target',
			limit: 100,
			maxScan: 100000,
			sleepMs: 0,
		});
		expect(res.totalDeleted).toBe(1);
	});

	it('rejects ALL for mentioned-messages', async () => {
		const client = makeClient({ c1: [] });
		await expect(
			deleteMentionedMessages(client, {
				guildId: 'g',
				channelIds: 'ALL',
				userId: 'target',
				limit: 100,
				maxScan: 100000,
			})
		).rejects.toThrow(/No channels specified/);
	});

	it('honours the per-run limit for DELETE_MESSAGES', async () => {
		const client = makeClient({
			c1: Array.from({ length: 40 }, () => m({ authorId: 'target' })),
			c2: Array.from({ length: 40 }, () => m({ authorId: 'target' })),
		});
		const res = await deleteMessagesByUser(client, {
			guildId: 'g',
			channelIds: 'c1,c2',
			userId: 'target',
			limit: 50,
			maxScan: 100000,
			sleepMs: 0,
		});
		expect(res.totalDeleted).toBe(50);
	});
});
