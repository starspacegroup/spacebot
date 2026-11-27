import { describe, it, expect, vi } from 'vitest';

const logEvent = vi.fn(async () => ({ success: true }));
vi.mock('$lib/db/logger.js', () => ({
	logEvent: (...a: unknown[]) => logEvent(...(a as [])),
	log: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('$lib/db/settings.js', () => ({
	getGuildSettings: vi.fn(async () => ({ logging_enabled: false })),
}));
vi.mock('$lib/db/server-stats.js', () => ({
	updateMemberCount: vi.fn(async () => ({ success: true, newCount: 1 })),
}));

import { POST } from '../routes/api/logs/create/+server.js';

function event(body: string) {
	return {
		request: new Request('http://localhost/x', {
			method: 'POST',
			body,
			headers: { 'content-type': 'application/json', Authorization: 'Bot tok' },
		}),
		platform: { env: { DB: {}, DISCORD_BOT_TOKEN: 'tok' } },
	} as any;
}

const good = '{"guild_id":"g1","event_type":"MESSAGE_CREATE","event_category":"message"}';

describe('logs/create request body', () => {
	for (const bad of ['', 'not json', 'null', '7', '[]']) {
		it(`answers 400 for body ${JSON.stringify(bad)}`, async () => {
			logEvent.mockClear();
			const res = await POST(event(bad));
			expect(res.status).toBe(400);
			expect(logEvent).not.toHaveBeenCalled();
		});
	}

	it('still answers 400 for missing fields', async () => {
		const res = await POST(event('{"guild_id":"g1"}'));
		expect(res.status).toBe(400);
	});

	it('answers 500, not 400, when logging throws', async () => {
		logEvent.mockRejectedValueOnce(new Error('boom'));
		const res = await POST(event(good));
		expect(res.status).toBe(500);
	});

	it('answers 200 for a good body', async () => {
		const res = await POST(event(good));
		expect(res.status).toBe(200);
	});
});
