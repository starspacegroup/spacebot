import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function spawnMockFactory() {
  return vi.fn((command, args) => {
    const arg0 = args?.[0] || '';

    if (command === 'which') {
      // Pretend these tools exist.
      return { status: 0, stdout: '/usr/bin/tool\n' };
    }

    if (command === 'xrandr' && arg0 === '--query') {
      return {
        status: 0,
        stdout: [
          'HDMI-1 connected primary 1920x1080+0+0',
          'DP-1 connected 2560x1440+1920+0',
        ].join('\n'),
      };
    }

    return { status: 1, stdout: '', stderr: '' };
  });
}

describe('gatherSystemProfile', () => {
  it('builds display arrangement and capability flags from environment', async () => {
    const spawnSync = spawnMockFactory();

    vi.doMock('node:child_process', () => ({ spawnSync }));
    vi.stubEnv('RUNNER_VSCODE_BRIDGE_TOKEN', 'token-123');
    vi.stubEnv('DISPLAY', ':0');

    const { gatherSystemProfile } = await import('../../scripts/local-runner/capabilities.ts');
    const profile = gatherSystemProfile();

    expect(profile.displays.count).toBe(2);
    expect(profile.displays.arrangementKnown).toBe(true);
    expect(profile.displays.items[0].primary).toBe(true);
    expect(profile.capabilities.screenshotAvailable).toBe(true);
    expect(profile.capabilities.vscodeControlAvailable).toBe(true);
    expect(profile.capabilities.copilotMessageAvailable).toBe(true);
    expect(profile.installedApps.mode).toBe('light');
  });

  it('handles missing display tooling gracefully', async () => {
    const spawnSync = vi.fn((command) => {
      if (command === 'which') {
        return { status: 1, stdout: '' };
      }
      return { status: 1, stdout: '', stderr: '' };
    });

    vi.doMock('node:child_process', () => ({ spawnSync }));
    vi.stubEnv('DISPLAY', '');
    vi.stubEnv('WAYLAND_DISPLAY', '');
    vi.stubEnv('RUNNER_VSCODE_BRIDGE_TOKEN', '');

    const { gatherSystemProfile } = await import('../../scripts/local-runner/capabilities.ts');
    const profile = gatherSystemProfile();

    expect(profile.displays.count).toBe(0);
    expect(profile.displays.arrangementKnown).toBe(false);
    expect(profile.capabilities.copilotMessageAvailable).toBe(false);
  });

  it('parses macOS display data and bridge-url capability', async () => {
    const spawnSync = vi.fn((command, args) => {
      if (command === 'which') {
        return { status: 0, stdout: '/usr/bin/tool\n' };
      }

      if (command === 'system_profiler' && args?.[0] === 'SPDisplaysDataType') {
        return {
          status: 0,
          stdout: JSON.stringify({
            SPDisplaysDataType: [
              {
                spdisplays_ndrvs: [
                  {
                    _name: 'Studio Display',
                    _spdisplays_resolution: '5120 x 2880',
                  },
                ],
              },
            ],
          }),
        };
      }

      return { status: 1, stdout: '', stderr: '' };
    });

    vi.doMock('node:child_process', () => ({ spawnSync }));
    vi.doMock('node:process', () => ({
      platform: 'darwin',
      arch: 'arm64',
      env: {
        RUNNER_VSCODE_BRIDGE_URL: 'http://127.0.0.1:49372',
        RUNNER_VSCODE_BRIDGE_TOKEN: '',
      },
    }));

    const { gatherSystemProfile } = await import('../../scripts/local-runner/capabilities.ts');
    const profile = gatherSystemProfile();

    expect(profile.os.platform).toBe('darwin');
    expect(profile.displays.count).toBe(1);
    expect(profile.displays.items[0].name).toBe('Studio Display');
    expect(profile.capabilities.vscodeControlAvailable).toBe(true);
    expect(profile.capabilities.copilotMessageAvailable).toBe(false);
  });

  it('parses Windows monitor layout via PowerShell', async () => {
    const spawnSync = vi.fn((command) => {
      if (command === 'where') {
        return { status: 0, stdout: 'C:\\Tools\\code.exe\n' };
      }

      if (command === 'powershell') {
        return {
          status: 0,
          stdout: [
            '1|\\\\.\\DISPLAY1|0|0|1920|1080|True',
            '2|\\\\.\\DISPLAY2|1920|0|1920|1080|False',
          ].join('\n'),
        };
      }

      return { status: 1, stdout: '', stderr: '' };
    });

    vi.doMock('node:child_process', () => ({ spawnSync }));
    vi.doMock('node:process', () => ({
      platform: 'win32',
      arch: 'x64',
      env: {},
    }));

    const { gatherSystemProfile } = await import('../../scripts/local-runner/capabilities.ts');
    const profile = gatherSystemProfile();

    expect(profile.os.platform).toBe('win32');
    expect(profile.displays.count).toBe(2);
    expect(profile.displays.items[0].primary).toBe(true);
    expect(profile.displays.items[1].x).toBe(1920);
  });
});
