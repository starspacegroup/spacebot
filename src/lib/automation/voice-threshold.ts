/**
 * VOICE_CHANNEL_THRESHOLD: "when General Voice reaches 4 people".
 *
 * A level check ("4 or more are here") fires on every later join. This is an
 * edge check: it fires on the join that carries the head-count from below the
 * threshold to at or above it, then stays quiet until the channel drops under
 * `rearm_below` AND the cooldown has passed. Pure and runtime-neutral; the
 * arm state lives in D1 (db/automation-trigger-state.ts).
 */

export const DEFAULT_COOLDOWN_MINUTES = 30;

export interface ThresholdState {
	armed: boolean;
	lastFiredAt: number | null;
}

export interface ThresholdConfig {
	minUsers: number;
	rearmBelow: number;
	cooldownMs: number;
	countBots: boolean;
}

export interface Occupancy {
	count: number;
	previous: number;
}

export const FRESH_STATE: ThresholdState = { armed: true, lastFiredAt: null };

function wholeNumber(value: unknown): number | null {
	if (value === undefined || value === null || String(value).trim() === '') return null;
	const n = Number(value);
	return Number.isFinite(n) ? Math.floor(n) : null;
}

/** Read the filter values; null when no usable `min_users` is set. */
export function readThresholdConfig(filters: Record<string, any> | null | undefined) {
	const minUsers = wholeNumber(filters?.min_users);
	if (minUsers === null || minUsers < 1) return null;

	const rearm = wholeNumber(filters?.rearm_below);
	const cooldown = wholeNumber(filters?.cooldown_minutes);
	const config: ThresholdConfig = {
		minUsers,
		// Re-arming at or above the threshold would fire on a level, so cap it.
		rearmBelow: Math.min(rearm !== null && rearm >= 1 ? rearm : minUsers - 1, minUsers),
		cooldownMs:
			(cooldown !== null && cooldown >= 0 ? cooldown : DEFAULT_COOLDOWN_MINUTES) * 60_000,
		countBots: String(filters?.count_bots ?? '').toLowerCase() === 'yes',
	};
	return config;
}

/** Head-counts from the event the gateway sent, humans only unless bots count. */
export function readOccupancy(event: any, config: ThresholdConfig): Occupancy | null {
	const d = event?.details || {};
	const count = Number(config.countBots ? d.totalCount : d.humanCount);
	const previous = Number(config.countBots ? d.previousTotalCount : d.previousHumanCount);
	if (!Number.isFinite(count) || !Number.isFinite(previous)) return null;
	return { count, previous };
}

/**
 * Advance the arm state for one head-count change.
 *
 * - below `rearmBelow` the automation re-arms;
 * - a crossing (previous < min <= count) while armed disarms it, and fires
 *   unless the cooldown is still running (a crossing inside the cooldown is
 *   spent, not saved for later);
 * - a count already at or above min with no crossing never fires, which is
 *   what keeps a restart or a freshly saved automation quiet.
 */
export function evaluateThreshold(
	config: ThresholdConfig,
	state: ThresholdState,
	occupancy: Occupancy,
	now: number
): { fire: boolean; state: ThresholdState } {
	const { count, previous } = occupancy;
	let armed = state.armed;
	if (count < config.rearmBelow) armed = true;

	const crossed = previous < config.minUsers && count >= config.minUsers;
	if (!armed || count < config.minUsers) {
		return { fire: false, state: { ...state, armed } };
	}

	// Armed and at or above the threshold: disarm whether or not this fires.
	const cooledDown = state.lastFiredAt === null || now - state.lastFiredAt >= config.cooldownMs;
	const fire = crossed && cooledDown;
	return {
		fire,
		state: { armed: false, lastFiredAt: fire ? now : state.lastFiredAt },
	};
}
