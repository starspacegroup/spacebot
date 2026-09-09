/**
 * External API v1 — the server's public channel directory
 *
 * GET /api/v1/channels
 * GET /api/v1/channels?type=text
 * GET /api/v1/channels?activity=30
 *
 * What a visitor would see in the sidebar without joining anything: name, type,
 * category, Discord ordering, and the channel's own topic where one is set.
 *
 * PUBLIC BY CONSTRUCTION. The gateway stores only channels the `@everyone` role
 * can view, and never a room SpaceBot created for a member — a private staff
 * channel is not filtered out here, it was never written. A caller can publish
 * this response verbatim, which is the point: it exists so a community site can
 * render "what the channels are for" without anyone maintaining a second copy
 * by hand.
 *
 * Grouped by category in the response rather than returned flat, because that
 * is how Discord shows it and how a reader expects to find a channel.
 *
 * `activity=<days>` adds how each channel is actually used — messages and
 * distinct posters, voice time and head count, when it is busiest, and whether
 * joining it makes the member a room. A directory of names and stale topics
 * cannot tell a newcomer which rooms are alive; this can. It is counts only,
 * never message text or who said it (see `channel-activity.ts`), and it costs
 * four extra aggregate queries, so it is opt-in rather than always on.
 *
 * Requires scope: channels:read
 * Auth: Bearer <api_key>
 */

import { json } from '@sveltejs/kit';
import { authenticateApiKey, hasScope } from '$lib/api-auth.js';
import {
	getGuildChannels,
	getGuildChannelsSyncedAt,
	CHANNEL_TYPES,
} from '$lib/db/guild-channels.js';
import { getChannelActivity, normalizeActivityDays } from '$lib/db/channel-activity.js';
import { log } from '$lib/db/logger.js';

/** Wire names for Discord's numeric types. Anything unmapped serves `other`. */
const TYPE_NAMES: Record<number, string> = {
	[CHANNEL_TYPES.TEXT]: 'text',
	[CHANNEL_TYPES.VOICE]: 'voice',
	[CHANNEL_TYPES.CATEGORY]: 'category',
	[CHANNEL_TYPES.ANNOUNCEMENT]: 'announcement',
	[CHANNEL_TYPES.STAGE]: 'stage',
	[CHANNEL_TYPES.FORUM]: 'forum',
	[CHANNEL_TYPES.MEDIA]: 'media',
};

export async function GET({ request, platform, url }) {
	const auth = await authenticateApiKey(request, platform);
	if (!auth.authenticated) {
		return json({ error: auth.error }, { status: auth.status });
	}

	if (!hasScope(auth, 'channels:read')) {
		return json({ error: 'Insufficient scope. Required: channels:read' }, { status: 403 });
	}

	const db = (platform as any)?.env?.DB;
	if (!db) {
		return json({ error: 'Database not available' }, { status: 500 });
	}

	try {
		const [channels, syncedAt] = await Promise.all([
			getGuildChannels(db, auth.guildId),
			getGuildChannelsSyncedAt(db, auth.guildId),
		]);

		const wanted = (url.searchParams.get('type') || '').trim().toLowerCase();

		// Categories are the grouping, never a result in their own right — a
		// caller asking for text channels does not want the headings too.
		const listed = channels
			.filter((channel) => channel.type !== CHANNEL_TYPES.CATEGORY)
			.map((channel) => ({
				id: channel.channelId,
				name: channel.name,
				type: TYPE_NAMES[channel.type] || 'other',
				topic: channel.topic,
				category: channel.parentName,
				category_id: channel.parentId,
				position: channel.position,
			}))
			.filter((channel) => !wanted || channel.type === wanted);

		// Category order follows the first channel in each, so the response
		// reproduces the sidebar rather than sorting alphabetically over it.
		const groups: {
			category: string | null;
			category_id: string | null;
			channels: typeof listed;
		}[] = [];
		for (const channel of listed) {
			let group = groups.find((candidate) => candidate.category_id === channel.category_id);
			if (!group) {
				group = {
					category: channel.category,
					category_id: channel.category_id,
					channels: [],
				};
				groups.push(group);
			}
			group.channels.push(channel);
		}

		// Asked for after the filters, so a `type=text` request never pays for the
		// voice numbers it is not going to render.
		const activityParam = url.searchParams.get('activity');
		if (activityParam !== null && activityParam !== 'false') {
			const days = normalizeActivityDays(
				activityParam === '' || activityParam === 'true' ? undefined : activityParam
			);
			const report = await getChannelActivity(
				db,
				auth.guildId,
				listed.map((channel) => channel.id),
				days
			);
			for (const channel of listed) {
				(channel as any).activity = report.channels[channel.id] || null;
			}
			return json({
				guild_id: auth.guildId,
				synced_at: syncedAt,
				count: listed.length,
				activity_days: report.days,
				timezone: report.timezone,
				categories: groups,
				channels: listed,
			});
		}

		return json({
			guild_id: auth.guildId,
			synced_at: syncedAt,
			count: listed.length,
			categories: groups,
			channels: listed,
		});
	} catch (error) {
		log.error('[API v1] Error fetching channels:', error);
		return json({ error: 'Failed to fetch channels' }, { status: 500 });
	}
}
