import type { IncomingMessage } from 'http';

export class BodyTooLargeError extends Error {}

/**
 * Read a request body, refusing more than `limit` bytes. Rejects on a
 * Content-Length over the limit before reading, and destroys the stream the
 * moment the running total passes it, so an unauthenticated caller cannot make
 * the process buffer an arbitrary amount (security review 2026-10-20, #11).
 */
export function readBoundedBody(req: IncomingMessage, limit: number): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const declared = Number(req.headers['content-length']);
		if (Number.isFinite(declared) && declared > limit) {
			req.destroy();
			reject(new BodyTooLargeError(`Content-Length ${declared} exceeds ${limit}`));
			return;
		}
		const chunks: Buffer[] = [];
		let total = 0;
		req.on('data', (chunk: Buffer) => {
			total += chunk.length;
			if (total > limit) {
				req.destroy();
				reject(new BodyTooLargeError(`Body exceeds ${limit} bytes`));
				return;
			}
			chunks.push(chunk);
		});
		req.on('end', () => resolve(Buffer.concat(chunks)));
		req.on('error', reject);
	});
}
