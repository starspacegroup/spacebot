import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The page-view logger must skip the file the layout actually links as the
// install manifest, or every app install is recorded as a page view.
describe('activity tracking skip list', () => {
	const hooks = readFileSync('src/hooks.server.ts', 'utf8');
	const layout = readFileSync('src/routes/+layout.svelte', 'utf8');

	it('skips the manifest path the layout links to', () => {
		const href = /<link rel="manifest" href="([^"]+)"/.exec(layout)?.[1];
		expect(href).toBeTruthy();
		expect(hooks).toContain(`pathname === '${href}'`);
	});
});
