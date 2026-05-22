import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('local runner service manager', () => {
  it('builds linux systemd paths and filters persistent env', async () => {
    const mod = await import('../../scripts/local-runner/service-manager.ts');

    const paths = mod.getAutostartPaths({
      platform: 'linux',
      homeDir: '/home/alex',
      env: { XDG_CONFIG_HOME: '/home/alex/.config' },
    });

    const persisted = mod.collectPersistentEnv({
      SPACEBOT_RUNNER_TOKEN: 'sbr_123',
      RUNNER_DISPLAY_NAME: 'Desk',
      PATH: '/usr/bin',
      HOME: '/home/alex',
    });

    expect(paths.serviceFile).toBe('/home/alex/.config/systemd/user/spacebot-local-runner.service');
    expect(paths.preferenceFile).toBe('/home/alex/.config/spacebot/local-runner.json');
    expect(persisted).toEqual({
      SPACEBOT_RUNNER_TOKEN: 'sbr_123',
      RUNNER_DISPLAY_NAME: 'Desk',
    });
  });

  it('renders a macOS LaunchAgent with program arguments and environment', async () => {
    const mod = await import('../../scripts/local-runner/service-manager.ts');

    const rendered = mod.renderAutostartFile({
      platform: 'darwin',
      homeDir: '/Users/alex',
      runtime: {
        executable: '/opt/homebrew/bin/bun',
        args: ['run', '/workspace/scripts/local-runner/index.ts', '--headless'],
        cwd: '/workspace',
        env: {
          SPACEBOT_RUNNER_TOKEN: 'sbr_123',
          RUNNER_DISPLAY_NAME: 'Mac Mini',
        },
      },
    });

    expect(rendered.path).toBe('/Users/alex/Library/LaunchAgents/group.starspace.spacebot.local-runner.plist');
    expect(rendered.content).toContain('<string>/opt/homebrew/bin/bun</string>');
    expect(rendered.content).toContain('<string>--headless</string>');
    expect(rendered.content).toContain('<key>SPACEBOT_RUNNER_TOKEN</key>');
    expect(rendered.content).toContain('<string>Mac Mini</string>');
  });

  it('renders a Windows startup script and prompt decision correctly', async () => {
    const mod = await import('../../scripts/local-runner/service-manager.ts');

    const rendered = mod.renderAutostartFile({
      platform: 'win32',
      homeDir: 'C:/Users/Alex',
      env: { APPDATA: 'C:/Users/Alex/AppData/Roaming' },
      runtime: {
        executable: 'C:/Tools/bun.exe',
        args: ['run', 'C:/spacebot/scripts/local-runner/index.ts', '--headless'],
        cwd: 'C:/spacebot',
        env: {
          SPACEBOT_RUNNER_TOKEN: 'sbr_123',
        },
      },
    });

    expect(rendered.path).toBe('C:/Users/Alex/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup/SpaceBot Local Runner.cmd');
    expect(rendered.content).toContain('set SPACEBOT_RUNNER_TOKEN=sbr_123');
    expect(rendered.content).toContain('start "" /min "C:/Tools/bun.exe" "run" "C:/spacebot/scripts/local-runner/index.ts" "--headless"');
    expect(mod.shouldPromptForAutostart({ supported: true, installed: false, suppressed: false })).toBe(true);
    expect(mod.shouldPromptForAutostart({ supported: true, installed: true, suppressed: false })).toBe(false);
    expect(mod.shouldPromptForAutostart({ supported: true, installed: false, suppressed: true })).toBe(false);
  });
});