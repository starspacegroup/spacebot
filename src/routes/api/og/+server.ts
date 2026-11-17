import { redirect } from '@sveltejs/kit';
import { isOgCardKey } from '$lib/seo/social.js';

/**
 * Old share-card address, kept so links that already point here still work. The cards are PNG
 * files in `static/og/`, drawn ahead of time by `scripts/generate-og-cards.ts`: Cloudflare
 * Workers will not compile the WebAssembly that draws a PNG from an SVG at request time, so this
 * can no longer draw them live. An unknown name gets the home card.
 */
export function GET({ url }) {
	const requested = url.searchParams.get('page');
	const card = isOgCardKey(requested) ? requested : 'home';
	redirect(301, `/og/${card}.png`);
}
