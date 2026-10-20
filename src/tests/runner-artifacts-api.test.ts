import { afterEach, describe, expect, it, vi } from 'vitest';

const getRunnerArtifact = vi.fn();

vi.mock('$lib/db/local-runners.js', () => ({
	getRunnerArtifact,
}));

afterEach(() => {
	getRunnerArtifact.mockReset();
});

describe('runner artifacts API', () => {
	it('returns 401 when user is not authenticated', async () => {
		const { GET }: any =
			await import('../routes/api/account/runners/artifacts/[id]/+server.js');
		const response = await GET({
			params: { id: '1' },
			url: new URL('http://localhost/api/account/runners/artifacts/1'),
			cookies: { get: () => null } as any,
			platform: { env: { DB: {} } },
		});

		expect(response.status).toBe(401);
	});

	it('returns 503 when database binding is missing', async () => {
		const { GET }: any =
			await import('../routes/api/account/runners/artifacts/[id]/+server.js');
		const response = await GET({
			params: { id: '1' },
			url: new URL('http://localhost/api/account/runners/artifacts/1'),
			cookies: { get: () => 'user-1' } as any,
			platform: { env: {} },
		});

		expect(response.status).toBe(503);
	});

	it('redirects to external artifact URL when raw payload is external', async () => {
		getRunnerArtifact.mockResolvedValue({
			id: 3,
			storage_mode: 'external',
			external_url: 'https://example.com/artifact.png',
		});

		const { GET }: any =
			await import('../routes/api/account/runners/artifacts/[id]/+server.js');
		const response = await GET({
			params: { id: '3' },
			url: new URL('http://localhost/api/account/runners/artifacts/3?raw=1'),
			cookies: { get: () => 'user-1' } as any,
			platform: { env: { DB: {} } },
		});

		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe('https://example.com/artifact.png');
	});

	it('returns 404 for raw mode when payload is missing', async () => {
		getRunnerArtifact.mockResolvedValue({
			id: 4,
			storage_mode: 'inline_base64',
			blob_base64: null,
		});

		const { GET }: any =
			await import('../routes/api/account/runners/artifacts/[id]/+server.js');
		const response = await GET({
			params: { id: '4' },
			url: new URL('http://localhost/api/account/runners/artifacts/4?raw=1'),
			cookies: { get: () => 'user-1' } as any,
			platform: { env: { DB: {} } },
		});

		expect(response.status).toBe(404);
	});

	it('returns binary payload for inline_base64 artifacts', async () => {
		const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		const base64 = Buffer.from(bytes).toString('base64');

		getRunnerArtifact.mockResolvedValue({
			id: 1,
			storage_mode: 'inline_base64',
			blob_base64: base64,
			mime_type: 'image/png',
		});

		const { GET }: any =
			await import('../routes/api/account/runners/artifacts/[id]/+server.js');
		const response = await GET({
			params: { id: '1' },
			url: new URL('http://localhost/api/account/runners/artifacts/1?raw=1'),
			cookies: { get: () => 'user-1' } as any,
			platform: { env: { DB: {} } },
		});

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('image/png');
		const out = new Uint8Array(await response.arrayBuffer());
		expect(Array.from(out)).toEqual(Array.from(bytes));
	});

	it('returns metadata JSON when raw is not requested', async () => {
		getRunnerArtifact.mockResolvedValue({ id: 2, storage_mode: 'inline_base64' });

		const { GET }: any =
			await import('../routes/api/account/runners/artifacts/[id]/+server.js');
		const response = await GET({
			params: { id: '2' },
			url: new URL('http://localhost/api/account/runners/artifacts/2'),
			cookies: { get: () => 'user-1' } as any,
			platform: { env: { DB: {} } },
		});

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.artifact.id).toBe(2);
	});

	async function rawFetch(mime: string, bytes: number[] | string) {
		const data = typeof bytes === 'string' ? bytes : String.fromCharCode(...bytes);
		getRunnerArtifact.mockResolvedValue({
			id: 9,
			storage_mode: 'inline_base64',
			mime_type: mime,
			blob_base64: btoa(data),
		});
		const { GET }: any =
			await import('../routes/api/account/runners/artifacts/[id]/+server.js');
		return GET({
			params: { id: '9' },
			url: new URL('http://localhost/api/account/runners/artifacts/9?raw=1'),
			cookies: { get: () => 'user-1' } as any,
			platform: { env: { DB: {} } },
		});
	}

	it.each(['text/html', 'image/svg+xml', 'application/xhtml+xml', 'text/xml'])(
		'serves runner-declared %s as an opaque attachment',
		async (mime) => {
			const res = await rawFetch(mime, '<svg onload="alert(1)"></svg>');
			expect(res.headers.get('content-type')).toBe('application/octet-stream');
			expect(res.headers.get('content-disposition')).toMatch(/^attachment/);
			expect(res.headers.get('x-content-type-options')).toBe('nosniff');
		}
	);

	it('does not trust image/png when the bytes are HTML', async () => {
		const res = await rawFetch('image/png', '<html><script>alert(1)</script>');
		expect(res.headers.get('content-type')).toBe('application/octet-stream');
	});

	it('renders a real PNG inline', async () => {
		const res = await rawFetch('image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		expect(res.headers.get('content-type')).toBe('image/png');
		expect(res.headers.get('content-disposition')).toBe('inline');
	});

	it('refuses non-https external artifact URLs', async () => {
		getRunnerArtifact.mockResolvedValue({
			id: 5,
			storage_mode: 'external',
			external_url: 'javascript:alert(1)',
		});
		const { GET }: any =
			await import('../routes/api/account/runners/artifacts/[id]/+server.js');
		const res = await GET({
			params: { id: '5' },
			url: new URL('http://localhost/api/account/runners/artifacts/5?raw=1'),
			cookies: { get: () => 'user-1' } as any,
			platform: { env: { DB: {} } },
		});
		expect(res.status).toBe(404);
	});
});
