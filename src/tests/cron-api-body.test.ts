import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/server/cron-jobs.js', () => ({}));
vi.mock('$lib/db/scheduled-messages.js', () => ({}));
vi.mock('$lib/db/anniversary-timeline.js', () => ({}));
vi.mock('$lib/server/managed-channel-reaper.js', () => ({}));
vi.mock('$lib/server/quorum.js', () => ({}));
vi.mock('$lib/server/timebox.js', () => ({}));
vi.mock('$lib/server/game.js', () => ({}));
vi.mock('$lib/server/shiritori-game.js', () => ({}));
vi.mock('$lib/server/site-traffic.js', () => ({}));
vi.mock('$lib/discord/rest-client.js', () => ({}));
vi.mock('$lib/discord/commands.js', () => ({}));

import { POST, DELETE } from '../routes/api/cron/+server.js';

const platform = { env: { CRON_SECRET: 'secret', ADMIN_USER_IDS: 'admin1' } };

function event(method: string, body: string) {
	return {
		request: new Request('http://localhost/api/cron', {
			method,
			body,
			headers: { Authorization: 'Bearer secret' },
		}),
		cookies: { get: (n: string) => (n === 'discord_user_id' ? 'admin1' : undefined) },
		platform,
	} as any;
}

describe('/api/cron request bodies', () => {
	for (const bad of ['', 'not json', 'null', '7']) {
		it(`POST answers 400 for body ${JSON.stringify(bad)}`, async () => {
			const res = await POST(event('POST', bad));
			expect(res.status).toBe(400);
		});
		it(`DELETE answers 400 for body ${JSON.stringify(bad)}`, async () => {
			const res = await DELETE(event('DELETE', bad));
			expect(res.status).toBe(400);
		});
	}
});
