import { describe, expect, it } from 'vitest';
import { GET } from '../routes/api/auth/discord/+server.js';

// SvelteKit 3 throws an error, not a redirect, for an off-site URL unless the
// call names it. That turned the Discord sign-in into a 500.
describe('Discord sign-in redirect', () => {
	it('redirects to Discord instead of failing', async () => {
		const cookies = { set: () => {} };
		const event: any = {
			request: new Request('https://spacebot.starspace.group/api/auth/discord'),
			url: new URL('https://spacebot.starspace.group/api/auth/discord'),
			cookies,
			platform: { env: { DISCORD_CLIENT_ID: '123' } },
		};
		let thrown: any;
		try {
			await GET(event);
		} catch (e) {
			thrown = e;
		}
		expect(thrown?.status).toBe(302);
		expect(thrown?.location).toMatch(/^https:\/\/discord\.com\/api\/oauth2\/authorize\?/);
	});
});
