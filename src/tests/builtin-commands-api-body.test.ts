import { describe, it, expect, vi } from 'vitest';

const getBuiltInCommand = vi.fn(async () => ({ id: 1 }));
const updateCommand = vi.fn(async () => ({ success: true }));
const createBuiltInCommand = vi.fn(async () => ({ success: true, id: 1 }));
vi.mock('$lib/db/commands.js', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getBuiltInCommand: (...a: unknown[]) => getBuiltInCommand(...(a as [])),
	updateCommand: (...a: unknown[]) => updateCommand(...(a as [])),
	createBuiltInCommand: (...a: unknown[]) => createBuiltInCommand(...(a as [])),
}));
vi.mock('$lib/db/logger.js', () => ({
	EVENT_TYPES: {},
	log: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { PATCH } from '../routes/api/commands/built-in/[commandId]/+server.js';
import { POST } from '../routes/api/commands/built-in/+server.js';

function event(method: string, body: string) {
	return {
		params: { commandId: '1' },
		request: new Request('http://localhost/x', {
			method,
			body,
			headers: { 'content-type': 'application/json' },
		}),
		cookies: { get: () => 'admin1' },
		platform: { env: { DB: {}, ADMIN_USER_IDS: 'admin1' } },
	} as any;
}

describe('built-in command request body', () => {
	for (const bad of ['', 'not json', 'null', '7', '[]']) {
		it(`update answers 400 for body ${JSON.stringify(bad)}`, async () => {
			updateCommand.mockClear();
			const res = await PATCH(event('PATCH', bad));
			expect(res.status).toBe(400);
			expect(updateCommand).not.toHaveBeenCalled();
		});
		it(`create answers 400 for body ${JSON.stringify(bad)}`, async () => {
			createBuiltInCommand.mockClear();
			const res = await POST(event('POST', bad));
			expect(res.status).toBe(400);
			expect(createBuiltInCommand).not.toHaveBeenCalled();
		});
	}
});
