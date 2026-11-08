/**
 * The announcement channel: where SpaceBot posts about global changes and other
 * important alerts for one server. A server manager picks it on the Settings page.
 * With none picked, nothing is posted anywhere: an alert is never sent to a channel
 * the server did not choose.
 *
 * It lives in its own column (`guild_settings.announcement_channel_id`, migration 0089)
 * and is written by its own query. `saveGuildSettings` rewrites the other columns and
 * must not be able to clear this one.
 */

import { log } from '../log.js';

type Db = any;
type Discord = any;

const SNOWFLAKE = /^\d{17,20}$/;

export async function getAnnouncementChannel(db: Db, guildId: string): Promise<string | null> {
	try {
		const row: any = await db
			.prepare(`SELECT announcement_channel_id FROM guild_settings WHERE guild_id = ?`)
			.bind(guildId)
			.first();
		return row?.announcement_channel_id || null;
	} catch (err) {
		log.error('[Announcements] Could not read the channel:', err);
		return null;
	}
}

/**
 * Set or clear (null) the channel. Returns an error message, or null when it saved.
 * A channel that the synced channel list knows and that is not a text or announcement
 * channel is refused. One it does not know yet is allowed.
 */
export async function setAnnouncementChannel(
	db: Db,
	guildId: string,
	channelId: string | null
): Promise<string | null> {
	if (channelId !== null) {
		if (!SNOWFLAKE.test(channelId)) return 'That is not a channel.';
		try {
			const known: any = await db
				.prepare(`SELECT type FROM guild_channels WHERE guild_id = ? AND channel_id = ?`)
				.bind(guildId, channelId)
				.first();
			if (known && known.type !== 0 && known.type !== 5) {
				return 'Pick a text or announcement channel.';
			}
		} catch {
			// No channel list to check against: carry on.
		}
	}
	await db
		.prepare(
			`INSERT INTO guild_settings (guild_id, announcement_channel_id) VALUES (?, ?)
			 ON CONFLICT(guild_id) DO UPDATE SET announcement_channel_id = excluded.announcement_channel_id`
		)
		.bind(guildId, channelId)
		.run();
	return null;
}

export type AnnounceResult =
	{ sent: true; messageId: string | null } | { sent: false; reason: 'no_channel' | 'failed' };

/** Post to a server's announcement channel. Mentions are off: an alert pings nobody. */
export async function postAnnouncement(
	db: Db,
	discord: Discord,
	guildId: string,
	content: string
): Promise<AnnounceResult> {
	const channelId = await getAnnouncementChannel(db, guildId);
	if (!channelId) return { sent: false, reason: 'no_channel' };
	try {
		const posted: any = await discord.channels.send(channelId, {
			content: content.slice(0, 2000),
			allowed_mentions: { parse: [] },
		});
		return { sent: true, messageId: posted?.id ?? null };
	} catch (err: any) {
		log.warn(`[Announcements] Could not post in ${guildId}/${channelId}: ${err?.message}`);
		return { sent: false, reason: 'failed' };
	}
}
