import { describe, it, expect } from 'vitest';
import { buildSitemap, sitemapPaths } from '$lib/server/sitemap';
import { listDocSlugs } from '$lib/server/docs';

describe('sitemap', () => {
	it('lists the public pages and every dev doc', () => {
		const paths = sitemapPaths();
		expect(paths).toContain('/');
		expect(paths).toContain('/privacy');
		for (const slug of listDocSlugs()) expect(paths).toContain(`/docs/dev/${slug}`);
	});

	it('never lists admin, account or api routes', () => {
		for (const p of sitemapPaths()) expect(p).not.toMatch(/^\/(admin|account|api)/);
	});

	it('builds absolute urls and trims a trailing slash on the origin', () => {
		const xml = buildSitemap('https://example.com/', ['x&y']);
		expect(xml).toContain('<loc>https://example.com/</loc>');
		expect(xml).toContain('<loc>https://example.com/docs/dev/x&amp;y</loc>');
		expect(xml).not.toContain('example.com//');
	});
});
