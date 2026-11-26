import { describe, it, expect, vi } from 'vitest';

const verifyGuildAdmin = vi.fn(async () => ({ authorized: true }));
vi.mock('$lib/discord/guilds.js', () => ({
	verifyGuildAdmin: (...a: unknown[]) => verifyGuildAdmin(...(a as [])),
}));
vi.mock('$lib/db/logger.js', () => ({
	log: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import {
	POST,
	PATCH,
} from '../routes/api/discord/guilds/[guildId]/scheduled-server-events/+server.js';

function event(body: string, search = '?eventId=e1') {
	return {
		params: { guildId: 'g1' },
		url: new URL(`http://localhost/x${search}`),
		cookies: { get: () => 'token' },
		request: new Request('http://localhost/x', {
			method: 'POST',
			body,
			headers: { 'content-type': 'application/json' },
		}),
		platform: { env: { DISCORD_BOT_TOKEN: 'tok' } },
	} as any;
}

describe('scheduled server events request body', () => {
	for (const bad of ['', 'not json', 'null', '7', '[]']) {
		it(`create answers 400 for body ${JSON.stringify(bad)}`, async () => {
			const fetchSpy = vi.spyOn(globalThis, 'fetch');
			const res = await POST(event(bad, ''));
			expect(res.status).toBe(400);
			expect(fetchSpy).not.toHaveBeenCalled();
			fetchSpy.mockRestore();
		});

		it(`update answers 400 for body ${JSON.stringify(bad)}`, async () => {
			const fetchSpy = vi.spyOn(globalThis, 'fetch');
			const res = await PATCH(event(bad));
			expect(res.status).toBe(400);
			expect(fetchSpy).not.toHaveBeenCalled();
			fetchSpy.mockRestore();
		});
	}
});
