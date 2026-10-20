import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';

const GUILD = '444444444444444444';
let guildConfig: any = {};
const processAutomations = vi.fn();

vi.mock('$lib/db/logger.js', () => ({
	log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
	logEvent: vi.fn(),
}));
vi.mock('$lib/db/integrations.js', () => ({
	getIntegrationBySlug: vi.fn(async () => ({ id: 1 })),
	getGuildsWithIntegrationConfig: vi.fn(async () => [{ guild_id: GUILD, config: guildConfig }]),
}));
vi.mock('$lib/integrations/registry.js', () => ({ seedBuiltInIntegrations: vi.fn() }));
vi.mock('$lib/automation/engine.js', () => ({ processAutomations }));
vi.mock('$lib/discord/rest-client.js', () => ({ createDiscordRestClient: vi.fn(() => ({})) }));
vi.mock('$lib/db/server-stats.js', () => ({ getLatestServerStats: vi.fn() }));
vi.mock('$lib/db/guild-metadata.js', () => ({ getGuildMetadata: vi.fn() }));

const PUSH = JSON.stringify({
	ref: 'refs/heads/main',
	repository: { full_name: 'a/b', html_url: 'https://github.com/a/b' },
	sender: { login: 'x' },
	commits: [],
	pusher: { name: 'x' },
});

async function send(event: string, body: string, signature?: string) {
	const { POST }: any =
		await import('../routes/api/v1/integrations/github/webhook/[guildId]/+server.js');
	const headers: Record<string, string> = { 'X-GitHub-Event': event };
	if (signature) headers['X-Hub-Signature-256'] = signature;
	return POST({
		params: { guildId: GUILD },
		request: new Request('http://x/', { method: 'POST', body, headers }),
		platform: { env: { DB: {} } },
	});
}

afterEach(() => processAutomations.mockReset());

describe('GitHub webhook authenticity', () => {
	it.each([{}, { webhook_secret: '' }, { webhook_secret: null }])(
		'rejects events when the secret is %j',
		async (config) => {
			guildConfig = config;
			const res = await send('push', PUSH);
			expect(res.status).toBe(401);
			expect(processAutomations).not.toHaveBeenCalled();
		}
	);

	it('still answers ping without a secret', async () => {
		guildConfig = {};
		expect((await send('ping', '{}')).status).toBe(200);
	});

	it('rejects a bad signature and accepts a good one', async () => {
		guildConfig = { webhook_secret: 's3cret' };
		expect((await send('push', PUSH, 'sha256=00')).status).toBe(401);
		const sig = 'sha256=' + createHmac('sha256', 's3cret').update(PUSH).digest('hex');
		expect((await send('push', PUSH, sig)).status).not.toBe(401);
	});
});
