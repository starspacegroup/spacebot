import { buildSitemap } from '$lib/server/sitemap';

export function GET({ url }) {
	return new Response(buildSitemap(url.origin), {
		headers: {
			'content-type': 'application/xml; charset=utf-8',
			'cache-control': 'public, max-age=3600',
		},
	});
}
