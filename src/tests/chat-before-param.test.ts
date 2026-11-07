import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$lib/server/superadmin-guard.js', () => ({ checkIsSuperAdmin: () => true }));
vi.mock('$lib/db/logger.js', () => ({
	log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('$lib/ai/chat.js', () => ({ generateChatResponse: vi.fn(), isAIEnabled: vi.fn() }));
vi.mock('$lib/discord/guilds.js', () => ({
	filterAdminGuilds: vi.fn(),
	getUserGuilds: vi.fn(),
	getBotGuildIds: vi.fn(),
}));
vi.mock('$lib/server/workers-ai-models.js', () => ({ resolveRuntimeModelConfig: vi.fn() }));

import { GET } from '../routes/api/chat/+server';

const calls: string[] = [];

beforeEach(() => {
	calls.length = 0;
	vi.stubGlobal(
		'fetch',
		vi.fn(async (u: string) => {
			calls.push(String(u));
			return String(u).endsWith('/users/@me/channels')
				? new Response(JSON.stringify({ id: 'c1' }), { status: 200 })
				: new Response('[]', { status: 200 });
		})
	);
});
afterEach(() => vi.unstubAllGlobals());

async function run(query: string) {
	await GET({
		cookies: { get: () => '42' },
		platform: { env: { DISCORD_BOT_TOKEN: 't' } },
		url: new URL(`http://x/api/chat?${query}`),
	} as never);
	return calls.find((c) => c.includes('/messages')) ?? '';
}

describe('GET /api/chat ?before=', () => {
	it('passes a snowflake through', async () => {
		expect(await run('before=123456789012345678')).toContain('&before=123456789012345678');
	});
	it('drops a value that would add its own query parameters', async () => {
		const u = await run('before=1%26limit%3D100');
		expect(u).not.toContain('before=');
		expect(u.match(/limit=/g)).toHaveLength(1);
	});
});
