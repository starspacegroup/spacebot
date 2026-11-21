import { describe, it, expect, vi } from 'vitest';

const upsert = vi.fn(async () => ({ success: false, error: 'stop here' }));

vi.mock('$lib/db/server-plans.js', () => ({
	getServerPlan: vi.fn(async () => ({ plan: 'free' })),
	upsertServerPlan: (...a: unknown[]) => (upsert as any)(...a),
	deleteServerPlan: vi.fn(),
	PLAN_TIERS: {},
}));
vi.mock('$lib/db/guild-metadata.js', () => ({ getGuildMetadata: vi.fn() }));
vi.mock('$lib/db/billing-history.js', () => ({
	addBillingEvent: vi.fn(),
	BILLING_EVENT_TYPES: {},
}));
vi.mock('$lib/db/users.js', () => ({ getUser: vi.fn() }));

import { PATCH } from '../routes/api/superadmin/servers/[guildId]/+server.js';

const platform = { env: { ADMIN_USER_IDS: 'admin1', DB: {} } };

function event(body: string) {
	return {
		request: new Request('http://localhost/x', { method: 'PATCH', body }),
		cookies: { get: (n: string) => (n === 'discord_user_id' ? 'admin1' : undefined) },
		platform,
		params: { guildId: '123' },
	} as any;
}

describe('/api/superadmin/servers/:guildId request body', () => {
	for (const bad of ['', 'not json', 'null', '7', '[]']) {
		it(`PATCH answers 400 for body ${JSON.stringify(bad)}`, async () => {
			upsert.mockClear();
			const res = await PATCH(event(bad));
			expect(res.status).toBe(400);
			expect(upsert).not.toHaveBeenCalled();
		});
	}

	it('PATCH passes an object body on', async () => {
		upsert.mockClear();
		const res = await PATCH(event('{"plan":"pro"}'));
		expect(res.status).toBe(500);
		expect(upsert).toHaveBeenCalledOnce();
	});
});
