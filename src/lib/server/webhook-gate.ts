/**
 * The incoming-webhook gate: the decision is the proved Dafny core
 * (dafny/WebhookGate.dfy, compiled to ./generated/webhook-gate-core.js). This wrapper turns
 * numbers into BigNumbers and the verdict into a string.
 */
import BigNumber from 'bignumber.js';
import { WebhookGateCore } from './generated/webhook-gate-core.js';

const core = WebhookGateCore.__default;

export const MAX_BODY_BYTES = core.MaxBodyBytes.toNumber();
export const RATE_PER_WINDOW = core.RatePerWindow.toNumber();

export type GateVerdict = 'accept' | 'unauthorized' | 'too_large' | 'rate_limited';

export interface GateInput {
	found: boolean;
	enabled: boolean;
	secretMatches: boolean;
	bodyBytes: number;
	/** Counter stored on the hook row. */
	windowStart: number;
	windowCount: number;
	nowSec: number;
}

const big = (n: number) => new BigNumber(Math.max(0, Math.floor(n) || 0));

export function decideWebhook(i: GateInput): GateVerdict {
	const count = core.EffectiveCount(big(i.windowStart), big(i.windowCount), big(i.nowSec));
	const v = core.Decide(i.found, i.enabled, i.secretMatches, big(i.bodyBytes), count);
	if (v.is_Accept) return 'accept';
	if (v.is_TooLarge) return 'too_large';
	if (v.is_RateLimited) return 'rate_limited';
	return 'unauthorized';
}

/** The counter row to store after an accepted call. */
export function nextWebhookWindow(
	windowStart: number,
	windowCount: number,
	nowSec: number
): { start: number; count: number } {
	return {
		start: core.WindowStart(big(nowSec)).toNumber(),
		count: core.NextCount(big(windowStart), big(windowCount), big(nowSec)).toNumber(),
	};
}
