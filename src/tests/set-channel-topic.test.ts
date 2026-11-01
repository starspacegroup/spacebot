import { describe, expect, it, vi } from 'vitest';
import { executeAction } from '../lib/automation/engine.js';

const GUILD = '444444444444444444';
const OTHER = '555555555555555555';

function fake(guildId = GUILD, edit = vi.fn(async () => ({}))) {
	const channel = { id: '900', guild_id: guildId, edit };
	return { edit, client: { channels: { fetch: vi.fn(async () => channel) } } };
}

const run = (config: any, client: any, guild = GUILD, channel_id = '900') =>
	executeAction(
		{ id: 1, action_type: 'SET_CHANNEL_TOPIC', action_config: config },
		{ guild_id: guild, channel_id, event_type: 'slash_command', details: {} },
		{ user: {}, guild: { id: guild }, channel: {}, option: { text: 'Movie night' } },
		client
	);

describe('SET_CHANNEL_TOPIC', () => {
	it('sets the topic on the channel the command ran in', async () => {
		const { edit, client } = fake();
		const r = await run({ topic: 'Welcome, friends' }, client);
		expect(r.success).toBe(true);
		expect(edit).toHaveBeenCalledWith({ topic: 'Welcome, friends' }, expect.any(String));
	});

	it('cuts a topic to Discord’s 1024-character limit', async () => {
		const { edit, client } = fake();
		await run({ topic: 'x'.repeat(2000) }, client);
		expect((edit.mock.calls[0] as any)[0].topic).toHaveLength(1024);
	});

	it('refuses a channel that belongs to another server', async () => {
		const { edit, client } = fake(OTHER);
		const r = await run({ channel_id: '900', topic: 'hi' }, client);
		expect(r.success).toBe(false);
		expect(edit).not.toHaveBeenCalled();
	});

	it('says so plainly when Discord rate limits the change', async () => {
		const { client } = fake(
			GUILD,
			vi.fn(async () => Promise.reject(Object.assign(new Error('x'), { status: 429 })))
		);
		const r: any = await run({ topic: 'hi' }, client);
		expect(r.success).toBe(false);
		expect(r.error).toMatch(/two topic changes/);
	});

	it('says so plainly when the bot lacks permission', async () => {
		const { client } = fake(
			GUILD,
			vi.fn(async () =>
				Promise.reject(Object.assign(new Error('Missing Access'), { status: 403 }))
			)
		);
		const r: any = await run({ topic: 'hi' }, client);
		expect(r.error).toMatch(/Manage Channels/);
	});
});
