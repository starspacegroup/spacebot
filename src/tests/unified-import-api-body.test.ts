import { describe, it, expect, vi } from 'vitest';

const createAutomation = vi.fn(async () => ({ success: true, id: 1 }));
const createCommand = vi.fn(async () => ({ success: true, id: 1 }));
vi.mock('$lib/db/automations.js', async (importOriginal) => ({
	...(await importOriginal<object>()),
	createAutomation: (...a: unknown[]) => createAutomation(...(a as [])),
}));
vi.mock('$lib/db/commands.js', async (importOriginal) => ({
	...(await importOriginal<object>()),
	createCommand: (...a: unknown[]) => createCommand(...(a as [])),
}));
vi.mock('$lib/db/logger.js', () => ({
	EVENT_TYPES: { member_join: {} },
	log: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('$lib/discord/guilds.js', () => ({
	verifyGuildAdmin: vi.fn(async () => ({ authorized: true })),
}));
vi.mock('$lib/discord/commands.js', () => ({
	syncGuildCommands: vi.fn(async () => ({})),
}));

import { POST } from '../routes/api/import/[guildId]/+server.js';

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

describe('unified import request body', () => {
	for (const bad of ['', 'not json', 'null', '7', '[]']) {
		it(`answers 400 for body ${JSON.stringify(bad)}`, async () => {
			createAutomation.mockClear();
			createCommand.mockClear();
			const res = await POST(event(bad));
			expect(res.status).toBe(400);
			expect(createAutomation).not.toHaveBeenCalled();
			expect(createCommand).not.toHaveBeenCalled();
		});
	}

	it('still answers 400 for a wrong backup format', async () => {
		const res = await POST(event(JSON.stringify({ format: 'other' })));
		expect(res.status).toBe(400);
	});
});
