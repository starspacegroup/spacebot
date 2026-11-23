import { afterEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
const realFetch = globalThis.fetch;
import {
	DEFAULT_OUTBOUND_TIMEOUT_MS,
	fetchWithTimeout,
	OutboundTimeoutError,
} from '../lib/server/outbound.js';

/** A fetch that never answers until its signal aborts, like a hung upstream. */
const hangingFetch: typeof fetch = (_input, init) =>
	new Promise<Response>((_resolve, reject) => {
		const signal = init?.signal;
		signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
	});

describe('fetchWithTimeout', () => {
	let server: Server | null = null;
	afterEach(async () => {
		if (server) await new Promise((r) => server!.close(() => r(null)));
		server = null;
	});

	it('gives up on a real slow server with OutboundTimeoutError', async () => {
		server = createServer((_req, res) => {
			// Answers far later than the deadline.
			setTimeout(() => res.end('late'), 2000).unref();
		});
		await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
		const { port } = server.address() as AddressInfo;
		const started = Date.now();
		const err = await fetchWithTimeout(
			`http://127.0.0.1:${port}/slow?token=secret`,
			{},
			{
				timeoutMs: 100,
				fetchImpl: realFetch,
			}
		).catch((e) => e);
		expect(err).toBeInstanceOf(OutboundTimeoutError);
		expect(err.host).toBe(`127.0.0.1:${port}`);
		expect(err.timeoutMs).toBe(100);
		expect(err.message).not.toContain('secret');
		expect(Date.now() - started).toBeLessThan(1500);
	});

	it('returns any response that arrives in time, whatever its status', async () => {
		server = createServer((_req, res) => {
			res.statusCode = 502;
			res.end('bad gateway');
		});
		await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
		const { port } = server.address() as AddressInfo;
		const res = await fetchWithTimeout(
			`http://127.0.0.1:${port}/`,
			{},
			{ timeoutMs: 2000, fetchImpl: realFetch }
		);
		expect(res.status).toBe(502);
		expect(await res.text()).toBe('bad gateway');
	});

	it('passes a signal to fetch and uses the default limit', async () => {
		let seen: AbortSignal | undefined;
		const res = await fetchWithTimeout(
			'https://api.example/x',
			{ method: 'POST' },
			{
				fetchImpl: async (_i, init) => {
					seen = init?.signal ?? undefined;
					expect(init?.method).toBe('POST');
					return new Response('ok');
				},
			}
		);
		expect(res.ok).toBe(true);
		expect(seen).toBeInstanceOf(AbortSignal);
		expect(DEFAULT_OUTBOUND_TIMEOUT_MS).toBe(8000);
	});

	it("rethrows a caller's own abort and network errors unchanged", async () => {
		const controller = new AbortController();
		const pending = fetchWithTimeout(
			'https://api.example/',
			{ signal: controller.signal },
			{
				fetchImpl: hangingFetch,
				timeoutMs: 5000,
			}
		);
		controller.abort(new Error('caller gave up'));
		await expect(pending).rejects.toThrow('caller gave up');

		const boom = new TypeError('network down');
		await expect(
			fetchWithTimeout('not a url', {}, { fetchImpl: async () => Promise.reject(boom) })
		).rejects.toBe(boom);
	});

	it('names the host of a Request or URL input and falls back for garbage', async () => {
		const req = new Request('https://req.example/a');
		await expect(
			fetchWithTimeout(req, {}, { fetchImpl: hangingFetch, timeoutMs: 5 })
		).rejects.toMatchObject({ host: 'req.example' });
		await expect(
			fetchWithTimeout(
				new URL('https://url.example/'),
				{},
				{ fetchImpl: hangingFetch, timeoutMs: 5 }
			)
		).rejects.toMatchObject({ host: 'url.example' });
		await expect(
			fetchWithTimeout('::nope::', {}, { fetchImpl: hangingFetch, timeoutMs: 5 })
		).rejects.toMatchObject({ host: 'upstream' });
	});

	it('property: a hung upstream always rejects with the timeout shape and the given limit', async () => {
		await fc.assert(
			fc.asyncProperty(fc.integer({ min: 1, max: 15 }), fc.webUrl(), async (ms, url) => {
				const err = await fetchWithTimeout(
					url,
					{},
					{ fetchImpl: hangingFetch, timeoutMs: ms }
				).catch((e) => e);
				expect(err).toBeInstanceOf(OutboundTimeoutError);
				expect(err.timeoutMs).toBe(ms);
				expect(err.message).not.toContain('?');
			}),
			{ numRuns: 25 }
		);
	});

	it('untilHeaders bounds the first byte but lets a slow body finish', async () => {
		server = createServer((_req, res) => {
			res.writeHead(200);
			res.write('a');
			setTimeout(() => res.end('b'), 250).unref();
		});
		await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
		const { port } = server.address() as AddressInfo;
		const res = await fetchWithTimeout(
			`http://127.0.0.1:${port}/`,
			{},
			{
				timeoutMs: 100,
				untilHeaders: true,
				fetchImpl: realFetch,
			}
		);
		expect(await res.text()).toBe('ab');

		await expect(
			fetchWithTimeout(
				'https://hung.example/',
				{},
				{
					fetchImpl: hangingFetch,
					timeoutMs: 10,
					untilHeaders: true,
				}
			)
		).rejects.toBeInstanceOf(OutboundTimeoutError);
	});
});
