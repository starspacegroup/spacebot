/**
 * POST /api/admin/[serverId]/listing/suggest
 *
 * Drafts public-browser listing copy for a guild using its own Discord data.
 * Returns the draft for the admin to review — it is never saved here, and it
 * cannot publish anything: `listed` is only ever written by the settings form.
 */

import { json } from '@sveltejs/kit';
import { generateListingDraft } from '$lib/ai/listing-draft.js';
import { isAIEnabled } from '$lib/ai/chat.js';
import { getGuildMetadata } from '$lib/db/guild-metadata.js';
import { getGuildListing, mergeListing } from '$lib/db/server-listings.js';
import { requireListingAdmin } from '$lib/server/listing-assist-auth.js';
import { consumeQuota } from '$lib/server/rate-limit.js';
import { log } from '$lib/db/logger.js';
import { getEnv } from '$lib/env.js';

/** AI completions cost money; a drafting aid does not need to be spammable. */
const QUOTA = { max: 10, windowSeconds: 600 };

/** Channel names are the best signal for what a server is about. */
async function fetchChannelNames(botToken: string, guildId: string): Promise<string[]> {
	if (!botToken) return [];
	try {
		const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
			headers: { Authorization: `Bot ${botToken}` },
		});
		if (!res.ok) return [];
		const channels: any[] = await res.json();
		return (channels || [])
			.filter((c) => Number(c?.type) === 0 || Number(c?.type) === 15)
			.sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
			.map((c) => String(c?.name || '').trim())
			.filter(Boolean)
			.slice(0, 30);
	} catch {
		return [];
	}
}

export async function POST({ params, cookies, platform }) {
	const denied = await requireListingAdmin({ params, cookies, platform });
	if (denied) return denied;

	const serverId = params.serverId;
	const env = (platform as any)?.env || {};
	const db = env.DB;

	if (!isAIEnabled(env)) {
		return json(
			{ error: 'AI is not configured on this deployment, so drafting is unavailable.' },
			{ status: 503 }
		);
	}

	const allowance = await consumeQuota(db, 'listing-ai', serverId, QUOTA);
	if (!allowance) {
		return json(
			{ error: 'Too many drafts for this server just now. Try again in a few minutes.' },
			{ status: 429 }
		);
	}

	const metadata = db ? await getGuildMetadata(db, serverId) : null;
	const listing = mergeListing(db ? await getGuildListing(db, serverId) : null);
	const botToken = getEnv('DISCORD_BOT_TOKEN', platform);
	const channelNames = await fetchChannelNames(botToken, serverId);

	let features: string[] = [];
	try {
		features = Array.isArray(metadata?.features)
			? metadata.features
			: JSON.parse(String(metadata?.features || '[]'));
	} catch {
		features = [];
	}

	const result = await generateListingDraft(
		{
			name: metadata?.name,
			description: metadata?.description,
			memberCount: metadata?.approximate_member_count,
			features,
			channelNames,
			existingHeadline: listing.headline,
			existingDescription: listing.description,
		},
		env
	);

	if (!result.ok) {
		log.warn(`[ListingDraft] Draft failed for guild ${serverId}: ${result.error}`);
		return json({ error: result.error || 'Could not draft a listing.' }, { status: 502 });
	}

	return json({ draft: result.draft, remaining: allowance.remaining });
}
