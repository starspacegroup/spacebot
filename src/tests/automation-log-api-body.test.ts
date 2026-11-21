import { describe, it, expect, vi } from 'vitest';

const logAutomationExecution = vi.fn(async () => ({ success: true }));
vi.mock('$lib/db/automations.js', () => ({
	logAutomationExecution: (...a: unknown[]) => logAutomationExecution(...(a as [])),
}));
vi.mock('$lib/db/logger.js', () => ({
	log: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { POST } from '../routes/api/automations/[guildId]/log/+server.js';

const platform = { env: { DISCORD_BOT_TOKEN: 'tok', DB: {} } };

function event(body: string) {
	return {
		params: { guildId: 'g1' },
		request: new Request('http://localhost/x', {
			method: 'POST',
			body,
			headers: { 'content-type': 'application/json', Authorization: 'Bot tok' },
		}),
		platform,
	} as any;
}

describe('automation log request body', () => {
	for (const bad of ['', 'not json', 'null', '7', '[]']) {
		it(`answers 400 for body ${JSON.stringify(bad)}`, async () => {
			logAutomationExecution.mockClear();
			const res = await POST(event(bad));
			expect(res.status).toBe(400);
			expect(logAutomationExecution).not.toHaveBeenCalled();
		});
	}

	it('answers 400 for an object with no fields', async () => {
		const res = await POST(event('{}'));
		expect(res.status).toBe(400);
	});

	it('still answers 200 for a valid log entry', async () => {
		const res = await POST(event(JSON.stringify({ automation_id: 'a1', trigger_event: 'x' })));
		expect(res.status).toBe(200);
	});
});
