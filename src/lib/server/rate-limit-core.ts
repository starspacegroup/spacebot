/**
 * The rate-limit decision, with no I/O.
 *
 * Both counter backends — D1 (rate-limit.ts) and the RateLimiter Durable
 * Object (orchestrator-worker/src/rate-limiter.ts) — only return a count; this
 * turns the count into the decision, so the two cannot drift.
 * src/tests/rate-limit-do.test.ts checks they agree on random sequences.
 */

export interface RateWindow {
	windowStart: number;
	expiresAt: number;
}

/** Fixed window that contains `nowSec`. */
export function rateWindow(nowSec: number, windowSeconds: number): RateWindow {
	const w = Math.max(1, Math.floor(windowSeconds));
	const windowStart = nowSec - (nowSec % w);
	return { windowStart, expiresAt: windowStart + w };
}

export interface RateDecision {
	allowed: boolean;
	/** Count after this request was added. */
	used: number;
	remaining: number;
	resetAt: number;
}

/**
 * `used` is the count AFTER this request was counted (a denied request is
 * still counted, as the D1 path always did). Allowed while used <= max.
 */
export function decide(used: number, max: number, expiresAt: number): RateDecision {
	return {
		allowed: used <= max,
		used,
		remaining: Math.max(0, max - used),
		resetAt: expiresAt,
	};
}
