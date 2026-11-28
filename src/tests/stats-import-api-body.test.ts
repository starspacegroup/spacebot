import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/log.js', () => ({
	log: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { POST } from '../routes/api/stats/[guildId]/import/+server.js';

const prepare = vi.fn();

function event(body: string) {
	return {
		params: { guildId: 'g1' },
		request: new Request('http://localhost/x', {
			method: 'POST',
			body,
			headers: { 'content-type': 'application/json' },
		}),
		cookies: { get: () => 'admin1' },
		platform: { env: { DB: { prepare, batch: vi.fn() }, ADMIN_USER_IDS: 'admin1' } },
	} as any;
}

describe('import stats request body', () => {
	for (const bad of ['', 'not json', 'null', '7', '[]']) {
		it(`answers 400 for body ${JSON.stringify(bad)}`, async () => {
			prepare.mockClear();
			const res = await POST(event(bad));
			expect(res.status).toBe(400);
			expect(prepare).not.toHaveBeenCalled();
		});
	}

	it('still answers 400 for a wrong export format', async () => {
		const res = await POST(event(JSON.stringify({ format: 'other' })));
		expect(res.status).toBe(400);
	});
});
