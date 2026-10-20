import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createNegotiationHandler } from '../../scripts/local-runner/token-negotiation.js';

const NONCE = 'a'.repeat(64);
const ORIGIN = 'https://spacebot.example';
let server: Server;

afterEach(() => new Promise<void>((r) => server.close(() => r())));

async function start(onToken: (t: string) => void) {
	server = createServer(
		createNegotiationHandler({ nonce: NONCE, expectedOrigin: ORIGIN, onToken })
	);
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
	return `http://127.0.0.1:${(server.address() as any).port}`;
}

const body = JSON.stringify({ type: 'runner-token', token: 'sbr_attacker' });

describe('loopback token negotiation', () => {
	it('rejects the old nonce-less path', async () => {
		const onToken = vi.fn();
		const base = await start(onToken);
		const res = await fetch(`${base}/callback`, {
			method: 'POST',
			body,
			headers: { origin: ORIGIN },
		});
		expect(res.status).toBe(404);
		expect(onToken).not.toHaveBeenCalled();
	});

	it('rejects a wrong nonce', async () => {
		const onToken = vi.fn();
		const base = await start(onToken);
		const res = await fetch(`${base}/callback/${'b'.repeat(64)}`, {
			method: 'POST',
			body,
			headers: { origin: ORIGIN },
		});
		expect(res.status).toBe(404);
		expect(onToken).not.toHaveBeenCalled();
	});

	it('rejects a foreign Origin even with the nonce', async () => {
		const onToken = vi.fn();
		const base = await start(onToken);
		const res = await fetch(`${base}/callback/${NONCE}`, {
			method: 'POST',
			body,
			headers: { origin: 'https://evil.example' },
		});
		expect(res.status).toBe(403);
		expect(onToken).not.toHaveBeenCalled();
	});

	it('accepts once from the SpaceBot origin, then refuses reuse', async () => {
		const onToken = vi.fn();
		const base = await start(onToken);
		const ok = await fetch(`${base}/callback/${NONCE}`, {
			method: 'POST',
			body,
			headers: { origin: ORIGIN },
		});
		expect(ok.status).toBe(200);
		expect(ok.headers.get('access-control-allow-origin')).toBe(ORIGIN);
		expect(onToken).toHaveBeenCalledWith('sbr_attacker');
		const again = await fetch(`${base}/callback/${NONCE}`, {
			method: 'POST',
			body,
			headers: { origin: ORIGIN },
		});
		expect(again.status).toBe(404);
		expect(onToken).toHaveBeenCalledTimes(1);
	});
});
