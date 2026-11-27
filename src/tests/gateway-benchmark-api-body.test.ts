import { describe, it, expect, vi } from 'vitest';

const recordGatewayBenchmark = vi.fn(async () => ({ success: true }));
vi.mock('$lib/db/gateway-benchmarks.js', () => ({
	recordGatewayBenchmark: (...a: unknown[]) => recordGatewayBenchmark(...(a as [])),
	getBenchmarkStats: vi.fn(),
	getBenchmarkChartData: vi.fn(),
	getRecentBenchmarks: vi.fn(),
}));
vi.mock('$lib/db/global-settings.js', () => ({
	getGlobalSetting: vi.fn(async () => '60'),
	setGlobalSetting: vi.fn(),
}));
vi.mock('$lib/log.js', () => ({
	log: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('$lib/server/superadmin-guard.js', () => ({ checkIsSuperAdmin: vi.fn(() => false) }));

import { POST } from '../routes/api/gateway/benchmark/+server.js';

function event(body: string) {
	return {
		request: new Request('http://localhost/x', {
			method: 'POST',
			body,
			headers: { 'content-type': 'application/json', Authorization: 'Bot tok' },
		}),
		platform: { env: { DB: {}, DISCORD_BOT_TOKEN: 'tok' } },
	} as any;
}

describe('gateway/benchmark POST body', () => {
	for (const bad of ['', 'not json', 'null', '7', '[]']) {
		it(`answers 400 for body ${JSON.stringify(bad)}`, async () => {
			recordGatewayBenchmark.mockClear();
			const res = await POST(event(bad));
			expect(res.status).toBe(400);
			expect(recordGatewayBenchmark).not.toHaveBeenCalled();
		});
	}

	it('answers 500, not 400, when recording throws', async () => {
		recordGatewayBenchmark.mockRejectedValueOnce(new Error('boom'));
		const res = await POST(event('{"status":"ok"}'));
		expect(res.status).toBe(500);
	});

	it('answers 200 for a good body', async () => {
		const res = await POST(event('{"status":"ok"}'));
		expect(res.status).toBe(200);
	});
});
