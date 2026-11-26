import { describe, it, expect, vi } from 'vitest';

const setGuild = vi.fn(async () => ({ success: true }));

vi.mock('$lib/db/integrations.js', () => ({
	setIntegrationOfficialGuild: (...a: unknown[]) => (setGuild as any)(...a),
}));
vi.mock('$lib/db/logger.js', () => ({ log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { POST } from '../routes/api/integrations/official-guild/+server.js';

const platform = { env: { ADMIN_USER_IDS: 'admin1', DB: {} } };

function event(body: string) {
	return {
		request: new Request('http://localhost/x', { method: 'POST', body }),
		cookies: { get: () => 'admin1' },
		platform,
	} as any;
}

describe('official-guild POST request body', () => {
	for (const bad of ['', 'not json', 'null', '7', '[]']) {
		it(`answers 400 for body ${JSON.stringify(bad)}`, async () => {
			setGuild.mockClear();
			const res = await POST(event(bad));
			expect(res.status).toBe(400);
			expect(setGuild).not.toHaveBeenCalled();
		});
	}

	it('passes an object body on', async () => {
		setGuild.mockClear();
		const res = await POST(event('{"integrationId":"a"}'));
		expect(res.status).toBe(200);
		expect(setGuild).toHaveBeenCalledOnce();
	});
});
