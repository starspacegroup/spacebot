import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildGuildChannels, createDiscordRestClient } from '../lib/discord/rest-client.js';

/**
 * `/room create` failed in production with "channels.create is not a function":
 * the interactions endpoint builds its own discord.js-shaped client, and that
 * client's guild wrapper only had `fetch`. The create path now comes from
 * `buildGuildChannels`, so both clients share one implementation.
 */
describe('buildGuildChannels', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function stubFetch(body: any = { id: '999' }) {
		const calls: any[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init: any) => {
				calls.push({ url, init });
				return {
					ok: true,
					status: 200,
					headers: new Headers({ 'content-type': 'application/json' }),
					json: async () => body,
					text: async () => JSON.stringify(body),
				} as any;
			})
		);
		return calls;
	}

	it('POSTs a channel with the overwrites applied at creation', async () => {
		const calls = stubFetch({ id: '555', name: 'davids-room' });

		const created = await buildGuildChannels('token', '100').create({
			name: 'davids-room',
			type: 2,
			parent: '42',
			userLimit: 5,
			permissionOverwrites: [{ id: '100', type: 0, allow: '0', deny: '1024' }],
			reason: 'Room created by David',
		});

		expect(created).toEqual({ id: '555', name: 'davids-room' });

		const call = calls.at(-1);
		expect(call.url).toContain('/guilds/100/channels');
		expect(call.init.method).toBe('POST');

		const body = JSON.parse(call.init.body);
		expect(body).toMatchObject({
			name: 'davids-room',
			type: 2,
			parent_id: '42',
			user_limit: 5,
			permission_overwrites: [{ id: '100', type: 0, allow: '0', deny: '1024' }],
		});
		// An unset option must not be sent as null — the preset default wins.
		expect(body).not.toHaveProperty('topic');
		expect(call.init.headers['X-Audit-Log-Reason']).toBe('Room created by David');
	});

	it('gives every managed-channel verb a method to call', async () => {
		stubFetch({ id: '100', name: 'guild' });
		const client = createDiscordRestClient('token');

		expect(typeof client.channels.edit).toBe('function');
		expect(typeof client.channels.delete).toBe('function');
		expect(typeof client.channels.permissions('555').set).toBe('function');

		const guild = await client.guilds.fetch('100');
		expect(typeof guild.channels.create).toBe('function');
		expect(typeof guild.channels.fetch).toBe('function');
	});
});
