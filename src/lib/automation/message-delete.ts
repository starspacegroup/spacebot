/**
 * Shared message-delete logic for the three "delete a user's messages" / "delete
 * messages mentioning a user" automation actions.
 *
 * This is the single implementation used by BOTH runtimes:
 *   - the edge automation engine (`engine.ts`, via the REST shim client), and
 *   - the Discord gateway (`gateway.ts`, via the real discord.js client).
 *
 * Both provide the same discord.js-shaped client surface
 * (`guilds.fetch` / `channels.fetch` / `channel.messages.fetch({ limit, before })`
 * / `channel.bulkDelete` / `message.delete()` / `message.mentions.has()`), so the
 * paginated lookback lives here once instead of being copy-pasted (and drifting)
 * in each. The durable purge workflow uses a separate resumable state machine
 * ([[message-purge]]); this is the inline, run-to-completion variant.
 */

import { log } from '../log.js';

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

export interface PurgeMessagesParams {
	guildId: string;
	/** 'ALL'/empty for every text channel, or a comma-separated channel-id list. */
	channelIds?: string | null;
	/** Reject 'ALL'/empty (mentioned-messages requires explicit channels). */
	requireExplicitChannels?: boolean;
	/** Predicate deciding whether a message is a deletion target. */
	match: (message: any) => boolean;
	/** Stop after deleting this many messages across all channels; null = no cap. */
	maxMessages: number | null;
	/** Only delete messages newer than this many days; null = no age limit. */
	maxAgeDays?: number | null;
	skipPinned?: boolean;
	/** Global lookback ceiling: stop paging once this many messages are scanned. */
	maxScan: number;
	/** Delay between individual (>14-day) deletes, for rate limits. */
	sleepMs?: number;
	/** Optional per-channel notification (used for gateway logging). */
	onChannelDeleted?: (channel: any, deleted: number) => void;
}

