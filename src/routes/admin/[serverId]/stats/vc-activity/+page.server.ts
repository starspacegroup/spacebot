import { redirect } from '@sveltejs/kit';

/**
 * VC activity is now the Voice tab on the Statistics page. Old links, bookmarks and
 * shared filtered views keep working: the same query string carries over.
 */
export function load({ params, url }) {
	const target = new URL(`/admin/${params.serverId}/stats`, url.origin);
	for (const [key, value] of url.searchParams) target.searchParams.set(key, value);
	target.searchParams.set('tab', 'voice');
	throw redirect(301, `${target.pathname}${target.search}`);
}
