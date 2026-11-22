import { error } from '@sveltejs/kit';
import { LISTING_CATEGORIES, getPublicListing } from '$lib/db/server-listings.js';
import { getManageableGuilds } from '$lib/server/manageable-guilds.js';
import { countableRequest, recordListingView } from '$lib/server/browser-stats.js';

/**
 * Public detail page for one listed server.
 *
 * A guild that isn't published (or was hidden by the operator) 404s exactly like
 * a guild that doesn't exist — the response must not confirm that an unlisted
 * server is using SpaceBot.
 */
export async function load({ platform, params, cookies, request }) {
	const db = (platform as any)?.env?.DB;
	const listing = await getPublicListing(db, params.guildId);

	if (!listing) {
		throw error(404, 'Server not found in the public browser');
	}

	// Counted for the superadmin's Server browser stats. Off the request path.
	if (db && countableRequest(request)) {
		const write = recordListingView(db, params.guildId).catch(() => {});
		const ctx = (platform as any)?.context;
		if (ctx?.waitUntil) ctx.waitUntil(write);
		else await write;
	}

	return {
		listing,
		// Streamed. True only when the visitor manages this server.
		canManage: getManageableGuilds(cookies, platform).then((guilds) =>
			guilds.some((guild) => guild.id === params.guildId)
		),
		categoryLabel:
			LISTING_CATEGORIES.find((c) => c.value === listing.category)?.label || listing.category,
	};
}
