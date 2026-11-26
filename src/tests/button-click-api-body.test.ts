import { describe, it, expect, vi } from 'vitest';

const findButtonActions = vi.fn(async () => null);
const logButtonClick = vi.fn(async () => ({}));
vi.mock('$lib/db/button-actions.js', () => ({
	findButtonActions: (...a: unknown[]) => findButtonActions(...(a as [])),
	logButtonClick: (...a: unknown[]) => logButtonClick(...(a as [])),
}));
vi.mock('$lib/db/logger.js', () => ({
	EVENT_TYPES: {},
	log: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { POST } from '../routes/api/buttons/[guildId]/click/+server.js';

function event(body: string) {
	return {
		params: { guildId: 'g1' },
		request: new Request('http://localhost/x', {
			method: 'POST',
			body,
			headers: { 'content-type': 'application/json', Authorization: 'Bot tok' },
		}),
		platform: { env: { DB: {}, DISCORD_BOT_TOKEN: 'tok' } },
	} as any;
}

describe('button click request body', () => {
	for (const bad of ['', 'not json', 'null', '7', '[]']) {
		it(`answers 400 for body ${JSON.stringify(bad)}`, async () => {
			findButtonActions.mockClear();
			const res = await POST(event(bad));
			expect(res.status).toBe(400);
			expect(findButtonActions).not.toHaveBeenCalled();
		});
	}

	it('still answers 400 for a missing custom_id', async () => {
		const res = await POST(event('{}'));
		expect(res.status).toBe(400);
	});
});
