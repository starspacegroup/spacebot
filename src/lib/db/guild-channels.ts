/**
 * The public channel directory for a guild.
 *
 * The gateway watches Discord and sends a full list on start-up and on every
 * channel create, update or delete; this module stores it and reads it back.
 *
 * **Everything in this table is public.** The gateway sends only channels the
 * `@everyone` role can view, and `/api/channels/sync` drops the rooms members
 * made with `/room`. Both filters run before the write rather than at the API:
 * a staff channel that never reaches the database cannot be leaked by an
 * endpoint that forgets a `WHERE` clause, which is the same reason live voice
 * drops member names here rather than in a component.
 *
 * A sync is a full replacement per guild. A channel that is deleted, renamed or
 * made private simply stops arriving, and the row goes with it.
 */

import { log } from './logger.js';

/** Discord's numeric channel types, for callers that would rather not guess. */
export const CHANNEL_TYPES = {
	TEXT: 0,
	VOICE: 2,
	CATEGORY: 4,
	ANNOUNCEMENT: 5,
	STAGE: 13,
	FORUM: 15,
	MEDIA: 16,
} as const;

/** One channel, as stored and as served. */
export type GuildChannel = {
	channelId: string;
	name: string;
	type: number;
	topic: string | null;
	parentId: string | null;
	parentName: string | null;
	position: number;
};

type IncomingChannel = {
	channel_id?: unknown;
	name?: unknown;
	type?: unknown;
	topic?: unknown;
	parent_id?: unknown;
	parent_name?: unknown;
	position?: unknown;
};

const str = (value: unknown): string | null => {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
};

/**
 * Coerce one wire channel into a row, or `null` if it is unusable.
 *
 * A channel with no id or no name is dropped rather than stored blank: the
 * directory is rendered on a public page, and a nameless entry there is worse
 * than a missing one.
 */
export function normalizeChannel(input: IncomingChannel): GuildChannel | null {
	const channelId = str(input?.channel_id);
	const name = str(input?.name);
	if (!channelId || !name) return null;

	const type = Number(input?.type);
	const position = Number(input?.position);

	return {
		channelId,
		name,
		type: Number.isFinite(type) ? Math.trunc(type) : 0,
		topic: str(input?.topic),
		parentId: str(input?.parent_id),
		parentName: str(input?.parent_name),
		position: Number.isFinite(position) ? Math.trunc(position) : 0,
	};
}

/**
 * Replace a guild's whole directory.
 *
 * Deletes first, then inserts, in one batch so a reader never sees a partial
 * directory. An empty list is a legitimate sync — a guild the bot can see
 * nothing public in — and clears the table for that guild.
 */
export async function replaceGuildChannels(db, guildId: string, channels: IncomingChannel[] = []) {
	if (!db || !guildId) {
		return { success: false, error: 'Database or guildId missing', stored: 0 };
	}

	const rows = (Array.isArray(channels) ? channels : [])
		.map(normalizeChannel)
		.filter((row): row is GuildChannel => row !== null);

	// Discord can hand the same channel twice across a category and its
	// children when a sync races an update; last write wins.
	const unique = new Map(rows.map((row) => [row.channelId, row]));

	try {
		const statements = [
			db.prepare('DELETE FROM guild_channels WHERE guild_id = ?').bind(guildId),
		];

		for (const row of unique.values()) {
			statements.push(
				db
					.prepare(
						`
        INSERT INTO guild_channels (
          guild_id, channel_id, name, type, topic, parent_id, parent_name, position, synced_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `
					)
					.bind(
						guildId,
						row.channelId,
						row.name,
						row.type,
						row.topic,
						row.parentId,
						row.parentName,
						row.position
					)
			);
		}

		await db.batch(statements);
		return { success: true, stored: unique.size };
	} catch (error) {
		log.error('Failed to replace guild channels:', error);
		return { success: false, error: (error as Error).message, stored: 0 };
	}
}

/**
 * Read a guild's directory, in the order Discord shows it.
 *
 * Categories sort with their children rather than as a separate block, so a
 * caller can walk the list once and group as it goes.
 */
export async function getGuildChannels(db, guildId: string): Promise<GuildChannel[]> {
	if (!db || !guildId) return [];

	try {
		const { results } = await db
			.prepare(
				`
      SELECT channel_id, name, type, topic, parent_id, parent_name, position
      FROM guild_channels
      WHERE guild_id = ?
      ORDER BY COALESCE(parent_name, ''), position ASC, name ASC
    `
			)
			.bind(guildId)
			.all();

		return (results || []).map((row) => ({
			channelId: String(row.channel_id),
			name: String(row.name),
			type: Number(row.type),
			topic: row.topic ? String(row.topic) : null,
			parentId: row.parent_id ? String(row.parent_id) : null,
			parentName: row.parent_name ? String(row.parent_name) : null,
			position: Number(row.position) || 0,
		}));
	} catch (error) {
		log.error('Failed to read guild channels:', error);
		return [];
	}
}

/** When this guild's directory was last written, or `null` if never. */
export async function getGuildChannelsSyncedAt(db, guildId: string): Promise<string | null> {
	if (!db || !guildId) return null;

	try {
		const row = await db
			.prepare('SELECT MAX(synced_at) AS synced_at FROM guild_channels WHERE guild_id = ?')
			.bind(guildId)
			.first();
		return row?.synced_at ? String(row.synced_at) : null;
	} catch (error) {
		log.error('Failed to read guild channel sync time:', error);
		return null;
	}
}
