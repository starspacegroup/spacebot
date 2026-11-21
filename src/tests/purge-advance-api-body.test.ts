import { describe, it, expect, vi } from 'vitest';

const runPurgeBatch = vi.fn();
vi.mock('$lib/server/message-purge.js', () => ({
	runPurgeBatch: (...a: unknown[]) => runPurgeBatch(...a),
	decidePurgeOutcome: vi.fn(),
}));
vi.mock('$lib/server/message-purge-discord.js', () => ({ createDiscordApi: vi.fn() }));
vi.mock('$lib/server/message-purge-settings.js', () => ({
	getMessagePurgeSettings: vi.fn(async () => ({ maxBatches: 1, checkpointContinue: false })),
	MAX_CONTINUATIONS: 1,
}));
vi.mock('$lib/server/message-purge-queue.js', () => ({ enqueueMessagePurgeContinuation: vi.fn() }));
vi.mock('$lib/log.js', () => ({
	log: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { POST } from '../routes/api/discord/purge/advance/+server.js';

const platform = { env: { CRON_SECRET: 'sekret', DISCORD_BOT_TOKEN: 'tok', DB: {} } };

function event(body: string) {
	return {
		request: new Request('http://localhost/x', {
			method: 'POST',
			body,
			headers: { 'content-type': 'application/json', Authorization: 'Bearer sekret' },
		}),
		platform,
		fetch: vi.fn(),
	} as any;
}

describe('purge advance request body', () => {
	for (const bad of ['', 'not json', 'null', '7', '[]']) {
		it(`answers 400 for body ${JSON.stringify(bad)}`, async () => {
			runPurgeBatch.mockClear();
			const res = await POST(event(bad));
			expect(res.status).toBe(400);
			expect(runPurgeBatch).not.toHaveBeenCalled();
		});
	}

	it('answers 400 for an object with no purge state', async () => {
		const res = await POST(event('{}'));
		expect(res.status).toBe(400);
	});
});
