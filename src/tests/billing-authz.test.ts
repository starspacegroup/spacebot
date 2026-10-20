import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCookieJar } from './helpers/cookie-jar.js';
import { safeBillingReturnUrl } from '../lib/server/billing-return-url.js';

const getServerPlan = vi.fn(async () => ({
	stripe_customer_id: 'cus_victim',
	stripe_subscription_id: 'sub_victim',
	stripe_status: 'active',
}));
const cancelSubscription = vi.fn();
const reactivateSubscription = vi.fn();
const createBillingPortalSession = vi.fn(async () => ({ url: 'https://stripe/portal' }));
const createCheckoutSession = vi.fn();

vi.mock('$lib/db/server-plans.js', () => ({ getServerPlan }));
vi.mock('$lib/db/billing-history.js', () => ({
	addBillingEvent: vi.fn(),
	BILLING_EVENT_TYPES: {},
}));
vi.mock('$lib/stripe.js', () => ({
	createCheckoutSession,
	createBillingPortalSession,
	cancelSubscription,
	reactivateSubscription,
	createCustomer: vi.fn(),
	StripeError: class extends Error {},
}));

const USER = '333333333333333333';
const GUILD_A = '444444444444444444';
const VICTIM = '555555555555555555';

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

async function post(body: Record<string, unknown>, token: string) {
	const { POST }: any = await import('../routes/api/billing/+server.js');
	return POST({
		request: new Request('https://app.example/api/billing', {
			method: 'POST',
			body: JSON.stringify(body),
		}),
		cookies: createCookieJar({ discord_user_id: USER, discord_access_token: token }),
		platform: { env: { DB: {}, ADMIN_USER_IDS: '' } },
		url: new URL('https://app.example/api/billing'),
	});
}

describe('billing API authorization', () => {
	it.each(['checkout', 'portal', 'cancel', 'reactivate'])(
		'%s for a guild the caller does not administer → 403',
		async (action) => {
			vi.stubGlobal(
				'fetch',
				vi.fn(async () => new Response(JSON.stringify([{ id: GUILD_A, permissions: '8' }])))
			);
			const res = await post({ action, guildId: VICTIM }, `tok-${action}`);
			expect(res.status).toBe(403);
			expect(getServerPlan).not.toHaveBeenCalled();
			expect(cancelSubscription).not.toHaveBeenCalled();
			expect(createBillingPortalSession).not.toHaveBeenCalled();
		}
	);

	it('MANAGE_GUILD without Administrator → 403', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify([{ id: VICTIM, permissions: '32' }])))
		);
		expect((await post({ action: 'cancel', guildId: VICTIM }, 'tok-mg')).status).toBe(403);
	});

	it('guild administrator may open the portal; foreign returnUrl is dropped', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify([{ id: VICTIM, permissions: '8' }])))
		);
		const res = await post(
			{ action: 'portal', guildId: VICTIM, returnUrl: 'https://evil.example/x' },
			'tok-admin'
		);
		expect(res.status).toBe(200);
		expect((createBillingPortalSession.mock.calls[0] as any[])[2]).toBe(
			`https://app.example/admin/${VICTIM}/account`
		);
	});
});

describe('safeBillingReturnUrl', () => {
	const origin = 'https://app.example';
	it.each(['https://evil.example/', '//evil.example/a', 'javascript:alert(1)', 42, ''])(
		'rejects %s',
		(value) => {
			expect(safeBillingReturnUrl(value, origin, VICTIM)).toBe(
				`${origin}/admin/${VICTIM}/account`
			);
		}
	);
	it('keeps a same-origin path without its query', () => {
		expect(safeBillingReturnUrl(`${origin}/admin/1/account?x=1`, origin, VICTIM)).toBe(
			`${origin}/admin/1/account`
		);
	});
});
