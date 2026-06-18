import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('collectWorkspaceContext', () => {
  it('returns unavailable context when wmctrl is missing', async () => {
    const spawnSync = vi.fn((command) => {
      if (command === 'which') {
        return { status: 1, stdout: '' };
      }
      return { status: 1, stdout: '', stderr: '' };
    });

    vi.doMock('node:child_process', () => ({ spawnSync }));
    vi.doMock('node:process', () => ({ platform: 'linux' }));

    const { collectWorkspaceContext } = await import('../../scripts/local-runner/workspace-context.ts' as string);
    const context = collectWorkspaceContext();

    expect(context.available).toBe(false);
    expect(context.reason).toBe('wmctrl_not_installed');
  });

  it('parses workspace and window details when wmctrl is available', async () => {
    const spawnSync = vi.fn((command, args) => {
      if (command === 'which') {
        return { status: 0, stdout: '/usr/bin/wmctrl\n' };
      }

      if (command === 'wmctrl' && args?.[0] === '-d') {
        return {
          status: 0,
          stdout: [
            '0 * DG: 3840x2160 VP: 0,0 WA: 0,0 1920x1080 Workspace 1',
            '1 - DG: 3840x2160 VP: 0,0 WA: 0,0 1920x1080 Workspace 2',
          ].join('\n'),
        };
      }

      if (command === 'wmctrl' && args?.[0] === '-l') {
        return {
          status: 0,
          stdout: [
            '0x03200007  0 host-a Terminal',
            '0x04200009  1 host-a VSCode',
          ].join('\n'),
        };
      }

      return { status: 1, stdout: '', stderr: '' };
    });

    vi.doMock('node:child_process', () => ({ spawnSync }));
    vi.doMock('node:process', () => ({ platform: 'linux' }));

    const { collectWorkspaceContext } = await import('../../scripts/local-runner/workspace-context.ts' as string);
    const context = collectWorkspaceContext();

    expect(context.available).toBe(true);
    expect(context.currentWorkspace).toBe('0');
    expect(context.workspaces).toHaveLength(2);
    expect(context.windows).toHaveLength(2);
  });

  it('collects macOS frontmost app context', async () => {
    const spawnSync = vi.fn((command) => {
      if (command === 'osascript') {
        return { status: 0, stdout: 'Visual Studio Code\n' };
      }
      return { status: 1, stdout: '', stderr: '' };
    });

    vi.doMock('node:child_process', () => ({ spawnSync }));
    vi.doMock('node:process', () => ({ platform: 'darwin' }));

    const { collectWorkspaceContext } = await import('../../scripts/local-runner/workspace-context.ts' as string);
    const context = collectWorkspaceContext();

    expect(context.available).toBe(true);
    expect(context.currentWorkspace).toBe('Visual Studio Code');
  });

  it('collects Windows visible window context', async () => {
    const spawnSync = vi.fn((command) => {
      if (command === 'powershell') {
        return {
          status: 0,
          stdout: [
            'Code|SpaceBot',
            'WindowsTerminal|bash',
          ].join('\n'),
        };
      }
      return { status: 1, stdout: '', stderr: '' };
    });

    vi.doMock('node:child_process', () => ({ spawnSync }));
    vi.doMock('node:process', () => ({ platform: 'win32' }));

    const { collectWorkspaceContext } = await import('../../scripts/local-runner/workspace-context.ts' as string);
    const context = collectWorkspaceContext();

    expect(context.available).toBe(true);
    expect(context.windows).toHaveLength(2);
    expect(context.windows[0].processName).toBe('Code');
  });

  it('returns unsupported_platform for unknown OS', async () => {
    vi.doMock('node:child_process', () => ({ spawnSync: vi.fn() }));
    vi.doMock('node:process', () => ({ platform: 'freebsd' }));

    const { collectWorkspaceContext } = await import('../../scripts/local-runner/workspace-context.ts' as string);
    const context = collectWorkspaceContext();

    expect(context.available).toBe(false);
    expect(context.reason).toBe('unsupported_platform');
  });
});
