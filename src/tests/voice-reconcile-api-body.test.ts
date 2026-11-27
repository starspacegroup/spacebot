import { describe, it, expect, vi } from 'vitest';

const reconcileVoiceSessions = vi.fn(async () => ({
	closedSessions: 0,
	createdSessions: 0,
	duplicateSessionsClosed: 0,
}));
const replaceLiveVoiceSnapshot = vi.fn(async () => ({ success: true, memberCount: 0 }));
vi.mock('$lib/db/stats-aggregation.js', () => ({
	reconcileVoiceSessions: (...a: unknown[]) => reconcileVoiceSessions(...(a as [])),
}));
vi.mock('$lib/db/live-voice.js', () => ({
	replaceLiveVoiceSnapshot: (...a: unknown[]) => replaceLiveVoiceSnapshot(...(a as [])),
}));
vi.mock('$lib/log.js', () => ({
	log: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { POST } from '../routes/api/voice/reconcile/+server.js';

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

describe('voice reconcile request body', () => {
	for (const bad of ['', 'not json', 'null', '7', '[]']) {
		it(`answers 400 for body ${JSON.stringify(bad)}`, async () => {
			reconcileVoiceSessions.mockClear();
			const res = await POST(event(bad));
			expect(res.status).toBe(400);
			expect(reconcileVoiceSessions).not.toHaveBeenCalled();
		});
	}

	it('still answers 400 for a missing guild_id', async () => {
		const res = await POST(event('{}'));
		expect(res.status).toBe(400);
	});

	it('answers 500, not 400, when the database fails', async () => {
		reconcileVoiceSessions.mockRejectedValueOnce(new Error('boom'));
		const res = await POST(event('{"guild_id":"g1"}'));
		expect(res.status).toBe(500);
	});

	it('answers 200 for a good body', async () => {
		const res = await POST(event('{"guild_id":"g1","active_sessions":[]}'));
		expect(res.status).toBe(200);
	});
});
