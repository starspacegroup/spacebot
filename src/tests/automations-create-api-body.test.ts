import { describe, it, expect, vi } from 'vitest';

const createAutomation = vi.fn(async () => ({ success: true, id: 'a1' }));
vi.mock('$lib/db/automations.js', () => ({
	ACTION_TYPES: { send_message: {} },
	FILTER_TYPES: {},
	TEMPLATE_VARIABLES: {},
	createAutomation: (...a: unknown[]) => createAutomation(...(a as [])),
	getAutomations: vi.fn(async () => ({ automations: [] })),
}));
vi.mock('$lib/db/logger.js', () => ({
	EVENT_CATEGORIES: {},
	EVENT_TYPES: { member_join: {} },
	log: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('$lib/discord/guilds.js', () => ({
	verifyGuildAdmin: vi.fn(async () => ({ authorized: true })),
}));
vi.mock('$lib/db/server-plans.js', () => ({
	checkPlanLimit: vi.fn(async () => ({ allowed: true })),
}));

import { POST } from '../routes/api/automations/[guildId]/+server.js';

function event(body: string) {
	return {
		params: { guildId: 'g1' },
		request: new Request('http://localhost/x', {
			method: 'POST',
			body,
			headers: { 'content-type': 'application/json' },
		}),
		cookies: { get: () => 'token' },
		platform: { env: { DB: {} } },
	} as any;
}

describe('create automation request body', () => {
	for (const bad of ['', 'not json', 'null', '7', '[]']) {
		it(`answers 400 for body ${JSON.stringify(bad)}`, async () => {
			createAutomation.mockClear();
			const res = await POST(event(bad));
			expect(res.status).toBe(400);
			expect(createAutomation).not.toHaveBeenCalled();
		});
	}

	it('answers 400 for an object with no fields', async () => {
		const res = await POST(event('{}'));
		expect(res.status).toBe(400);
	});

	it('still answers 201 for a valid automation', async () => {
		const res = await POST(
			event(
				JSON.stringify({
					name: 'n',
					trigger_event: 'member_join',
					action_type: 'send_message',
					action_config: {},
				})
			)
		);
		expect(res.status).toBe(201);
	});
});
