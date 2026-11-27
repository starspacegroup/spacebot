/**
 * Every call this app makes to another service goes through `fetchWithTimeout`.
 *
 * A bare `fetch()` to a slow upstream hangs until Cloudflare gives up on the
 * whole request; a sibling app logged about 1,500 production 504s a day that way
 * (GitHub token refresh and weather calls with no timeout). With a bound, a slow
 * upstream fails fast into the caller's existing error path instead.
 *
 * - `AbortSignal.timeout(ms)` bounds the whole exchange up to the response
 *   headers and body stream; a caller's own `init.signal` still aborts it too.
 * - A timeout surfaces as one error shape, `OutboundTimeoutError`, naming the
 *   host and the limit (never the query string, which can carry a token).
 * - No retries: callers decide. OAuth codes are one-time, so a blind retry is
 *   wrong there.
 *
 * The template's `scripts/check-queries.mjs` flags a bare `fetch(` to an absolute
 * URL; this site gets that check when the `cost-guards` branch (which carries
 * check:queries) is merged. Until then: no bare `fetch(` to another service.
 */

/** Default bound for an outbound call: generous for an API, far under the platform limit. */
export const DEFAULT_OUTBOUND_TIMEOUT_MS = 8000;

export class OutboundTimeoutError extends Error {
	readonly host: string;
	readonly timeoutMs: number;

	constructor(host: string, timeoutMs: number) {
		super(`${host} did not answer within ${timeoutMs} ms`);
		this.name = 'OutboundTimeoutError';
		this.host = host;
		this.timeoutMs = timeoutMs;
	}
}

function hostOf(input: string | URL | Request): string {
	try {
		const raw =
			typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		return new URL(raw).host;
	} catch {
		return 'upstream';
	}
}

export interface OutboundOptions {
	/** Defaults to `DEFAULT_OUTBOUND_TIMEOUT_MS`. */
	timeoutMs?: number;
	/**
	 * Bound only the wait for the response headers, not the body. For a streamed
	 * body (chat completions) a whole-exchange deadline would cut the stream off
	 * mid-answer; this still refuses an upstream that never starts answering.
	 */
	untilHeaders?: boolean;
	/** Injected in tests; the global fetch otherwise. */
	fetchImpl?: typeof fetch;
}

/**
 * `fetch` with a deadline. Resolves with the response (any status) or rejects:
 * with `OutboundTimeoutError` when the deadline passes, or with the original
 * error for anything else (network failure, a caller abort).
 */
export async function fetchWithTimeout(
	input: string | URL | Request,
	init: RequestInit = {},
	options: OutboundOptions = {}
): Promise<Response> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_OUTBOUND_TIMEOUT_MS;
	const doFetch = options.fetchImpl ?? fetch;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let deadline: AbortSignal;
	if (options.untilHeaders) {
		const controller = new AbortController();
		timer = setTimeout(
			() => controller.abort(new DOMException('headers timeout', 'TimeoutError')),
			timeoutMs
		);
		deadline = controller.signal;
	} else {
		deadline = AbortSignal.timeout(timeoutMs);
	}
	const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
	try {
		return await doFetch(input, { ...init, signal });
	} catch (thrown) {
		if (deadline.aborted && !init.signal?.aborted) {
			throw new OutboundTimeoutError(hostOf(input), timeoutMs);
		}
		throw thrown;
	} finally {
		clearTimeout(timer);
	}
}
