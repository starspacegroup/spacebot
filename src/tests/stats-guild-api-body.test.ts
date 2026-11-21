import { describe, it, expect, vi } from 'vitest';

const recordServerStats = vi.fn(async () => ({ success: true }));
const fetchGuildStatsFromDiscord = vi.fn(async () => ({ stats: { member_count: 3 } }));

vi.mock('$lib/db/server-stats.js', () => ({
	recordServerStats: (...a: unknown[]) => (recordServerStats as any)(...a),
	fetchGuildStatsFromDiscord: (...a: unknown[]) => (fetchGuildStatsFromDiscord as any)(...a),
	getServerStatsHistory: vi.fn(),
	getMemberCountChanges: vi.fn(),
	getPeakMemberCount: vi.fn(),
	getLatestServerStats: vi.fn(),
}));
vi.mock('$lib/log.js', () => ({ log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { POST } from '../routes/api/stats/[guildId]/+server.js';

const platform = { env: { CRON_SECRET: 'sekret', DB: {} } };

function event(body: string) {
	return {
		params: { guildId: 'g1' },
		request: new Request('http://localhost/x', {
			method: 'POST',
			body,
			headers: { 'content-type': 'application/json', Authorization: 'Bearer sekret' },
		}),
		platform,
	} as any;
}

describe('stats POST request body', () => {
	for (const bad of ['', 'not json', 'null', '7', '[]']) {
		it(`answers 400 for body ${JSON.stringify(bad)}`, async () => {
			recordServerStats.mockClear();
			const res = await POST(event(bad));
			expect(res.status).toBe(400);
			expect(recordServerStats).not.toHaveBeenCalled();
		});
	}

	it('records supplied stats', async () => {
		recordServerStats.mockClear();
		const res = await POST(event('{"member_count":9}'));
		expect(res.status).toBe(200);
		expect(recordServerStats).toHaveBeenCalledOnce();
	});

	it('fetches from Discord when the object has no member_count', async () => {
		recordServerStats.mockClear();
		const res = await POST(event('{}'));
		expect(res.status).toBe(200);
		expect(fetchGuildStatsFromDiscord).toHaveBeenCalled();
	});
});
