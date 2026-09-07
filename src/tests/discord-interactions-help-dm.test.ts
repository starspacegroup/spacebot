import { describe, expect, it, vi } from 'vitest';

vi.mock('discord-interactions', () => ({
	InteractionResponseType: {
		PONG: 1,
		CHANNEL_MESSAGE_WITH_SOURCE: 4,
		DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
	},
	InteractionType: {
		PING: 1,
		APPLICATION_COMMAND: 2,
		MESSAGE_COMPONENT: 3,
	},
	verifyKey: vi.fn(() => true),
}));

/** A D1 stand-in that answers the built-in command query and nothing else. */
function fakeDb(rows: any[]) {
	return {
		prepare: () => ({
			bind: () => ({
				all: async () => ({ results: rows }),
				first: async () => rows[0] ?? null,
				run: async () => ({ meta: {} }),
			}),
		}),
	};
}

async function postHelp(env: Record<string, any>) {
	const { POST } = await import('../routes/api/discord/interactions/+server.js');

	const request = new Request('http://localhost/api/discord/interactions', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'x-signature-ed25519': 'test-signature',
			'x-signature-timestamp': '1234567890',
		},
		body: JSON.stringify({
			type: 2,
			data: { name: 'help' },
			token: 'interaction-token',
			application_id: 'app-1',
			channel_id: 'dm-1',
			user: { id: 'user-1', username: 'davis' },
		}),
	});

	return POST({ request, platform: { env } } as any);
}

describe('discord interactions DM help', () => {
	it('lists the built-ins Discord will deliver in a DM', async () => {
		const response = await postHelp({
			DISCORD_PUBLIC_KEY: '00',
			DB: fakeDb([
				{
					id: 1,
					name: 'help',
					description: 'List the commands you can use here',
					dm_permission: 1,
				},
				{
					id: 2,
					name: 'ping',
					description: 'Check if the bot is responsive',
					dm_permission: 1,
				},
				// Guild-only: a DM cannot run it, so help must not offer it.
				{ id: 3, name: 'stats', description: 'Show server stats', dm_permission: 0 },
			]),
		});

		expect(response.status).toBe(200);

		const payload = await response.json();
		expect(payload.type).toBe(4);

		const names = payload.data?.embeds?.[0]?.fields?.map((f: any) => f.name);
		expect(names).toEqual(['/help', '/ping']);
	});

	it('replies only to the caller', async () => {
		const response = await postHelp({ DISCORD_PUBLIC_KEY: '00', DB: fakeDb([]) });
		const payload = await response.json();

		// 64 = EPHEMERAL. Asking what a bot does should not need an audience.
		expect(payload.data?.flags).toBe(64);
	});

	it('still answers when the database is unavailable', async () => {
		// Somebody typing /help is already looking for a way in; an error with no
		// content is a worse dead end than a short message.
		const response = await postHelp({ DISCORD_PUBLIC_KEY: '00' });
		const payload = await response.json();

		expect(response.status).toBe(200);
		expect(payload.data?.embeds?.[0]?.description).toMatch(/unavailable/i);
	});
});
