import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('vscode bridge client', () => {
  it('returns config error when token is missing', async () => {
    vi.stubEnv('RUNNER_VSCODE_BRIDGE_TOKEN', '');

    const { bridgeDiscover } = await import('../../scripts/local-runner/vscode-bridge-client.ts');
    const result = await bridgeDiscover();

    expect(result.ok).toBe(false);
    expect(result.error).toContain('RUNNER_VSCODE_BRIDGE_TOKEN');
  });

  it('sends request and parses successful bridge response', async () => {
    vi.stubEnv('RUNNER_VSCODE_BRIDGE_TOKEN', 'bridge-token');
    vi.stubEnv('RUNNER_VSCODE_BRIDGE_URL', 'http://127.0.0.1:49372');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, discovery: { workspaceFolders: [] } }),
    });

    vi.stubGlobal('fetch', fetchMock);

    const { bridgeDiscover } = await import('../../scripts/local-runner/vscode-bridge-client.ts');
    const result = await bridgeDiscover();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    expect(result.body.discovery).toEqual({ workspaceFolders: [] });
  });

  it('returns bridge error details for non-200 responses', async () => {
    vi.stubEnv('RUNNER_VSCODE_BRIDGE_TOKEN', 'bridge-token');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 501,
      json: async () => ({ error: 'chat_command_not_available' }),
    }));

    const { bridgeSendCopilotMessage } = await import('../../scripts/local-runner/vscode-bridge-client.ts');
    const result = await bridgeSendCopilotMessage('hello');

    expect(result.ok).toBe(false);
    expect(result.status).toBe(501);
    expect(result.error).toContain('chat_command_not_available');
  });

  it('handles non-JSON bridge responses', async () => {
    vi.stubEnv('RUNNER_VSCODE_BRIDGE_TOKEN', 'bridge-token');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('invalid json');
      },
    }));

    const { bridgeOpenWorkspace } = await import('../../scripts/local-runner/vscode-bridge-client.ts');
    const result = await bridgeOpenWorkspace('/tmp/demo', true);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('500');
  });

  it('handles fetch exceptions gracefully', async () => {
    vi.stubEnv('RUNNER_VSCODE_BRIDGE_TOKEN', 'bridge-token');

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));

    const { bridgeDiscover } = await import('../../scripts/local-runner/vscode-bridge-client.ts');
    const result = await bridgeDiscover();

    expect(result.ok).toBe(false);
    expect(result.error).toContain('connection refused');
  });
});
