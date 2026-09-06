/**
 * Channel presets and member-owned ("managed") channels.
 *
 * `channel_presets` is the guild admin's policy: what gets created, who may
 * create it, what its creator may then do to it, and how it ends.
 * `managed_channels` is one row per live room — it authorizes every management
 * verb and it is the only thing the reaper scans.
 *
 * Policy decisions live in `$lib/discord/managed-channel-policy.js`; this module
 * only reads and writes rows.
 */

import { log } from '../log.js';
import { CHANNEL_TYPE_VOICE } from '../discord/managed-channel-policy.js';

/** Columns stored as JSON text. */
const JSON_COLUMNS = [
	'allow_role_ids',
	'deny_role_ids',
	'owner_can',
	'owner_allow',
	'everyone_deny',
];

function parseJsonColumn(value, fallback = []) {
	if (Array.isArray(value)) return value;
	if (value === null || value === undefined || value === '') return fallback;
	try {
		const parsed = JSON.parse(String(value));
		return Array.isArray(parsed) ? parsed : fallback;
	} catch {
		return fallback;
	}
}

/** Turn a stored preset row into the shape the rest of the code expects. */
export function parseChannelPreset(row) {
	if (!row) return null;
	const preset: Record<string, any> = { ...row };
	for (const column of JSON_COLUMNS) {
		preset[column] = parseJsonColumn(row[column]);
	}
	preset.enabled = row.enabled === 1 || row.enabled === true;
	return preset;
}

const PRESET_WRITABLE_FIELDS = [
	'name',
	'enabled',
	'channel_type',
	'parent_id',
	'name_pattern',
	'default_user_limit',
	'lobby_channel_id',
	'allow_role_ids',
	'deny_role_ids',
	'lifetime_mode',
	'ttl_minutes',
	'idle_minutes',
	'grace_minutes',
	'extend_minutes',
	'max_extensions',
	'max_per_user',
	'max_per_guild',
	'max_renames',
	'owner_can',
	'owner_allow',
	'everyone_deny',
];

