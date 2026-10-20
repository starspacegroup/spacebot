import { afterEach, describe, expect, it, vi } from 'vitest';
import { channelBelongsToGuild, fetchGuildChannel } from '../lib/automation/channel-scope.js';
import { executeAction } from '../lib/automation/engine.js';
import { purgeMessages } from '../lib/automation/message-delete.js';
import { processScheduledMessages } from '../lib/db/scheduled-messages.js';

const HOME = '444444444444444444';
const VICTIM = '555555555555555555';
const FOREIGN_CHANNEL = '900000000000000001';

function fakeDiscord() {
	const send = vi.fn(async () => ({ id: 'm1' }));
	const startThread = vi.fn();
	const channel = {
		id: FOREIGN_CHANNEL,
		guild_id: VICTIM,
		send,
		threads: { create: startThread },
		messages: { fetch: vi.fn(async () => new Map()) },
		bulkDelete: vi.fn(),
		isTextBased: () => true,
	};
	return {
		send,
		startThread,
		client: {
			channels: { fetch: vi.fn(async () => channel) },
			guilds: { fetch: vi.fn(async () => ({ id: HOME, channels: { fetch: vi.fn() } })) },
		},
	};
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchGuildChannel', () => {
	it('returns null for a channel owned by another guild', async () => {
		const { client } = fakeDiscord();
		expect(await fetchGuildChannel(client, FOREIGN_CHANNEL, HOME)).toBeNull();
		expect(await fetchGuildChannel(client, FOREIGN_CHANNEL, VICTIM)).not.toBeNull();
		expect(await fetchGuildChannel(client, FOREIGN_CHANNEL, null)).toBeNull();
	});
});

describe('automation actions refuse foreign-guild channels', () => {
	it.each([
		['SEND_MESSAGE', { channel_id: FOREIGN_CHANNEL, content: 'hi' }],
		['LOG_TO_CHANNEL', { channel_id: FOREIGN_CHANNEL }],
		['CREATE_THREAD', { channel_id: FOREIGN_CHANNEL, thread_name: 't' }],
	])('%s', async (action_type, action_config) => {
		const { client, send } = fakeDiscord();
		const result = await executeAction(
			{ id: 1, action_type, action_config },
			{ guild_id: HOME, event_type: 'member_join', details: {} },
			{ user: {}, guild: { id: HOME }, channel: {} },
			client
		);
		expect(result.success).toBe(false);
		expect(send).not.toHaveBeenCalled();
	});
});

it('control: the same SEND_MESSAGE in the owning guild is sent', async () => {
	const { client, send } = fakeDiscord();
	const result = await executeAction(
		{
			id: 1,
			action_type: 'SEND_MESSAGE',
			action_config: { channel_id: FOREIGN_CHANNEL, content: 'hi' },
		},
		{ guild_id: VICTIM, event_type: 'member_join', details: {} },
		{ user: {}, guild: { id: VICTIM }, channel: {} },
		client
	);
	expect(result.success).toBe(true);
	expect(send).toHaveBeenCalled();
});

describe('message delete stays inside its guild', () => {
	it('skips an explicit channel from another guild', async () => {
		const { client } = fakeDiscord();
		const result: any = await purgeMessages(client, {
			guildId: HOME,
			channelIds: FOREIGN_CHANNEL,
			match: () => true,
			maxScan: 100,
			sleepMs: 0,
		} as any);
		expect(result.channelResults[FOREIGN_CHANNEL].error).toMatch(/not found/i);
	});
});

describe('deferred scheduled messages revalidate the channel', () => {
	it('fails a message whose channel moved to another guild', async () => {
		const fetchMock = vi.fn(async (url: string) =>
			url.endsWith(`/channels/${FOREIGN_CHANNEL}`)
				? new Response(JSON.stringify({ id: FOREIGN_CHANNEL, guild_id: VICTIM }))
				: new Response('{}')
		);
		vi.stubGlobal('fetch', fetchMock);
		const run = vi.fn(async () => ({ meta: { changes: 1 } }));
		const db = {
			prepare: () => ({
				bind: () => ({
					all: async () => ({
						results: [
							{
								id: 1,
								guild_id: HOME,
								channel_id: FOREIGN_CHANNEL,
								action_type: 'SEND_MESSAGE',
								message_payload: '{"content":"x"}',
							},
						],
					}),
					run,
				}),
				all: async () => ({ results: [] }),
			}),
		};
		const result = await processScheduledMessages(db, 'bot');
		expect(result.failed).toBe(1);
		expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/messages'))).toBe(false);
	});

	it('channelBelongsToGuild compares the owning guild', async () => {
		const f: any = vi.fn(async () => new Response(JSON.stringify({ guild_id: HOME })));
		expect(await channelBelongsToGuild('t', FOREIGN_CHANNEL, HOME, f)).toBe(true);
		expect(await channelBelongsToGuild('t', FOREIGN_CHANNEL, VICTIM, f)).toBe(false);
	});
});
