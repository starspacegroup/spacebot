import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock every dependency the endpoint imports ---------------------------
const authState: any = { authenticated: true, slug: 'agapeverse', integrationId: 7 };
const integrationState: any = {
	id: 7,
	slug: 'agapeverse',
	name: 'AgapeVerse',
	official_guild_id: '111111111111111111',
	manifest: { events: [{ type: 'agapeverse.poem_created' }] },
};
let enabledGuilds: string[] = ['111111111111111111'];
const { processAutomations } = vi.hoisted(() => ({
	processAutomations: vi.fn(async () => ({ executed: 2, errors: 0 })),
}));

vi.mock('$lib/integrations/auth.js', () => ({
	authenticateIntegration: vi.fn(async () => authState),
}));
vi.mock('$lib/db/integrations.js', () => ({
	getIntegrationById: vi.fn(async () => integrationState),
	getGuildsWithIntegration: vi.fn(async () => enabledGuilds),
}));
vi.mock('$lib/db/logger.js', () => ({
	log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
	logEvent: vi.fn(async () => ({ success: true })),
}));
vi.mock('$lib/automation/engine.js', () => ({ processAutomations }));
vi.mock('$lib/discord/rest-client.js', () => ({ createDiscordRestClient: vi.fn(() => ({})) }));
vi.mock('$lib/db/server-stats.js', () => ({ getLatestServerStats: vi.fn(async () => null) }));
vi.mock('$lib/db/guild-metadata.js', () => ({ getGuildMetadata: vi.fn(async () => null) }));

import { POST } from '../routes/api/v1/integrations/events/+server.js';

function call(body: any) {
	const request = { json: async () => body } as any;
	const platform = { env: { DB: {}, DISCORD_BOT_TOKEN: 't', APP_URL: 'http://x' } } as any;
	return POST({ request, platform } as any);
}

describe('POST /api/v1/integrations/events', () => {
	beforeEach(() => {
		authState.authenticated = true;
		integrationState.official_guild_id = '111111111111111111';
		integrationState.manifest = { events: [{ type: 'agapeverse.poem_created' }] };
		enabledGuilds = ['111111111111111111'];
		processAutomations.mockClear();
	});

	it('routes a valid event to the official guild and runs automations', async () => {
		const res = await call({ type: 'agapeverse.poem_created', details: { title: 'Roses' } });
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.automations_triggered).toBe(2);
		expect(data.guild_id).toBe('111111111111111111');
		// processAutomations got an event scoped to the official guild.
		const event = (processAutomations.mock.calls[0] as any[])[0];
		expect(event.guild_id).toBe('111111111111111111');
		expect(event.event_type).toBe('agapeverse.poem_created');
	});

	it('rejects a type not namespaced with the slug', async () => {
		const res = await call({ type: 'poem_created' });
		expect(res.status).toBe(400);
		expect(processAutomations).not.toHaveBeenCalled();
	});

	it('rejects a type not declared in the manifest', async () => {
		const res = await call({ type: 'agapeverse.undeclared' });
		expect(res.status).toBe(400);
		expect(processAutomations).not.toHaveBeenCalled();
	});

	it('409s when no official guild is configured', async () => {
		integrationState.official_guild_id = null;
		const res = await call({ type: 'agapeverse.poem_created' });
		expect(res.status).toBe(409);
		expect(processAutomations).not.toHaveBeenCalled();
	});

	it('409s when the integration is not enabled in its official guild', async () => {
		enabledGuilds = [];
		const res = await call({ type: 'agapeverse.poem_created' });
		expect(res.status).toBe(409);
		expect(processAutomations).not.toHaveBeenCalled();
	});

	it('401/403s when auth fails', async () => {
		authState.authenticated = false;
		authState.error = 'bad token';
		authState.status = 401;
		const res = await call({ type: 'agapeverse.poem_created' });
		expect(res.status).toBe(401);
	});
});
