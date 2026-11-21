import { describe, it, expect, vi } from 'vitest';

const create = vi.fn(async () => ({ success: true, id: 1, send_at: 'x' }));

vi.mock('$lib/db/scheduled-messages.js', () => ({
	createScheduledMessage: (...a: unknown[]) => (create as any)(...a),
}));
vi.mock('$lib/log.js', () => ({ log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { POST } from '../routes/api/scheduled-messages/+server.js';

const platform = { env: { DISCORD_BOT_TOKEN: 'tok', DB: {} } };

function event(body: string) {
	return {
		request: new Request('http://localhost/x', {
			method: 'POST',
			body,
			headers: { Authorization: 'Bot tok' },
		}),
		platform,
	} as any;
}

describe('scheduled-messages POST request body', () => {
	for (const bad of ['', 'not json', 'null', '7', '[]']) {
		it(`answers 400 for body ${JSON.stringify(bad)}`, async () => {
			create.mockClear();
			const res = await POST(event(bad));
			expect(res.status).toBe(400);
			expect(create).not.toHaveBeenCalled();
		});
	}

	it('passes an object body on', async () => {
		create.mockClear();
		const res = await POST(event('{"guild_id":"1"}'));
		expect(res.status).toBe(200);
		expect(create).toHaveBeenCalledOnce();
	});
});
