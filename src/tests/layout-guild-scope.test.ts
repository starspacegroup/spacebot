import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../routes/+layout.server.ts', import.meta.url), 'utf8');

/**
 * The root layout only fetches the user's guilds for certain paths, because
 * doing it everywhere costs a Discord round trip on every page.
 *
 * `/connect` has to be in that list: its consent screen asks which server to
 * grant, and without guilds it renders "you don't administer any server" to
 * everybody — which is exactly what it did until this was caught by running the
 * flow rather than by any unit test.
 */
describe('root layout guild fetching', () => {
	it('fetches guilds for /connect as well as /admin and /account', () => {
		const gate = source.match(/const needsGuilds =[\s\S]*?;/)?.[0] ?? '';

		expect(gate).toContain("startsWith('/admin')");
		expect(gate).toContain("startsWith('/account')");
		expect(gate).toContain("startsWith('/connect')");
	});
});
