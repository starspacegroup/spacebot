import { describe, it, expect, vi } from 'vitest';

const updateAutomation = vi.fn(async () => ({ success: true }));
vi.mock('$lib/db/automations.js', () => ({
	deleteAutomation: vi.fn(),
	getAutomation: vi.fn(async () => ({ id: 'a1' })),
	updateAutomation: (...a: unknown[]) => updateAutomation(...(a as [])),
}));
vi.mock('$lib/server/control-actions.js', () => ({
	setAutomationEnabled: vi.fn(async () => ({ ok: true })),
}));
vi.mock('$lib/db/logger.js', () => ({
	EVENT_TYPES: { member_join: {} },
	log: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('$lib/discord/guilds.js', () => ({
	verifyGuildAdmin: vi.fn(async () => ({ authorized: true })),
}));

import { PATCH } from '../routes/api/automations/[guildId]/[automationId]/+server.js';

function event(body: string) {
	return {
		params: { guildId: 'g1', automationId: 'a1' },
		request: new Request('http://localhost/x', {
			method: 'PATCH',
			body,
			headers: { 'content-type': 'application/json' },
		}),
		cookies: { get: () => 'token' },
		platform: { env: { DB: {} } },
	} as any;
}

describe('update automation request body', () => {
	for (const bad of ['', 'not json', 'null', '7', '[]']) {
		it(`answers 400 for body ${JSON.stringify(bad)}`, async () => {
			updateAutomation.mockClear();
			const res = await PATCH(event(bad));
			expect(res.status).toBe(400);
			expect(updateAutomation).not.toHaveBeenCalled();
		});
	}

	it('still answers 200 for a valid update', async () => {
		const res = await PATCH(event(JSON.stringify({ name: 'n' })));
		expect(res.status).toBe(200);
	});
});
