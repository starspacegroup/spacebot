import { describe, it, expect, vi } from 'vitest';
import { matchesFilters, executeAction } from '../lib/automation/engine.js';
import { ACTION_TYPES, FILTER_TYPES } from '../lib/db/automations.js';

/** A MESSAGE_CREATE event as the gateway builds it. */
function messageEvent(details: any = {}) {
	return {
		guild_id: '111',
		event_type: 'MESSAGE_CREATE',
		actor_id: '222',
		channel_id: '333',
		details: {
			messageId: '444',
			content: 'hello',
			isBot: false,
			isOwnBot: false,
			...details,
		},
	};
}

describe('own-bot loop guard', () => {
	it("skips SpaceBot's own messages when the automation has no filters", () => {
		expect(matchesFilters(messageEvent({ isOwnBot: true, isBot: true }), {})).toBe(false);
	});

	it('skips own messages even when every other filter matches', () => {
		const event = messageEvent({ isOwnBot: true, isBot: true, content: 'no suffix here' });
		const filters = { channel_id: '333', content_contains: 'suffix' };

		// Sanity: the same filters match when the author is not our bot.
		expect(matchesFilters(messageEvent({ content: 'no suffix here' }), filters)).toBe(true);
		expect(matchesFilters(event, filters)).toBe(false);
	});

	it('lets own messages through when the automation opts in', () => {
		const event = messageEvent({ isOwnBot: true, isBot: true });
		expect(matchesFilters(event, { own_bot_messages: 'include' })).toBe(true);
		expect(matchesFilters(event, { own_bot_messages: 'include', channel_id: '333' })).toBe(
			true
		);
	});

	it('treats an explicit skip the same as the default', () => {
		const event = messageEvent({ isOwnBot: true, isBot: true });
		expect(matchesFilters(event, { own_bot_messages: 'skip' })).toBe(false);
	});

	it('does not affect other bots, humans, or non-message events', () => {
		// Another bot's message is still subject only to bot_filter.
		expect(matchesFilters(messageEvent({ isBot: true }), {})).toBe(true);
		expect(matchesFilters(messageEvent(), {})).toBe(true);
		expect(
			matchesFilters({ guild_id: '111', event_type: 'MEMBER_JOIN', actor_id: '222' }, {})
		).toBe(true);
	});

	it('exposes the opt-in as a message-event filter', () => {
		expect(FILTER_TYPES.own_bot_messages.default).toBe('skip');
		expect(FILTER_TYPES.own_bot_messages.applicableEvents).toContain('MESSAGE_');
	});
});

describe('SEND_MESSAGE channel_source', () => {
	function fakeDiscord() {
		const send = vi.fn(async () => ({ id: '999' }));
		return {
			send,
			discord: {
				channels: {
					fetch: vi.fn(async (id: string) => ({ id, send })),
				},
			},
		};
	}

	const run = (action_config: any, event: any, discord: any) =>
		executeAction(
			{ id: 1, action_type: 'SEND_MESSAGE', action_config },
			event,
			{},
			discord,
			null
		);

	it('sends to the triggering channel when channel_source is "trigger"', async () => {
		const { discord, send } = fakeDiscord();
		const result = await run(
			{ channel_source: 'trigger', content: 'pong' },
			messageEvent(),
			discord
		);

		expect(result.success).toBe(true);
		expect(discord.channels.fetch).toHaveBeenCalledWith('333');
		expect(send).toHaveBeenCalled();
	});

	it('ignores a configured channel_id when using the trigger channel', async () => {
		const { discord } = fakeDiscord();
		await run(
			{ channel_source: 'trigger', channel_id: '888', content: 'pong' },
			messageEvent(),
			discord
		);

		expect(discord.channels.fetch).toHaveBeenCalledWith('333');
	});

	it('still uses the configured channel by default', async () => {
		const { discord } = fakeDiscord();
		await run({ channel_id: '888', content: 'pong' }, messageEvent(), discord);

		expect(discord.channels.fetch).toHaveBeenCalledWith('888');
	});

	it('errors clearly when the event has no channel to reply in', async () => {
		const { discord } = fakeDiscord();
		const result = await run(
			{ channel_source: 'trigger', content: 'pong' },
			{ guild_id: '111', event_type: 'MEMBER_JOIN', actor_id: '222' },
			discord
		);

		expect(result.success).toBe(false);
		expect(result.error).toBe('No trigger channel available for this event');
		expect(discord.channels.fetch).not.toHaveBeenCalled();
	});

	it('offers the trigger option in the builder schema', () => {
		const values = ACTION_TYPES.SEND_MESSAGE.configSchema.channel_source.options.map(
			(o: any) => o.value
		);
		expect(values).toEqual(['configured', 'trigger']);
		expect(ACTION_TYPES.SEND_MESSAGE.configSchema.channel_source.default).toBe('configured');
	});
});
