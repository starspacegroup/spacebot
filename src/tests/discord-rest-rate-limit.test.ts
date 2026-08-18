/**
 * A burst of GitHub webhooks made the "GitHub Public Log" automation post most
 * of its messages and then fail two with "You are being rate limited." — the
 * REST client threw on any non-OK response, so a 429 lost the message outright.
 *
 * These cover both halves of the fix: surviving a 429 that lands, and pacing so
 * fewer land in the first place.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDiscordRestClient } from '../lib/discord/rest-client.js';

const realFetch = globalThis.fetch;

/** Waiting is real time; make the clock cooperate so tests stay fast. */
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.useRealTimers();
	globalThis.fetch = realFetch;
	vi.restoreAllMocks();
});

function rateLimited(retryAfter: number, extra: Record<string, string> = {}) {
	return {
		ok: false,
		status: 429,
		headers: new Headers({ 'retry-after': String(retryAfter), ...extra }),
		json: async () => ({ message: 'You are being rate limited.', retry_after: retryAfter }),
	};
}

function ok(headers: Record<string, string> = {}) {
	return {
		ok: true,
		status: 200,
		headers: new Headers(headers),
		json: async () => ({ id: '999' }),
	};
}

/** Drive a promise that sleeps on timers to completion. */
async function settle<T>(promise: Promise<T>): Promise<T> {
	const result = promise.then(
		(value) => ({ value, error: null as any }),
		(error) => ({ value: null as any, error })
	);
	await vi.runAllTimersAsync();
	const { value, error } = await result;
	if (error) throw error;
	return value;
}

describe('discord REST rate limiting', () => {
	it('retries a 429 instead of dropping the message', async () => {
		const calls: any[] = [];
		globalThis.fetch = vi.fn(async (url: any, init: any) => {
			calls.push({ url: String(url), init });
			return calls.length === 1 ? rateLimited(0.5) : ok();
		}) as any;

		const discord = createDiscordRestClient('token');
		const channel = await settle(discord.channels.fetch('111222333444555666'));
		const sent = await settle(channel.send('hello'));

		expect(sent).toEqual({ id: '999' });
		// Fetched the channel, hit the limit, then succeeded on the retry.
		expect(calls.length).toBe(3);
	});

	it('waits exactly as long as Discord asked', async () => {
		const at: number[] = [];
		globalThis.fetch = vi.fn(async () => {
			at.push(Date.now());
			return at.length === 1 ? rateLimited(2) : ok();
		}) as any;

		const discord = createDiscordRestClient('token');
		await settle(discord.channels.fetch('222333444555666777'));

		expect(at).toHaveLength(2);
		// Exactly Discord's 2s — not a fixed backoff we invented.
		expect(at[1] - at[0]).toBe(2000);
	});

	it('gives up with the retry-after attached rather than retrying forever', async () => {
		globalThis.fetch = vi.fn(async () => rateLimited(60)) as any;

		const discord = createDiscordRestClient('token');
		// 60s exceeds the in-request wait budget, so it must not sleep through it.
		await expect(settle(discord.channels.fetch('333444555666777888'))).rejects.toMatchObject({
			status: 429,
			rateLimited: true,
			retryAfterMs: 60000,
		});
	});

	it('waits out an exhausted bucket before spending the next request', async () => {
		const at: number[] = [];
		globalThis.fetch = vi.fn(async () => {
			at.push(Date.now());
			// Bucket is now empty and resets in 3s.
			return ok({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': '3' });
		}) as any;

		const discord = createDiscordRestClient('token');
		const channel = await settle(discord.channels.fetch('777888999000111222'));
		await settle(channel.send('first'));
		await settle(channel.send('second'));

		// The send after the bucket emptied is held back rather than 429ing.
		expect(at.at(-1)! - at.at(-2)!).toBeGreaterThanOrEqual(3000);
	});

	it('does not let one channel stall another', async () => {
		const exhausted = '444555666777888999';
		const healthy = '555666777888999000';
		globalThis.fetch = vi.fn(async (url: any) =>
			String(url).includes(exhausted)
				? ok({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': '5' })
				: ok({ 'x-ratelimit-remaining': '4', 'x-ratelimit-reset-after': '5' })
		) as any;

		const discord = createDiscordRestClient('token');
		await settle(discord.channels.fetch(exhausted));

		// A different channel is a different bucket, so it must not inherit the wait.
		const before = Date.now();
		await settle(discord.channels.fetch(healthy));
		expect(Date.now() - before).toBeLessThan(1000);
	});

	it('still reports non-rate-limit errors as before', async () => {
		globalThis.fetch = vi.fn(async () => ({
			ok: false,
			status: 403,
			headers: new Headers(),
			json: async () => ({ message: 'Missing Permissions' }),
		})) as any;

		const discord = createDiscordRestClient('token');
		await expect(settle(discord.channels.fetch('666777888999000111'))).rejects.toThrow(
			'Missing Permissions'
		);
	});
});

describe('a rate-limited automation send is queued, not dropped', () => {
	it('hands the message to the scheduled queue when the retry budget runs out', async () => {
		const { executeAction } = await import('../lib/automation/engine.js');

		const scheduled: any[] = [];
		const db = {
			prepare: (sql: string) => ({
				bind: (...params: any[]) => ({
					run: async () => {
						if (sql.includes('INSERT INTO scheduled_messages')) {
							scheduled.push(params);
						}
						return { meta: { last_row_id: 7 } };
					},
					first: async () => null,
					all: async () => ({ results: [] }),
				}),
			}),
		};

		// A channel whose send is rate limited beyond what the client will wait for.
		const discord = {
			channels: {
				fetch: async () => ({
					send: async () => {
						const error: any = new Error('Discord rate limited');
						error.rateLimited = true;
						error.status = 429;
						error.retryAfterMs = 60000;
						throw error;
					},
				}),
			},
		};

		const result: any = await executeAction(
			{
				id: 1,
				name: 'GitHub Public Log',
				action_type: 'SEND_MESSAGE',
				action_config: { channel_id: '123', content: 'a push happened' },
			},
			{ guild_id: 'g1', actor_id: 'u1' },
			{},
			discord,
			db
		);

		// Reported as handled, not as a failure — nothing was lost.
		expect(result.success).toBe(true);
		expect(result.result).toMatchObject({
			sent: false,
			deferred: true,
			reason: 'rate_limited',
		});
		// And the content really did reach the queue the cron drains.
		expect(scheduled).toHaveLength(1);
		expect(JSON.stringify(scheduled[0])).toContain('a push happened');
	});
});
