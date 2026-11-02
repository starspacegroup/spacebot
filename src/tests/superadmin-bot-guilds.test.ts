import { describe, expect, it, vi } from 'vitest';
import { getBotGuilds } from '../routes/admin/superadmin/servers/+page.server.js';

const res = (status: number, body: any = {}) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('getBotGuilds', () => {
	it('waits out a 429 and then succeeds', async () => {
		const f = vi
			.fn()
			.mockResolvedValueOnce(res(429, { retry_after: 0.7, global: false }))
			.mockResolvedValueOnce(res(200, [{ id: '1', name: 'A' }]));
		const sleep = vi.fn(async () => {});
		const r = await getBotGuilds('t', f as any, sleep);
		expect(r.available).toBe(true);
		expect(r.guilds).toHaveLength(1);
		expect(sleep).toHaveBeenCalledWith(800);
	});

	it('names the reason when it keeps being limited', async () => {
		const f = vi.fn(async () => res(429, { retry_after: 1, global: true }));
		const r = await getBotGuilds('t', f as any, async () => {});
		expect(r.available).toBe(false);
		expect(r.reason).toMatch(/rate limited.*global/);
		expect(f).toHaveBeenCalledTimes(3);
	});

	it('does not retry a 401', async () => {
		const f = vi.fn(async () => res(401));
		const r = await getBotGuilds('t', f as any);
		expect(r.reason).toBe('Discord answered 401');
		expect(f).toHaveBeenCalledTimes(1);
	});
});
