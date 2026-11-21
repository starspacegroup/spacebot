import { describe, it, expect, vi } from 'vitest';

const getTriggeredAutomations = vi.fn(async () => []);
vi.mock('$lib/db/automations.js', () => ({
	getTriggeredAutomations: (...a: unknown[]) => getTriggeredAutomations(...(a as [])),
}));
vi.mock('$lib/db/logger.js', () => ({
	log: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('$lib/automation/engine.js', () => ({
	matchesFilters: vi.fn(),
	processTemplate: vi.fn(),
	buildContext: vi.fn(),
}));
vi.mock('$lib/db/guild-cache.js', () => ({ getMemberFromCache: vi.fn() }));
vi.mock('$lib/db/server-stats.js', () => ({ getLatestServerStats: vi.fn() }));
vi.mock('$lib/db/guild-metadata.js', () => ({ getGuildMetadata: vi.fn() }));
vi.mock('$lib/db/settings.js', () => ({ getGuildTimezone: vi.fn() }));
vi.mock('$lib/db/automation-trigger-state.js', () => ({ checkVoiceThreshold: vi.fn() }));

import { POST } from '../routes/api/automations/[guildId]/process/+server.js';

const platform = { env: { DISCORD_BOT_TOKEN: 'tok', DB: {} } };

function event(body: string) {
	return {
		params: { guildId: 'g1' },
		request: new Request('http://localhost/x', {
			method: 'POST',
			body,
			headers: { 'content-type': 'application/json', Authorization: 'Bot tok' },
		}),
		platform,
	} as any;
}

describe('automation process request body', () => {
	for (const bad of ['', 'not json', 'null', '7', '[]']) {
		it(`answers 400 for body ${JSON.stringify(bad)}`, async () => {
			getTriggeredAutomations.mockClear();
			const res = await POST(event(bad));
			expect(res.status).toBe(400);
			expect(getTriggeredAutomations).not.toHaveBeenCalled();
		});
	}

	it('answers 400 for an object with no event', async () => {
		const res = await POST(event('{}'));
		expect(res.status).toBe(400);
	});

	it('still answers 200 for a valid event', async () => {
		const res = await POST(event(JSON.stringify({ event: { event_type: 'MESSAGE_CREATE' } })));
		expect(res.status).toBe(200);
	});
});
