/**
 * Builds /sitemap.xml: the public, crawlable pages. Admin, account and API
 * routes are left out on purpose.
 */
import { listDocSlugs } from '$lib/server/docs';

const STATIC_PATHS = [
	'/',
	'/servers',
	'/invite',
	'/vote',
	'/docs',
	'/docs/dev',
	'/support',
	'/privacy',
	'/terms',
];

function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

export function sitemapPaths(slugs: string[] = listDocSlugs()): string[] {
	return [...STATIC_PATHS, ...slugs.map((slug) => `/docs/dev/${slug}`)];
}

export function buildSitemap(origin: string, slugs?: string[]): string {
	const base = origin.replace(/\/+$/, '');
	const urls = sitemapPaths(slugs)
		.map((path) => `\t<url><loc>${escapeXml(base + path)}</loc></url>`)
		.join('\n');
	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
