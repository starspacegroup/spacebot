import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/ai/chat.js', () => ({
	generateChatResponse: vi.fn(),
	isAIEnabled: () => true,
}));
vi.mock('$lib/discord/guilds.js', () => ({}));
vi.mock('$lib/server/workers-ai-models.js', () => ({
	resolveRuntimeModelConfig: async () => ({
		primaryModelId: 'm',
		candidateModelIds: [],
		routingStrategy: 'primary',
	}),
}));

import { POST } from '../routes/api/chat/+server.js';

const platform = { env: { ADMIN_USER_IDS: 'admin1', DB: {} } };

function event(body: string) {
	return {
		request: new Request('http://localhost/api/chat', { method: 'POST', body }),
		cookies: { get: (n: string) => (n === 'discord_user_id' ? 'admin1' : undefined) },
		platform,
	} as any;
}

describe('/api/chat request body', () => {
	for (const bad of ['', 'not json', 'null', '7']) {
		it(`POST answers 400 for body ${JSON.stringify(bad)}`, async () => {
			const res = await POST(event(bad));
			expect(res.status).toBe(400);
		});
	}

	it('POST still answers 400 for an object with no message', async () => {
		const res = await POST(event('{}'));
		expect(res.status).toBe(400);
	});
});
