import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('discord-interactions', () => ({
	InteractionResponseType: {
		PONG: 1,
		CHANNEL_MESSAGE_WITH_SOURCE: 4,
		DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
	},
	InteractionType: { PING: 1, APPLICATION_COMMAND: 2, MESSAGE_COMPONENT: 3 },
	verifyKey: vi.fn(() => true),
}));

const h = vi.hoisted(() => ({ integrations: [] as any[], seen: [] as string[] }));
vi.mock('$lib/server/game.js', async (orig) => ({
	...(await orig<any>()),
	handleGameCommand: async (body: any) => {
		h.seen.push(`agent:${body.data.name}:${body.data.options[0].name}`);
		return { response: { type: 4, data: { content: 'agent' } } };
	},
}));
vi.mock('$lib/server/shiritori-game.js', async (orig) => ({
	...(await orig<any>()),
	handleShiritoriCommand: async (body: any) => {
		h.seen.push(`shiritori:${body.data.name}`);
		return { response: { type: 4, data: { content: 'shiritori' } } };
	},
}));
vi.mock('$lib/db/integrations.js', async (orig) => ({
	...(await orig<any>()),
	getEnabledGuildIntegrations: async () => h.integrations,
}));

const db = {
	prepare: () => ({
		bind: () => ({
			all: async () => ({ results: [] }),
			first: async () => null,
			run: async () => ({ meta: {} }),
		}),
	}),
};

async function post(name: string, subName: string) {
	const { POST } = await import('../routes/api/discord/interactions/+server.js');
	const request = new Request('http://localhost/api/discord/interactions', {
		method: 'POST',
		headers: { 'x-signature-ed25519': 's', 'x-signature-timestamp': '1' },
		body: JSON.stringify({
			type: 2,
			guild_id: '1009583217948491928',
			channel_id: 'c1',
			member: { user: { id: 'u1' }, permissions: '8' },
			data: { name, options: [{ type: 1, name: subName }] },
		}),
	});
	const res = await POST({
		request,
		platform: { env: { DISCORD_PUBLIC_KEY: '00', DB: db } },
	} as any);
	return res.json();
}

describe('/game and /play routing', () => {
	beforeEach(() => {
		h.seen = [];
		h.integrations = [];
	});

	it('sends /game and /play built-in subcommands to the same handlers', async () => {
		await post('game', 'start');
		await post('play', 'start');
		await post('game', 'shiritori');
		await post('play', 'shiritori');
		expect(h.seen).toEqual([
			'agent:game:start',
			'agent:game:start',
			'shiritori:game',
			'shiritori:game',
		]);
	});

	it('sends integration subcommands to the *Space Game integration', async () => {
		h.integrations = [
			{
				slug: 'starspace-game',
				name: '*Space Game',
				status: 'online',
				manifest: {
					homepage: 'https://game.example/',
					commands: [{ name: 'game', type: 1, options: [{ name: 'play', type: 1 }] }],
				},
			},
		];
		const r = await post('play', 'play');
		expect(r.data.content).toContain('https://game.example/');
		expect(h.seen).toEqual([]);
	});

	it('says so when an integration subcommand has no integration on', async () => {
		const r = await post('game', 'stats');
		expect(r.data.content).toBe("That game isn't on in this server.");
	});
});
