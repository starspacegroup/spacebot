/**
 * Reap expired member-owned rooms.
 *
 * Runs on the minute tick (a superadmin workflow, like scheduled message
 * dispatch). Two things keep it cheap, which matters because per-minute
 * whole-guild voice work was already the largest D1 rows-read source on this
 * account: it reads `managed_channels` first and does nothing at all when no
 * rooms exist, and it reads occupancy straight out of `live_voice_states`
 * rather than asking the gateway.
 */

import { log } from '../log.js';
import { createDiscordRestClient } from '../discord/rest-client.js';
import {
	closeManagedChannel,
	getHumanOccupancy,
	listRoomsForReaping,
	markRoomEmpty,
	markRoomOccupied,
} from '../db/managed-channels.js';
import { CHANNEL_TYPE_VOICE, evaluateRoomExpiry } from '../discord/managed-channel-policy.js';

/** Rebuild the policy the room was created under from the joined columns. */
function presetFromRow(row) {
	return {
		lifetime_mode: row.lifetime_mode || 'idle',
		idle_minutes: row.idle_minutes ?? 15,
		grace_minutes: row.grace_minutes ?? 5,
		ttl_minutes: row.ttl_minutes ?? 120,
		max_extensions: row.max_extensions ?? 0,
		channel_type: row.preset_channel_type ?? row.channel_type,
	};
}

/**
 * @param db        D1 database.
 * @param botToken  Discord bot token, for the channel deletes.
 * @param now       Clock, injectable for tests.
 */
export async function reapManagedChannels(db, botToken, now = new Date()) {
	const summary = {
		scanned: 0,
		occupiedMarked: 0,
		emptyMarked: 0,
		reaped: 0,
		alreadyGone: 0,
		failed: 0,
	};

	if (!db) return { ...summary, error: 'Database not available' };

	const rooms = await listRoomsForReaping(db);
	summary.scanned = rooms.length;
	// The common case: nothing open, so the minute tick costs one indexed read.
	if (rooms.length === 0) return summary;

	const voiceChannelIds = rooms
		.filter((room) => Number(room.channel_type) === CHANNEL_TYPE_VOICE)
		.map((room) => String(room.channel_id));
	const occupancy = await getHumanOccupancy(db, voiceChannelIds);

	const discord = botToken ? createDiscordRestClient(botToken) : null;

	for (const room of rooms) {
		const isVoice = Number(room.channel_type) === CHANNEL_TYPE_VOICE;
		const occupied = isVoice && (occupancy.get(String(room.channel_id)) ?? 0) > 0;

		// Record the transition before deciding, so the idle countdown starts
		// from the first scan that saw the room empty rather than from whenever
		// the last person happened to leave.
		if (isVoice) {
			if (occupied && room.empty_since) {
				await markRoomOccupied(db, room.channel_id);
				summary.occupiedMarked++;
				room.empty_since = null;
			} else if (!occupied && !room.empty_since) {
				await markRoomEmpty(db, room.channel_id);
				summary.emptyMarked++;
				// Only the next scan can act on it — that is the point.
				room.empty_since = now.toISOString();
			}
		}

		const decision = evaluateRoomExpiry(room, presetFromRow(room), occupied, now);
		if (!decision.due) continue;

		if (!discord) {
			summary.failed++;
			continue;
		}

		try {
			await discord.channels.delete(room.channel_id, `Room expired (${decision.reason})`);
			summary.reaped++;
		} catch (error) {
			if (error?.status === 404) {
				// Deleted by hand in Discord since the last scan. Closing the row
				// is still the right outcome.
				summary.alreadyGone++;
			} else {
				log.error(
					`[ManagedChannels] Failed to delete room ${room.channel_id}:`,
					error?.message || error
				);
				summary.failed++;
				continue;
			}
		}

		await closeManagedChannel(
			db,
			room.channel_id,
			decision.reason === 'expired' ? 'expired' : 'idle_timeout'
		);
	}

	if (summary.reaped > 0 || summary.failed > 0) {
		log.info(
			`[ManagedChannels] Reaped ${summary.reaped}/${summary.scanned} rooms ` +
				`(${summary.alreadyGone} already gone, ${summary.failed} failed)`
		);
	}

	return summary;
}
