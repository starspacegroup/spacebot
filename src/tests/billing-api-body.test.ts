import { describe, it, expect, vi } from 'vitest';
import { createCookieJar } from './helpers/cookie-jar.js';

const getServerPlan = vi.fn(async () => ({}));
vi.mock('$lib/db/server-plans.js', () => ({ getServerPlan }));
vi.mock('$lib/db/billing-history.js', () => ({
	addBillingEvent: vi.fn(),
	BILLING_EVENT_TYPES: {},
}));
vi.mock('$lib/stripe.js', () => ({
	createCheckoutSession: vi.fn(),
	createBillingPortalSession: vi.fn(),
	cancelSubscription: vi.fn(),
	reactivateSubscription: vi.fn(),
	createCustomer: vi.fn(),
	StripeError: class extends Error {},
}));

async function post(body: string) {
	const { POST }: any = await import('../routes/api/billing/+server.js');
	return POST({
		request: new Request('https://app.example/api/billing', { method: 'POST', body }),
		cookies: createCookieJar({ discord_user_id: '333333333333333333' }),
		platform: { env: { DB: {}, ADMIN_USER_IDS: '' } },
		url: new URL('https://app.example/api/billing'),
	});
}

describe('billing API body', () => {
	for (const bad of ['', 'not json', 'null', '7', '[]']) {
		it(`answers 400 for body ${JSON.stringify(bad)}`, async () => {
			const res = await post(bad);
			expect(res.status).toBe(400);
			expect(getServerPlan).not.toHaveBeenCalled();
		});
	}

	it('answers 400 for an object without a guildId', async () => {
		const res = await post('{}');
		expect(res.status).toBe(400);
	});
});
