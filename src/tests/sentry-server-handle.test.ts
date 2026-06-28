import { describe, it, expect, vi } from 'vitest';
import { initSentryHandle } from '../hooks.server.js';

/**
 * Server-side Sentry handle is env-gated: with no SENTRY_DSN (or no Cloudflare
 * platform), it must be a transparent pass-through that never touches Sentry —
 * the common local/dev case. The Workers wrapRequestHandler branch is verified
 * by the production build, not unit-tested (needs the CF execution context).
 */
describe('initSentryHandle (server Sentry gating)', () => {
	it('passes through and returns resolve() when there is no platform', async () => {
		const response = new Response('ok');
		const resolve = vi.fn().mockResolvedValue(response);
		const event: any = { platform: undefined, locals: {}, request: new Request('https://x/') };

		const result = await initSentryHandle({ event, resolve });

		expect(resolve).toHaveBeenCalledOnce();
		expect(result).toBe(response);
		expect(event.locals._sentrySkipRequestIsolation).toBeUndefined();
	});

	it('passes through when platform exists but SENTRY_DSN is unset', async () => {
		const response = new Response('ok');
		const resolve = vi.fn().mockResolvedValue(response);
		const event: any = {
			platform: { env: {}, context: {} },
			locals: {},
			request: new Request('https://x/'),
		};

		const result = await initSentryHandle({ event, resolve });

		expect(resolve).toHaveBeenCalledOnce();
		expect(result).toBe(response);
		expect(event.locals._sentrySkipRequestIsolation).toBeUndefined();
	});
});
