import { describe, it, expect, vi } from 'vitest';

const setFirstLoginDmEnabled = vi.fn(async (..._a: unknown[]) => ({ success: true }));
vi.mock('$lib/server/superadmin-notifications.js', () => ({
	getFirstLoginDmEnabled: vi.fn(async () => true),
	setFirstLoginDmEnabled: (...a: unknown[]) => setFirstLoginDmEnabled(...a),
}));
vi.mock('$lib/server/superadmin-guard.js', () => ({ checkIsSuperAdmin: vi.fn(() => true) }));

import { PATCH } from '../routes/api/superadmin/settings/first-login-dm/+server.js';

function event(body: string) {
	return {
		request: new Request('http://localhost/x', {
			method: 'PATCH',
			body,
			headers: { 'content-type': 'application/json' },
		}),
		cookies: { get: () => 'admin' },
		platform: { env: { DB: {} } },
	} as any;
}

describe('superadmin/settings/first-login-dm PATCH body', () => {
	for (const bad of ['', 'not json', 'null', '7', '[]', '{}', '{"enabled":"yes"}']) {
		it(`answers 400 for body ${JSON.stringify(bad)}`, async () => {
			setFirstLoginDmEnabled.mockClear();
			const res = await PATCH(event(bad));
			expect(res.status).toBe(400);
			expect(setFirstLoginDmEnabled).not.toHaveBeenCalled();
		});
	}

	it('answers 500, not 400, when saving throws', async () => {
		setFirstLoginDmEnabled.mockRejectedValueOnce(new Error('boom'));
		const res = await PATCH(event('{"enabled":true}'));
		expect(res.status).toBe(500);
	});

	it('answers 200 for a good body', async () => {
		const res = await PATCH(event('{"enabled":false}'));
		expect(res.status).toBe(200);
	});
});
