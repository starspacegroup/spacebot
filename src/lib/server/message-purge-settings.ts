/**
 * Superadmin-configurable settings for the durable message purge, stored in the
 * `global_settings` key-value table. The batch cap is enforced Pages-side (in
 * /api/discord/purge/advance) because the orchestrator worker can't read D1 —
 * see [[message-purge]].
 */

import { getGlobalSetting, setGlobalSetting } from '../db/global-settings.js';

export const MAX_BATCHES_KEY = 'message_purge_max_batches';
export const CHECKPOINT_CONTINUE_KEY = 'message_purge_checkpoint_continue';

/** Default batches per run: the initial channel-resolution batch + 32 pages. */
export const DEFAULT_MAX_BATCHES = 33;
export const MIN_MAX_BATCHES = 2;
export const MAX_MAX_BATCHES = 500;

/** Hard ceiling on how many times a purge may re-enqueue itself to continue,
 * so a pathological sweep can't chain forever. */
export const MAX_CONTINUATIONS = 100;

export interface MessagePurgeSettings {
	/** Max scan batches before a run stops (or checkpoints). */
	maxBatches: number;
	/** When true, a run that hits the cap re-enqueues to continue automatically. */
	checkpointContinue: boolean;
}

function clampBatches(raw: number): number {
	if (!Number.isFinite(raw)) return DEFAULT_MAX_BATCHES;
	return Math.min(MAX_MAX_BATCHES, Math.max(MIN_MAX_BATCHES, Math.floor(raw)));
}

export async function getMessagePurgeSettings(db): Promise<MessagePurgeSettings> {
	const [batchesStr, continueStr] = await Promise.all([
		getGlobalSetting(db, MAX_BATCHES_KEY, String(DEFAULT_MAX_BATCHES)),
		getGlobalSetting(db, CHECKPOINT_CONTINUE_KEY, 'false'),
	]);
	return {
		maxBatches: clampBatches(Number(batchesStr)),
		checkpointContinue: continueStr === 'true',
	};
}

export async function setMessagePurgeSettings(
	db,
	updates: Partial<MessagePurgeSettings>
): Promise<{ success: boolean; error?: string }> {
	try {
		if (updates.maxBatches !== undefined) {
			const result = await setGlobalSetting(
				db,
				MAX_BATCHES_KEY,
				String(clampBatches(updates.maxBatches))
			);
			if (!result.success) return result;
		}
		if (updates.checkpointContinue !== undefined) {
			const result = await setGlobalSetting(
				db,
				CHECKPOINT_CONTINUE_KEY,
				updates.checkpointContinue ? 'true' : 'false'
			);
			if (!result.success) return result;
		}
		return { success: true };
	} catch (error) {
		return { success: false, error: error instanceof Error ? error.message : String(error) };
	}
}
