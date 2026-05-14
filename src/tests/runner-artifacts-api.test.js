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
    const { GET } = await import('../routes/api/account/runners/artifacts/[id]/+server.js');
    const response = await GET({
      params: { id: '1' },
      url: new URL('http://localhost/api/account/runners/artifacts/1'),
      cookies: { get: () => null },
      platform: { env: { DB: {} } },
    });

    expect(response.status).toBe(401);
  });

  it('returns 503 when database binding is missing', async () => {
    const { GET } = await import('../routes/api/account/runners/artifacts/[id]/+server.js');
    const response = await GET({
      params: { id: '1' },
      url: new URL('http://localhost/api/account/runners/artifacts/1'),
      cookies: { get: () => 'user-1' },
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

    const { GET } = await import('../routes/api/account/runners/artifacts/[id]/+server.js');
    const response = await GET({
      params: { id: '3' },
      url: new URL('http://localhost/api/account/runners/artifacts/3?raw=1'),
      cookies: { get: () => 'user-1' },
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

    const { GET } = await import('../routes/api/account/runners/artifacts/[id]/+server.js');
    const response = await GET({
      params: { id: '4' },
      url: new URL('http://localhost/api/account/runners/artifacts/4?raw=1'),
      cookies: { get: () => 'user-1' },
      platform: { env: { DB: {} } },
    });

    expect(response.status).toBe(404);
  });

  it('returns binary payload for inline_base64 artifacts', async () => {
    const bytes = new Uint8Array([80, 78, 71]);
    const base64 = Buffer.from(bytes).toString('base64');

    getRunnerArtifact.mockResolvedValue({
      id: 1,
      storage_mode: 'inline_base64',
      blob_base64: base64,
      mime_type: 'image/png',
    });

    const { GET } = await import('../routes/api/account/runners/artifacts/[id]/+server.js');
    const response = await GET({
      params: { id: '1' },
      url: new URL('http://localhost/api/account/runners/artifacts/1?raw=1'),
      cookies: { get: () => 'user-1' },
      platform: { env: { DB: {} } },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/png');
    const out = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(out)).toEqual(Array.from(bytes));
  });

  it('returns metadata JSON when raw is not requested', async () => {
    getRunnerArtifact.mockResolvedValue({ id: 2, storage_mode: 'inline_base64' });

    const { GET } = await import('../routes/api/account/runners/artifacts/[id]/+server.js');
    const response = await GET({
      params: { id: '2' },
      url: new URL('http://localhost/api/account/runners/artifacts/2'),
      cookies: { get: () => 'user-1' },
      platform: { env: { DB: {} } },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.artifact.id).toBe(2);
  });
});
