import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const robots = readFileSync('static/robots.txt', 'utf8');

describe('robots.txt', () => {
	it.each(['/admin', '/account', '/api/', '/connect', '/deploy', '/dev-login', '/login'])(
		'keeps crawlers out of %s',
		(path) => {
			expect(robots).toContain(`Disallow: ${path}\n`);
		}
	);

	it('does not block the whole site', () => {
		expect(robots).not.toMatch(/^Disallow:\s*\/?\s*$/m);
	});

	it('still points at the sitemap', () => {
		expect(robots).toContain('Sitemap: https://spacebot.starspace.group/sitemap.xml');
	});
});
