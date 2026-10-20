import { request } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { negotiateRunnerTokenViaBrowser } from '../../scripts/local-runner/token-negotiation';

const { spawn, createRunnerToken } = vi.hoisted(() => ({
	spawn: vi.fn(),
	createRunnerToken: vi.fn(),
}));
vi.mock('node:child_process', () => ({ spawn, spawnSync: vi.fn() }));
vi.mock('$lib/db/local-runners.js', () => ({ createRunnerToken }));

const flows: {
	callback: string;
	result: ReturnType<typeof negotiateRunnerTokenViaBrowser>;
	origin: string;
}[] = [];
const payload = JSON.stringify({ type: 'runner-token', token: 'sbr_legitimate' });

function post(url: string, origin?: string, body = payload, method = 'POST') {
	return new Promise<{ status: number; origin?: string }>((resolve, reject) => {
		const req = request(
			url,
			{
				method,
				agent: false,
				headers: { 'content-type': 'text/plain', ...(origin ? { origin } : {}) },
			},
			(res) => {
				res.resume();
				res.on('end', () =>
					resolve({
						status: res.statusCode!,
						origin: res.headers['access-control-allow-origin'],
					})
				);
			}
		);
		req.on('error', reject);
		req.end(body);
	});
}

async function startFlow(apiUrl = 'https://spacebot.starspace.group') {
	let opened!: (url: string) => void;
	const opening = new Promise<string>((resolve) => {
		opened = resolve;
	});
	spawn.mockImplementationOnce((_command, args) => {
		opened(args[args.length - 1]);
		return { unref() {} };
	});
	const result = negotiateRunnerTokenViaBrowser({
		apiUrl,
		displayName: 'Desk Runner',
		timeoutMs: 20_000,
	});
	const browserUrl = new URL(await opening);
	const callback = browserUrl.searchParams.get('callback')!;
	const flow = { callback, result, origin: new URL(apiUrl).origin };
	flows.push(flow);
	return flow;
}

afterEach(async () => {
	vi.useRealTimers();
	for (const flow of flows.splice(0)) {
		await post(flow.callback, flow.origin).catch(() => {});
		await flow.result;
	}
	spawn.mockReset();
	createRunnerToken.mockReset();
});

describe('runner browser callback binding', () => {
	it('accepts the existing authenticated page handoff with the secret callback intact', async () => {
		const flow = await startFlow();
		createRunnerToken.mockResolvedValue({
			success: true,
			rawToken: 'sbr_account_token',
			record: { id: 42 },
		});
		const { GET }: any = await import('../routes/api/account/runners/negotiate/+server');
		const url = new URL(`${flow.origin}/api/account/runners/negotiate`);
		url.searchParams.set('callback', flow.callback);
		url.searchParams.set('name', 'Desk Runner (negotiated)');
		const response = await GET({
			request: new Request(url),
			url,
			cookies: { get: () => 'account-1' },
			platform: { env: { DB: {} } },
		});
		expect(response.status).toBe(200);
		expect(createRunnerToken).toHaveBeenCalledWith({}, 'account-1', 'Desk Runner (negotiated)');
		const html = await response.text();
		const callback = JSON.parse(html.match(/const callbackUrl = (.*);/)![1]);
		const body = JSON.parse(html.match(/const payload = (.*);/)![1]);
		expect(callback).toBe(flow.callback);
		expect((await post(callback, flow.origin, JSON.stringify(body))).status).toBe(200);
		expect(await flow.result).toMatchObject({ ok: true, token: 'sbr_account_token' });
	});

	it('consumes the handoff once even when another request body is already in flight', async () => {
		const flow = await startFlow();
		let finishBody!: () => void;
		const pending = new Promise<number>((resolve, reject) => {
			const req = request(
				flow.callback,
				{
					method: 'POST',
					agent: false,
					headers: { origin: flow.origin, 'content-type': 'text/plain' },
				},
				(res) => {
					res.resume();
					res.on('end', () => resolve(res.statusCode!));
				}
			);
			req.on('error', reject);
			req.write(payload.slice(0, 10));
			finishBody = () => req.end(payload.slice(10));
		});
		// Let the server receive the partial request before the competing handoff.
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect((await post(flow.callback, flow.origin)).status).toBe(200);
		finishBody();
		expect(await pending).toBe(410);
		expect(await flow.result).toMatchObject({ ok: true, token: 'sbr_legitimate' });
	});

	it('rejects a cross-origin attacker token before a legitimate callback succeeds', async () => {
		const flow = await startFlow();
		const attack = await post(
			flow.callback,
			'https://evil.example',
			JSON.stringify({ type: 'runner-token', token: 'sbr_attacker' })
		);
		expect(attack.status).toBe(403);
		expect(attack.origin).toBeUndefined();
		expect(await post(flow.callback, flow.origin)).toEqual({
			status: 200,
			origin: flow.origin,
		});
		expect(await flow.result).toMatchObject({ ok: true, token: 'sbr_legitimate' });
	});

	it('requires an unpredictable per-flow callback path even for the trusted origin', async () => {
		const first = await startFlow();
		const second = await startFlow();
		const firstUrl = new URL(first.callback);
		const secondUrl = new URL(second.callback);
		expect(firstUrl.pathname).toMatch(/^\/callback\/[a-f0-9]{64}$/);
		expect(secondUrl.pathname).not.toBe(firstUrl.pathname);
		for (const path of ['/callback', secondUrl.pathname, `${firstUrl.pathname}?extra=1`]) {
			expect((await post(`${firstUrl.origin}${path}`, first.origin)).status).toBe(404);
		}
		expect((await post(first.callback, first.origin)).status).toBe(200);
	});

	it('rejects missing, opaque, and lookalike origins without ending negotiation', async () => {
		const flow = await startFlow();
		for (const origin of [
			undefined,
			'null',
			`${flow.origin}.evil.example`,
			`${flow.origin}:8443`,
		]) {
			expect((await post(flow.callback, origin)).status).toBe(403);
		}
		expect((await post(flow.callback, flow.origin, 'not-json')).status).toBe(400);
		expect(
			(
				await post(
					flow.callback,
					flow.origin,
					JSON.stringify({ type: 'runner-token', token: 'bad' })
				)
			).status
		).toBe(400);
		expect((await post(flow.callback, flow.origin)).status).toBe(200);
	});

	it.each(['http://localhost:4269', 'https://custom.example/base/'])(
		'preserves configured site %s and scopes preflight',
		async (apiUrl) => {
			const flow = await startFlow(apiUrl);
			expect(await post(flow.callback, flow.origin, '', 'OPTIONS')).toEqual({
				status: 204,
				origin: flow.origin,
			});
			expect((await post(flow.callback, 'https://evil.example', '', 'OPTIONS')).status).toBe(
				403
			);
			expect((await post(flow.callback, flow.origin, '', 'GET')).status).toBe(404);
			expect((await post(flow.callback, flow.origin)).status).toBe(200);
			await expect(post(flow.callback, flow.origin)).rejects.toThrow();
		}
	);

	it('expires the callback without accepting a token', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const flow = await startFlow();
		await vi.advanceTimersByTimeAsync(20_000);
		expect(await flow.result).toMatchObject({ ok: false });
		await expect(post(flow.callback, flow.origin)).rejects.toThrow();
	});
});
