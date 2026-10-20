import { describe, expect, it, vi } from 'vitest';
import { authorizeToolCall, buildToolAuthzContext } from '../lib/ai/tool-authz.js';

const MINE = '444444444444444444';
const THEIRS = '555555555555555555';
const CHANNEL = '900000000000000001';

const GUILD_TOOLS = [
	'get_event_logs',
	'get_automations',
	'get_commands',
	'get_server_settings',
	'get_text_channels',
	'get_user_roles',
	'create_scheduled_event',
	'update_scheduled_event',
	'confirm_scheduled_event',
	'send_channel_message',
];

const user = buildToolAuthzContext({
	isSuperAdmin: false,
	managedGuilds: [{ id: MINE }],
	botToken: 'bot',
});

describe('authorizeToolCall', () => {
	it.each(GUILD_TOOLS)('%s on a guild outside the allowlist is refused', async (tool) => {
		const res = await authorizeToolCall(tool, { guildId: THEIRS }, user);
		expect(res.ok).toBe(false);
	});

	it.each(GUILD_TOOLS)('%s without a guildId is refused', async (tool) => {
		expect((await authorizeToolCall(tool, {}, user)).ok).toBe(false);
	});

	it('allows a guild tool on a managed guild', async () => {
		expect((await authorizeToolCall('get_automations', { guildId: MINE }, user)).ok).toBe(true);
	});

	it('list_guilds is superadmin-only', async () => {
		expect((await authorizeToolCall('list_guilds', {}, user)).ok).toBe(false);
		const sa = buildToolAuthzContext({ isSuperAdmin: true, managedGuilds: [] });
		expect((await authorizeToolCall('list_guilds', {}, sa)).ok).toBe(true);
	});

	it('session-user tools are always allowed (userId is pinned elsewhere)', async () => {
		expect((await authorizeToolCall('list_local_runners', {}, user)).ok).toBe(true);
	});

	it('a channel from another guild is refused even with a managed guildId', async () => {
		const fetchImpl: any = vi.fn(
			async () => new Response(JSON.stringify({ guild_id: THEIRS }))
		);
		const res = await authorizeToolCall(
			'send_channel_message',
			{ guildId: MINE, channelId: CHANNEL, content: 'x' },
			{ ...user, fetchImpl }
		);
		expect(res.ok).toBe(false);
	});

	it('a channel in the managed guild is allowed', async () => {
		const fetchImpl: any = vi.fn(async () => new Response(JSON.stringify({ guild_id: MINE })));
		const res = await authorizeToolCall(
			'send_channel_message',
			{ guildId: MINE, channelId: CHANNEL, content: 'x' },
			{ ...user, fetchImpl }
		);
		expect(res.ok).toBe(true);
	});

	it('an empty context fails closed', async () => {
		const none = buildToolAuthzContext({ isSuperAdmin: false, managedGuilds: undefined });
		expect((await authorizeToolCall('get_automations', { guildId: MINE }, none)).ok).toBe(
			false
		);
	});
});