export interface PurgeMessagesResult {
	totalDeleted: number;
	totalScanned: number;
	channelsProcessed: number;
	channelResults: Record<string, { deleted?: number; error?: string }>;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Page back through channel history collecting matching messages and delete
 * them, bounded by `maxMessages` (quota) and `maxScan` (lookback ceiling).
 * Recent (<14 day) messages go through one bulk-delete call; older ones are
 * deleted individually with a pause between them.
 */
export async function purgeMessages(
	discord: any,
	params: PurgeMessagesParams
): Promise<PurgeMessagesResult> {
	const {
		guildId,
		channelIds,
		requireExplicitChannels = false,
		match,
		maxMessages,
		maxAgeDays = null,
		skipPinned = false,
		maxScan,
		sleepMs = 500,
		onChannelDeleted,
	} = params;

	const guild = await discord.guilds.fetch(guildId).catch(() => null);
	if (!guild) throw new Error('Guild not found');

	let channelsToProcess: string[];
	if (!channelIds || channelIds === 'ALL') {
		if (requireExplicitChannels) throw new Error('No channels specified');
		const allChannels = await guild.channels.fetch();
		channelsToProcess = Array.from(allChannels.values())
			.filter((c: any) => c && c.isTextBased?.() && !c.isVoiceBased?.())
			.map((c: any) => c.id);
	} else {
		channelsToProcess = channelIds
			.split(',')
			.map((id) => id.trim())
			.filter(Boolean);
	}

	const cutoffTime = maxAgeDays ? Date.now() - maxAgeDays * 24 * 60 * 60 * 1000 : null;

	let totalDeleted = 0;
	let totalScanned = 0;
	const channelResults: Record<string, { deleted?: number; error?: string }> = {};

	for (const channelId of channelsToProcess) {
		// Stop if we've hit the message quota or the lookback ceiling.
		if (maxMessages != null && totalDeleted >= maxMessages) break;
		if (totalScanned >= maxScan) break;

		const channel = await discord.channels.fetch(channelId).catch(() => null);
		if (!channel || !channel.messages) {
			channelResults[channelId] = { error: 'Channel not found or not text-based' };
			continue;
		}

		try {
			const remainingQuota = maxMessages != null ? maxMessages - totalDeleted : Infinity;

			const toDelete: any[] = [];
			let beforeId: string | undefined = undefined;

			while (toDelete.length < remainingQuota && totalScanned < maxScan) {
				const batch = await channel.messages.fetch({ limit: 100, before: beforeId });
				if (!batch || batch.size === 0) break;
				totalScanned += batch.size;

				// Messages arrive newest → oldest; the last is the cursor for the
				// next (older) page.
				const batchArr: any[] = Array.from(batch.values());
				beforeId = batchArr[batchArr.length - 1].id;

				let reachedCutoff = false;
				for (const m of batchArr) {
					// Older than the cutoff → everything further back is too.
					if (cutoffTime && m.createdTimestamp < cutoffTime) {
						reachedCutoff = true;
						break;
					}
					if (!match(m)) continue;
					if (skipPinned && m.pinned) continue;
					toDelete.push(m);
					if (toDelete.length >= remainingQuota) break;
				}

				if (reachedCutoff) break;
				if (batch.size < 100) break; // no more history
			}

			if (toDelete.length === 0) {
				channelResults[channelId] = { deleted: 0 };
				continue;
			}

			let deleted = 0;

			// Bulk-delete recent (<14 day) messages in one call.
			const recentMessages = toDelete.filter(
				(m: any) => Date.now() - m.createdTimestamp < FOURTEEN_DAYS_MS
			);
			if (recentMessages.length > 1) {
				await channel
					.bulkDelete(recentMessages)
					.catch((e: any) => log.error('[MessageDelete] bulkDelete error:', e));
				deleted += recentMessages.length;
			} else if (recentMessages.length === 1) {
				await recentMessages[0].delete().catch(() => {});
				deleted++;
			}

			// Delete older messages individually, paced for rate limits.
			const oldMessages = toDelete.filter(
				(m: any) => Date.now() - m.createdTimestamp >= FOURTEEN_DAYS_MS
			);
			for (const msg of oldMessages) {
				await msg.delete().catch(() => {});
				deleted++;
				if (sleepMs > 0) await wait(sleepMs);
			}

			channelResults[channelId] = { deleted };
			totalDeleted += deleted;
			onChannelDeleted?.(channel, deleted);
		} catch (err: any) {
			channelResults[channelId] = { error: err?.message || 'Failed to delete' };
		}
	}

	return {
		totalDeleted,
		totalScanned,
		channelsProcessed: channelsToProcess.length,
		channelResults,
	};
}

/** Delete a user's own messages (DELETE_USER_MESSAGES). */
export function deleteUserMessages(
	discord: any,
	opts: {
		guildId: string;
		channelIds?: string | null;
		userId: string;
		maxMessages: number | null;
		maxAgeDays: number | null;
		skipPinned: boolean;
		maxScan: number;
		sleepMs?: number;
		onChannelDeleted?: (channel: any, deleted: number) => void;
	}
): Promise<PurgeMessagesResult> {
	return purgeMessages(discord, {
		guildId: opts.guildId,
		channelIds: opts.channelIds,
		match: (m) => m.author?.id === opts.userId,
		maxMessages: opts.maxMessages,
		maxAgeDays: opts.maxAgeDays,
		skipPinned: opts.skipPinned,
		maxScan: opts.maxScan,
		sleepMs: opts.sleepMs,
		onChannelDeleted: opts.onChannelDeleted,
	});
}

/** Delete up to `limit` of a user's messages (DELETE_MESSAGES). */
export function deleteMessagesByUser(
	discord: any,
	opts: {
		guildId: string;
		channelIds?: string | null;
		userId: string;
		limit: number;
		maxScan: number;
		sleepMs?: number;
		onChannelDeleted?: (channel: any, deleted: number) => void;
	}
): Promise<PurgeMessagesResult> {
	return purgeMessages(discord, {
		guildId: opts.guildId,
		channelIds: opts.channelIds,
		match: (m) => m.author?.id === opts.userId,
		maxMessages: opts.limit,
		maxAgeDays: null,
		skipPinned: false,
		maxScan: opts.maxScan,
		sleepMs: opts.sleepMs,
		onChannelDeleted: opts.onChannelDeleted,
	});
}

/** Delete up to `limit` messages that mention a user (DELETE_MENTIONED_MESSAGES). */
export function deleteMentionedMessages(
	discord: any,
	opts: {
		guildId: string;
		channelIds?: string | null;
		userId: string;
		limit: number;
		maxScan: number;
		sleepMs?: number;
		onChannelDeleted?: (channel: any, deleted: number) => void;
	}
): Promise<PurgeMessagesResult> {
	return purgeMessages(discord, {
		guildId: opts.guildId,
		channelIds: opts.channelIds,
		requireExplicitChannels: true,
		match: (m) => m.mentions?.has(opts.userId),
		maxMessages: opts.limit,
		maxAgeDays: null,
		skipPinned: false,
		maxScan: opts.maxScan,
		sleepMs: opts.sleepMs,
		onChannelDeleted: opts.onChannelDeleted,
	});
}
