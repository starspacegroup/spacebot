import { afterEach, describe, expect, it, vi } from 'vitest';

const createRunnerToken = vi.fn();

vi.mock('$lib/db/local-runners.js', () => ({
  createRunnerToken,
}));

afterEach(() => {
  createRunnerToken.mockReset();
});

describe('local runner negotiate API', () => {
  it('redirects unauthenticated users to OAuth login', async () => {
    const { GET }: any = await import('../routes/api/account/runners/negotiate/+server.js');

    const request = new Request('https://spacebot.starspace.group/api/account/runners/negotiate?callback=http%3A%2F%2F127.0.0.1%3A49373%2Fcallback');
    await expect(
      GET({
        request,
        url: new URL(request.url),
        cookies: { get: () => null } as any,
        platform: { env: { DB: {} } },
      }),
    ).rejects.toMatchObject({
      status: 302,
    });
  });

  it('rejects non-local callback hosts', async () => {
    const { GET }: any = await import('../routes/api/account/runners/negotiate/+server.js');

    const request = new Request('https://spacebot.starspace.group/api/account/runners/negotiate?callback=http%3A%2F%2Fevil.example%3A9999%2Fcallback');
    const response = await GET({
      request,
      url: new URL(request.url),
      cookies: { get: () => 'user-1' } as any,
      platform: { env: { DB: {} } },
    });

    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain('Callback host must be localhost or 127.0.0.1.');
  });

  it('creates token and returns negotiation page', async () => {
    createRunnerToken.mockResolvedValue({
      success: true,
      rawToken: 'sbr_abcdef123456',
      record: { id: 42 },
    });

    const { GET }: any = await import('../routes/api/account/runners/negotiate/+server.js');

    const request = new Request('https://spacebot.starspace.group/api/account/runners/negotiate?callback=http%3A%2F%2F127.0.0.1%3A49373%2Fcallback&name=Desk%20Runner');
    const response = await GET({
      request,
      url: new URL(request.url),
      cookies: { get: () => 'user-1' } as any,
      platform: { env: { DB: {} } },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(createRunnerToken).toHaveBeenCalledWith({}, 'user-1', 'Desk Runner');

    const html = await response.text();
    expect(html).toContain('Runner Token Ready');
    expect(html).toContain('sbr_abcdef123456');
    expect(html).toContain('http://127.0.0.1:49373/callback');
  });
});