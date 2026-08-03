/**
 * POST /api/admin/[serverId]/listing/invite
 *
 * Has the bot produce a permanent invite for this guild, so an admin never has
 * to paste one — the most likely way for a listing's Join button to break is a
 * hand-pasted invite that expires.
 *
 * Returns the URL for the form to fill; it is not saved here.
 */

import { json } from '@sveltejs/kit';
import { resolvePermanentInvite } from '$lib/discord/invites.js';
import { getGuildMetadata } from '$lib/db/guild-metadata.js';
import { requireListingAdmin } from '$lib/server/listing-assist-auth.js';
import { consumeQuota } from '$lib/server/rate-limit.js';
import { log } from '$lib/db/logger.js';
import { getEnv } from '$lib/env.js';

/** Creating invites is a real side effect on someone's server — keep it bounded. */
const QUOTA = { max: 10, windowSeconds: 600 };

export async function POST({ params, cookies, platform }) {
	const denied = await requireListingAdmin({ params, cookies, platform });
	if (denied) return denied;

	const serverId = params.serverId;
	const env = (platform as any)?.env || {};
	const db = env.DB;
	const botToken = getEnv('DISCORD_BOT_TOKEN', platform);

	if (!botToken) {
		return json(
			{ error: 'The bot token is not configured on this deployment.' },
			{ status: 503 }
		);
	}

	const allowance = await consumeQuota(db, 'listing-invite', serverId, QUOTA);
	if (!allowance) {
		return json(
			{
				error: 'Too many invite requests for this server just now. Try again in a few minutes.',
			},
			{ status: 429 }
		);
	}

	const metadata = db ? await getGuildMetadata(db, serverId) : null;

	const result = await resolvePermanentInvite(botToken, serverId, {
		vanityUrlCode: metadata?.vanity_url_code,
		rulesChannelId: metadata?.rules_channel_id,
		systemChannelId: metadata?.system_channel_id,
		botUserId: getEnv('DISCORD_CLIENT_ID', platform),
	});

	if (result.ok && result.url) {
		return json({ invite_url: result.url, source: result.source });
	}

	log.warn(`[ListingInvite] Could not resolve an invite for guild ${serverId}: ${result.error}`);
	return json({ error: result.error || 'Could not create an invite.' }, { status: 502 });
}
