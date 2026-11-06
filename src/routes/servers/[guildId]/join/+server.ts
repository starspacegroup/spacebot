import { error, redirect } from '@sveltejs/kit';
import { getPublicListing } from '$lib/db/server-listings.js';
import { countableRequest, recordJoin } from '$lib/server/browser-stats.js';

/**
 * The Join button's address. It counts the press, then sends the visitor to the invite the
 * server chose. Only a listing that is public right now redirects (the same check the
 * browser uses), and the target is the stored invite, never a value from the request, so
 * this cannot be used to bounce someone to an address of the caller's choosing.
 */
export async function GET({ platform, params, request }) {
	const db = (platform as any)?.env?.DB;
	const listing = await getPublicListing(db, params.guildId);
	if (!listing?.invite_url) throw error(404, 'Server not found in the public browser');

	if (countableRequest(request)) {
		const write = recordJoin(db, params.guildId).catch(() => {});
		const ctx = (platform as any)?.context;
		if (ctx?.waitUntil) ctx.waitUntil(write);
		else await write;
	}

	// SvelteKit refuses an off-site redirect unless its origin is named. The origin here is the
	// stored invite's own (validated when the server saved its listing), never request input.
	throw redirect(302, listing.invite_url, { external: [new URL(listing.invite_url).origin] });
}
