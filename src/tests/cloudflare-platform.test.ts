import { describe, expect, it, vi } from 'vitest';
import { restorePlatform } from '../lib/server/cloudflare-platform.js';

/**
 * adapter-cloudflare 8 no longer passes `platform`, so without this the whole app
 * lost its D1 binding and secrets in production (the Oct 30 outage).
 */
describe('restorePlatform', () => {
	it('fills in platform.env and platform.context when the adapter gave none', async () => {
		const resolve = vi.fn().mockResolvedValue(new Response('ok'));
		const event: any = { platform: undefined };

		await restorePlatform({ event, resolve } as any);

		expect(event.platform.env).toBeDefined();
		expect(typeof event.platform.context.waitUntil).toBe('function');
		expect(() => event.platform.context.waitUntil(Promise.resolve())).not.toThrow();
		expect(resolve).toHaveBeenCalledWith(event);
	});

	it('leaves a platform that already has env alone (dev, tests)', async () => {
		const resolve = vi.fn().mockResolvedValue(new Response('ok'));
		const platform = { env: { DB: 'dev-db' }, context: { waitUntil: vi.fn() } };
		const event: any = { platform };

		await restorePlatform({ event, resolve } as any);

		expect(event.platform).toBe(platform);
	});
});