function serializePresetValue(field, value) {
	if (JSON_COLUMNS.includes(field)) {
		return JSON.stringify(Array.isArray(value) ? value : []);
	}
	if (field === 'enabled') return value ? 1 : 0;
	return value ?? null;
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export async function listChannelPresets(db, guildId) {
	if (!db || !guildId) return [];
	try {
		const result = await db
			.prepare(
				`SELECT * FROM channel_presets WHERE guild_id = ? ORDER BY name COLLATE NOCASE`
			)
			.bind(guildId)
			.all();
		return (result.results || []).map(parseChannelPreset);
	} catch (error) {
		log.error('[ManagedChannels] Failed to list presets:', error);
		return [];
	}
}

export async function getChannelPreset(db, guildId, presetId) {
	if (!db || !guildId || !presetId) return null;
	try {
		const row = await db
			.prepare(`SELECT * FROM channel_presets WHERE id = ? AND guild_id = ?`)
			.bind(presetId, guildId)
			.first();
		return parseChannelPreset(row);
	} catch (error) {
		log.error('[ManagedChannels] Failed to get preset:', error);
		return null;
	}
}

/** Look up the preset a lobby voice channel drives, if any. */
export async function getChannelPresetByLobby(db, guildId, lobbyChannelId) {
	if (!db || !guildId || !lobbyChannelId) return null;
	try {
		const row = await db
			.prepare(
				`SELECT * FROM channel_presets
         WHERE guild_id = ? AND lobby_channel_id = ? AND enabled = 1`
			)
			.bind(guildId, String(lobbyChannelId))
			.first();
		return parseChannelPreset(row);
	} catch (error) {
		log.error('[ManagedChannels] Failed to get preset by lobby:', error);
		return null;
	}
}

/** The preset a `/room` command falls back to when none is named. */
export async function getDefaultChannelPreset(db, guildId) {
	if (!db || !guildId) return null;
	try {
		const row = await db
			.prepare(
				`SELECT * FROM channel_presets
         WHERE guild_id = ? AND enabled = 1
         ORDER BY id LIMIT 1`
			)
			.bind(guildId)
			.first();
		return parseChannelPreset(row);
	} catch (error) {
		log.error('[ManagedChannels] Failed to get default preset:', error);
		return null;
	}
}

export async function createChannelPreset(db, guildId, data: Record<string, any> = {}) {
	if (!db || !guildId) return { success: false, error: 'Database or guild missing' };
	if (!data.name) return { success: false, error: 'Preset name is required' };

	const fields = PRESET_WRITABLE_FIELDS.filter((field) => data[field] !== undefined);
	const columns = ['guild_id', ...fields];
	const placeholders = columns.map(() => '?').join(', ');
	const values = [guildId, ...fields.map((field) => serializePresetValue(field, data[field]))];

	try {
		const result = await db
			.prepare(`INSERT INTO channel_presets (${columns.join(', ')}) VALUES (${placeholders})`)
			.bind(...values)
			.run();
		return { success: true, id: result.meta?.last_row_id };
	} catch (error) {
		log.error('[ManagedChannels] Failed to create preset:', error);
		return { success: false, error: error.message };
	}
}

export async function updateChannelPreset(
	db,
	guildId,
	presetId,
	updates: Record<string, any> = {}
) {
	if (!db || !guildId || !presetId) return { success: false, error: 'Missing identifiers' };

	const fields = PRESET_WRITABLE_FIELDS.filter((field) => updates[field] !== undefined);
	if (fields.length === 0) return { success: true, updated: 0 };

	const assignments = fields.map((field) => `${field} = ?`);
	assignments.push(`updated_at = CURRENT_TIMESTAMP`);
	const values = fields.map((field) => serializePresetValue(field, updates[field]));

	try {
		const result = await db
			.prepare(
				`UPDATE channel_presets SET ${assignments.join(', ')} WHERE id = ? AND guild_id = ?`
			)
			.bind(...values, presetId, guildId)
			.run();
		return { success: true, updated: result.meta?.changes ?? 0 };
	} catch (error) {
		log.error('[ManagedChannels] Failed to update preset:', error);
		return { success: false, error: error.message };
	}
}

export async function deleteChannelPreset(db, guildId, presetId) {
	if (!db || !guildId || !presetId) return { success: false, error: 'Missing identifiers' };
	try {
		await db
			.prepare(`DELETE FROM channel_presets WHERE id = ? AND guild_id = ?`)
			.bind(presetId, guildId)
			.run();
		return { success: true };
	} catch (error) {
		log.error('[ManagedChannels] Failed to delete preset:', error);
		return { success: false, error: error.message };
	}
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

export async function recordManagedChannel(db, room: Record<string, any>) {
	if (!db) return { success: false, error: 'Database missing' };
	try {
		const result = await db
			.prepare(
				`INSERT INTO managed_channels (
           guild_id, channel_id, preset_id, owner_user_id, owner_user_name,
           channel_name, channel_type, expires_at, last_occupied_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
			)
			.bind(
				String(room.guild_id),
				String(room.channel_id),
				room.preset_id ?? null,
				String(room.owner_user_id),
				room.owner_user_name ?? null,
				room.channel_name ?? null,
				room.channel_type ?? CHANNEL_TYPE_VOICE,
				room.expires_at ?? null
			)
			.run();
		return { success: true, id: result.meta?.last_row_id };
	} catch (error) {
		log.error('[ManagedChannels] Failed to record room:', error);
		return { success: false, error: error.message };
	}
}

/** The active room row for a channel, or null. */
export async function getManagedChannel(db, channelId) {
	if (!db || !channelId) return null;
	try {
		return await db
			.prepare(`SELECT * FROM managed_channels WHERE channel_id = ? AND status = 'active'`)
			.bind(String(channelId))
			.first();
	} catch (error) {
		log.error('[ManagedChannels] Failed to get room:', error);
		return null;
	}
}

/**
 * The caller's own active room in this guild.
 *
 * Every management verb resolves through here rather than trusting a channel id
 * from the interaction, so `/room kick` can never reach somebody else's room.
 */
export async function getOwnedManagedChannel(db, guildId, ownerUserId, channelId = null) {
	if (!db || !guildId || !ownerUserId) return null;
	try {
		if (channelId) {
			return await db
				.prepare(
					`SELECT * FROM managed_channels
           WHERE guild_id = ? AND owner_user_id = ? AND channel_id = ? AND status = 'active'`
				)
				.bind(guildId, String(ownerUserId), String(channelId))
				.first();
		}
		return await db
			.prepare(
				`SELECT * FROM managed_channels
         WHERE guild_id = ? AND owner_user_id = ? AND status = 'active'
         ORDER BY created_at DESC LIMIT 1`
			)
			.bind(guildId, String(ownerUserId))
			.first();
	} catch (error) {
		log.error('[ManagedChannels] Failed to get owned room:', error);
		return null;
	}
}

export async function countActiveRoomsForUser(db, guildId, ownerUserId, presetId = null) {
	if (!db || !guildId || !ownerUserId) return 0;
	try {
		const row = presetId
			? await db
					.prepare(
						`SELECT COUNT(*) AS count FROM managed_channels
             WHERE guild_id = ? AND owner_user_id = ? AND preset_id = ? AND status = 'active'`
					)
					.bind(guildId, String(ownerUserId), presetId)
					.first()
			: await db
					.prepare(
						`SELECT COUNT(*) AS count FROM managed_channels
             WHERE guild_id = ? AND owner_user_id = ? AND status = 'active'`
					)
					.bind(guildId, String(ownerUserId))
					.first();
		return Number(row?.count ?? 0);
	} catch (error) {
		log.error('[ManagedChannels] Failed to count user rooms:', error);
		return 0;
	}
}

export async function countActiveRoomsForGuild(db, guildId, presetId = null) {
	if (!db || !guildId) return 0;
	try {
		const row = presetId
			? await db
					.prepare(
						`SELECT COUNT(*) AS count FROM managed_channels
             WHERE guild_id = ? AND preset_id = ? AND status = 'active'`
					)
					.bind(guildId, presetId)
					.first()
			: await db
					.prepare(
						`SELECT COUNT(*) AS count FROM managed_channels
             WHERE guild_id = ? AND status = 'active'`
					)
					.bind(guildId)
					.first();
		return Number(row?.count ?? 0);
	} catch (error) {
		log.error('[ManagedChannels] Failed to count guild rooms:', error);
		return 0;
	}
}

export async function listActiveManagedChannels(db, guildId) {
	if (!db || !guildId) return [];
	try {
		const result = await db
			.prepare(
				`SELECT * FROM managed_channels
         WHERE guild_id = ? AND status = 'active'
         ORDER BY created_at DESC`
			)
			.bind(guildId)
			.all();
		return result.results || [];
	} catch (error) {
		log.error('[ManagedChannels] Failed to list rooms:', error);
		return [];
	}
}

/**
 * Every active room, with its preset joined on.
 *
 * The reaper's only read. Returns nothing at all when no rooms exist, which is
 * the common case and keeps the per-minute job free — whole-guild scanning was
 * already the largest D1 rows-read source on this account.
 */
export async function listRoomsForReaping(db, limit = 500) {
	if (!db) return [];
	try {
		const result = await db
			.prepare(
				`SELECT
           m.*,
           p.lifetime_mode, p.idle_minutes, p.grace_minutes, p.ttl_minutes,
           p.max_extensions, p.channel_type AS preset_channel_type
         FROM managed_channels m
         LEFT JOIN channel_presets p ON p.id = m.preset_id
         WHERE m.status = 'active'
         ORDER BY m.id
         LIMIT ?`
			)
			.bind(limit)
			.all();
		return result.results || [];
	} catch (error) {
		log.error('[ManagedChannels] Failed to list rooms for reaping:', error);
		return [];
	}
}

/** Human occupancy per channel, for the guilds that have rooms. */
export async function getHumanOccupancy(db, channelIds: string[]) {
	const counts = new Map<string, number>();
	if (!db || !Array.isArray(channelIds) || channelIds.length === 0) return counts;

	try {
		const placeholders = channelIds.map(() => '?').join(', ');
		const result = await db
			.prepare(
				`SELECT channel_id, COUNT(*) AS count
         FROM live_voice_states
         WHERE channel_id IN (${placeholders}) AND is_bot = 0
         GROUP BY channel_id`
			)
			.bind(...channelIds.map(String))
			.all();
		for (const row of result.results || []) {
			counts.set(String(row.channel_id), Number(row.count ?? 0));
		}
	} catch (error) {
		log.error('[ManagedChannels] Failed to read occupancy:', error);
	}
	return counts;
}

/** Record that a room is currently occupied (clears the idle countdown). */
export async function markRoomOccupied(db, channelId) {
	if (!db || !channelId) return;
	try {
		await db
			.prepare(
				`UPDATE managed_channels
         SET empty_since = NULL, last_occupied_at = CURRENT_TIMESTAMP
         WHERE channel_id = ? AND status = 'active'`
			)
			.bind(String(channelId))
			.run();
	} catch (error) {
		log.error('[ManagedChannels] Failed to mark room occupied:', error);
	}
}

/** Start the idle countdown the first time a room is seen empty. */
export async function markRoomEmpty(db, channelId) {
	if (!db || !channelId) return;
	try {
		await db
			.prepare(
				`UPDATE managed_channels
         SET empty_since = CURRENT_TIMESTAMP
         WHERE channel_id = ? AND status = 'active' AND empty_since IS NULL`
			)
			.bind(String(channelId))
			.run();
	} catch (error) {
		log.error('[ManagedChannels] Failed to mark room empty:', error);
	}
}

/**
 * Close a room's ownership row.
 *
 * Called by the reaper, by `/room delete`, and by the gateway when a channel is
 * deleted by hand in Discord — a room whose channel is gone is never left
 * dangling as `active`.
 */
export async function closeManagedChannel(db, channelId, reason = 'reaped') {
	if (!db || !channelId) return { success: false };
	try {
		const result = await db
			.prepare(
				`UPDATE managed_channels
         SET status = 'closed', closed_at = CURRENT_TIMESTAMP, close_reason = ?
         WHERE channel_id = ? AND status = 'active'`
			)
			.bind(String(reason), String(channelId))
			.run();
		return { success: true, closed: result.meta?.changes ?? 0 };
	} catch (error) {
		log.error('[ManagedChannels] Failed to close room:', error);
		return { success: false, error: error.message };
	}
}

/** Apply a management verb's bookkeeping (name, counters, lock state, owner). */
export async function updateManagedChannel(db, channelId, updates: Record<string, any> = {}) {
	if (!db || !channelId) return { success: false };

	const allowed = [
		'channel_name',
		'owner_user_id',
		'owner_user_name',
		'locked',
		'expires_at',
		'renames_used',
		'extensions_used',
	];
	const fields = allowed.filter((field) => updates[field] !== undefined);
	if (fields.length === 0) return { success: true };

	try {
		await db
			.prepare(
				`UPDATE managed_channels SET ${fields.map((f) => `${f} = ?`).join(', ')}
         WHERE channel_id = ? AND status = 'active'`
			)
			.bind(...fields.map((field) => updates[field]), String(channelId))
			.run();
		return { success: true };
	} catch (error) {
		log.error('[ManagedChannels] Failed to update room:', error);
		return { success: false, error: error.message };
	}
}
