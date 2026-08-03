import { error } from '@sveltejs/kit';
import { LISTING_CATEGORIES, getPublicListing } from '$lib/db/server-listings.js';

/**
 * Public detail page for one listed server.
 *
 * A guild that isn't published (or was hidden by the operator) 404s exactly like
 * a guild that doesn't exist — the response must not confirm that an unlisted
 * server is using SpaceBot.
 */
export async function load({ platform, params }) {
	const db = (platform as any)?.env?.DB;
	const listing = await getPublicListing(db, params.guildId);

	if (!listing) {
		throw error(404, 'Server not found in the public browser');
	}

	return {
		listing,
		categoryLabel:
			LISTING_CATEGORIES.find((c) => c.value === listing.category)?.label || listing.category,
	};
}
