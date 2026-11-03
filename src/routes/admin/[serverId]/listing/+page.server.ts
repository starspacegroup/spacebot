import { fail, redirect } from '@sveltejs/kit';
import { log } from '$lib/db/logger.js';
import { getGuildMetadata } from '$lib/db/guild-metadata.js';
import {
	LISTING_CATEGORIES,
	LISTING_FRESHNESS_DAYS,
	MAX_DESCRIPTION,
	MAX_HEADLINE,
	MAX_TAGS,
	MAX_TAG_LENGTH,
	getGuildListing,
	getPublicListing,
	mergeListing,
	saveGuildListing,
	validateListing,
} from '$lib/db/server-listings.js';
import { hasFullAdminPermission, verifyGuildAdmin } from '$lib/discord/guilds.js';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';

/**
 * The public listing editor.
 *
 * This used to be a section inside Settings, saved together with everything else on that
 * page. One bad invite link then failed the whole settings save, and an unrelated settings
 * change re-submitted the public copy. It has its own page and its own save now.
 *
 * Access matches Settings: a superadmin or a full Administrator. A member with only
 * Manage Server sees an explanation instead of a silent bounce.
 */

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform, parent, params }) {
	if (!/^\d{17,20}$/.test(params.serverId)) {
		throw redirect(302, '/admin');
	}

	const parentData = await parent();
	const userId = cookies.get('discord_user_id');
	if (!userId) {
		throw redirect(302, '/login');
	}

	const serverId = params.serverId;
	const isSuperAdmin = checkIsSuperAdmin(userId, platform);
	const adminGuilds = parentData.adminGuilds || [];
	if (!isSuperAdmin && !adminGuilds.some((g) => g.id === serverId)) {
		throw redirect(302, '/admin');
	}

	const guild = adminGuilds.find((g) => g.id === serverId);
	const canEdit = isSuperAdmin || hasFullAdminPermission(guild);
	if (!canEdit) {
		return { serverId, guild, canEdit: false as const };
	}

	const db = (platform as any)?.env?.DB;
	const listing = db ? mergeListing(await getGuildListing(db, serverId)) : mergeListing(null);
	const metadata = db ? await getGuildMetadata(db, serverId) : null;

	// Ask the real public query, so "live" here can never disagree with what visitors see.
	const listingVisible =
		db && listing.listed ? Boolean(await getPublicListing(db, serverId)) : false;

	const iconHash = metadata?.icon || guild?.icon || null;
	const bannerHash = metadata?.banner || null;

	return {
		serverId,
		guild,
		canEdit: true as const,
		listing,
		listingVisible,
		categories: LISTING_CATEGORIES,
		freshnessDays: LISTING_FRESHNESS_DAYS,
		limits: {
			headline: MAX_HEADLINE,
			description: MAX_DESCRIPTION,
			tags: MAX_TAGS,
			tagLength: MAX_TAG_LENGTH,
		},
		// What the preview needs. Counts are Discord's own approximations, the same ones
		// the public pages use.
		server: {
			name: metadata?.name || guild?.name || 'Your server',
			iconUrl: iconHash
				? `https://cdn.discordapp.com/icons/${serverId}/${iconHash}.${String(iconHash).startsWith('a_') ? 'gif' : 'webp'}?size=128`
				: null,
			bannerUrl: bannerHash
				? `https://cdn.discordapp.com/banners/${serverId}/${bannerHash}.webp?size=480`
				: null,
			members: Number(metadata?.approximate_member_count || 0) || null,
			online: Number(metadata?.approximate_presence_count || 0) || null,
		},
	};
}

/** Same gate as the page, for the form action (actions have no parent() data). */
async function verifyActionAdmin(userId: string, serverId: string, platform: any, cookies: any) {
	if (checkIsSuperAdmin(userId, platform)) return null;
	const accessToken = cookies.get('discord_access_token');
	const verification = await verifyGuildAdmin(serverId, accessToken, cookies);
	if (!verification?.authorized || !hasFullAdminPermission(verification.guild)) {
		return fail(403, {
			success: false,
			message: 'You need the Administrator permission to change this listing.',
		});
	}
	return null;
}

/** @type {import('./$types').Actions} */
export const actions = {
	save: async ({ request, cookies, platform, params }) => {
		const userId = cookies.get('discord_user_id');
		const serverId = params.serverId;
		if (!userId || !/^\d{17,20}$/.test(serverId)) {
			return fail(401, { success: false, message: 'Not signed in.' });
		}

		const denied = await verifyActionAdmin(userId, serverId, platform, cookies);
		if (denied) return denied;

		const db = (platform as any)?.env?.DB;
		if (!db) return fail(503, { success: false, message: 'Database not available.' });

		const formData = await request.formData();
		const validation = validateListing({
			listed: formData.get('listed') === 'on',
			headline: formData.get('headline'),
			description: formData.get('description'),
			category: formData.get('category'),
			tags: formData.get('tags'),
			invite_url: formData.get('invite_url'),
			show_member_count: formData.get('show_member_count') === 'on',
			nsfw: formData.get('nsfw') === 'on',
		});

		if (!validation.ok) {
			return fail(400, {
				success: false,
				message: Object.values(validation.errors)[0] || 'This listing is not valid yet.',
				errors: validation.errors,
			});
		}

		const saved = await saveGuildListing(db, serverId, validation.value, userId);
		if (saved && saved.success === false) {
			log.error(`[Listing] Failed to save listing for ${serverId}: ${saved.error}`);
			return fail(500, { success: false, message: 'Could not save the listing.' });
		}

		return { success: true, message: 'Saved.', savedAt: Date.now() };
	},
};
