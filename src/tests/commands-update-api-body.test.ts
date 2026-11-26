import { describe, it, expect, vi } from 'vitest';

const getCommand = vi.fn(async () => ({ id: 1, is_built_in: 0 }));
const updateCommand = vi.fn(async () => ({ success: true }));
vi.mock('$lib/db/commands.js', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getCommand: (...a: unknown[]) => getCommand(...(a as [])),
	updateCommand: (...a: unknown[]) => updateCommand(...(a as [])),
}));
vi.mock('$lib/db/logger.js', () => ({
	EVENT_TYPES: {},
	log: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('$lib/discord/guilds.js', () => ({
	verifyGuildAdmin: vi.fn(async () => ({ authorized: true })),
}));
vi.mock('$lib/discord/commands.js', () => ({
	syncGuildCommands: vi.fn(async () => ({})),
}));

import { PATCH } from '../routes/api/commands/[guildId]/[commandId]/+server.js';

function event(body: string) {
	return {
		params: { guildId: 'g1', commandId: '1' },
		request: new Request('http://localhost/x', {
			method: 'PATCH',
			body,
			headers: { 'content-type': 'application/json' },
		}),
		cookies: { get: () => 'token' },
		platform: { env: { DB: {} } },
	} as any;
}

describe('command update request body', () => {
	for (const bad of ['', 'not json', 'null', '7', '[]']) {
		it(`answers 400 for body ${JSON.stringify(bad)}`, async () => {
			getCommand.mockClear();
			updateCommand.mockClear();
			const res = await PATCH(event(bad));
			expect(res.status).toBe(400);
			expect(updateCommand).not.toHaveBeenCalled();
		});
	}
});
