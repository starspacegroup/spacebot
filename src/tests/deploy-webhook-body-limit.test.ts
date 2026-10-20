import { afterEach, describe, expect, it } from 'vitest';
import { createServer, request, type Server } from 'http';
import { readBoundedBody } from '../../scripts/bounded-body.js';

let server: Server;
afterEach(() => new Promise<void>((r) => server.close(() => r())));

function start(limit: number, seen: { result?: string }) {
	server = createServer((req, res) => {
		readBoundedBody(req, limit).then(
			(body) => {
				seen.result = `ok:${body.length}`;
				res.end('ok');
			},
			() => {
				seen.result = 'rejected';
			}
		);
	});
	return new Promise<number>((r) =>
		server.listen(0, '127.0.0.1', () => r((server.address() as any).port))
	);
}

function send(port: number, chunks: Buffer[], headers: Record<string, string> = {}) {
	return new Promise<string>((resolve) => {
		const req = request({ port, host: '127.0.0.1', method: 'POST', headers }, (res) => {
			res.resume();
			res.on('end', () => resolve(`status:${res.statusCode}`));
		});
		req.on('error', () => resolve('terminated'));
		for (const c of chunks) req.write(c);
		req.end();
	});
}

describe('readBoundedBody', () => {
	it('accepts a body under the cap', async () => {
		const seen: any = {};
		const port = await start(1024, seen);
		expect(await send(port, [Buffer.alloc(100)])).toBe('status:200');
		expect(seen.result).toBe('ok:100');
	});

	it('terminates a streamed body over the cap without buffering it', async () => {
		const seen: any = {};
		const port = await start(1024, seen);
		const outcome = await send(
			port,
			Array.from({ length: 64 }, () => Buffer.alloc(1024)),
			{
				'transfer-encoding': 'chunked',
			}
		);
		expect(outcome).toBe('terminated');
		expect(seen.result).toBe('rejected');
	});

	it('rejects an oversized Content-Length before reading', async () => {
		const seen: any = {};
		const port = await start(1024, seen);
		const outcome = await send(port, [Buffer.alloc(10)], { 'content-length': '999999' });
		expect(outcome).toBe('terminated');
		expect(seen.result).toBe('rejected');
	});
});
