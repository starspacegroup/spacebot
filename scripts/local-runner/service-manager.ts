import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";

export type RunnerPlatform = "linux" | "darwin" | "win32";

export interface RunnerAutostartPreference {
  suppressServicePrompt: boolean;
  updatedAt: string;
}

export interface RunnerAutostartPaths {
  platform: RunnerPlatform;
  configDir: string;
  preferenceFile: string;
  installKind: "systemd-user" | "launch-agent" | "startup-folder";
  serviceLabel: string;
  serviceFile: string;
}

export interface RunnerAutostartStatus {
  supported: boolean;
  installed: boolean;
  suppressed: boolean;
  installKind: RunnerAutostartPaths["installKind"];
  serviceLabel: string;
  serviceFile: string;
  detail: string;
}

export interface RunnerRuntimeCommand {
  executable: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

export interface RunnerAutostartInstallResult {
  ok: boolean;
  status: RunnerAutostartStatus;
  detail: string;
}

const LINUX_LABEL = "spacebot-local-runner";
const MAC_LABEL = "group.starspace.spacebot.local-runner";
const WINDOWS_LABEL = "SpaceBot Local Runner";

function resolvePlatform(platformValue?: NodeJS.Platform): RunnerPlatform {
  const platform = platformValue ?? process.platform;
  if (platform === "linux" || platform === "darwin" || platform === "win32") {
    return platform;
  }
  throw new Error(`Unsupported platform for local runner autostart: ${platform}`);
}

export function collectPersistentEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(source)) {
    if (!value) continue;
    if (key.startsWith("SPACEBOT_") || key.startsWith("RUNNER_")) {
      result[key] = value;
    }
  }

  return result;
}

export function getAutostartPaths(options: {
  platform?: NodeJS.Platform;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
} = {}): RunnerAutostartPaths {
  const platform = resolvePlatform(options.platform);
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? homedir();

  if (platform === "linux") {
    const configHome = env.XDG_CONFIG_HOME || join(homeDir, ".config");
    return {
      platform,
      configDir: join(configHome, "spacebot"),
      preferenceFile: join(configHome, "spacebot", "local-runner.json"),
      installKind: "systemd-user",
      serviceLabel: LINUX_LABEL,
      serviceFile: join(configHome, "systemd", "user", `${LINUX_LABEL}.service`),
    };
  }

  if (platform === "darwin") {
    return {
      platform,
      configDir: join(homeDir, "Library", "Application Support", "SpaceBot"),
      preferenceFile: join(homeDir, "Library", "Application Support", "SpaceBot", "local-runner.json"),
      installKind: "launch-agent",
      serviceLabel: MAC_LABEL,
      serviceFile: join(homeDir, "Library", "LaunchAgents", `${MAC_LABEL}.plist`),
    };
  }

  const appData = env.APPDATA || join(homeDir, "AppData", "Roaming");
  return {
    platform,
    configDir: join(appData, "SpaceBot"),
    preferenceFile: join(appData, "SpaceBot", "local-runner.json"),
    installKind: "startup-folder",
    serviceLabel: WINDOWS_LABEL,
    serviceFile: join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", `${WINDOWS_LABEL}.cmd`),
  };
}

export function readAutostartPreference(options: {
  platform?: NodeJS.Platform;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
} = {}): RunnerAutostartPreference {
  const paths = getAutostartPaths(options);
  try {
    const raw = readFileSync(paths.preferenceFile, "utf8");
    const parsed = JSON.parse(raw);
    return {
      suppressServicePrompt: parsed?.suppressServicePrompt === true,
      updatedAt: typeof parsed?.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
    };
  } catch {
    return {
      suppressServicePrompt: false,
      updatedAt: new Date(0).toISOString(),
    };
  }
}

export function writeAutostartPreference(
  preference: RunnerAutostartPreference,
  options: {
    platform?: NodeJS.Platform;
    homeDir?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
) {
  const paths = getAutostartPaths(options);
  mkdirSync(dirname(paths.preferenceFile), { recursive: true });
  writeFileSync(paths.preferenceFile, JSON.stringify(preference, null, 2) + "\n", "utf8");
}

export function shouldPromptForAutostart(status: Pick<RunnerAutostartStatus, "supported" | "installed" | "suppressed">): boolean {
  return status.supported && !status.installed && !status.suppressed;
}

function shellQuote(value: string): string {
  if (value.length === 0) return "''";
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildRuntimeCommand(options: {
  scriptPath: string;
  cwd?: string;
  bunPath?: string;
  env?: NodeJS.ProcessEnv;
}): RunnerRuntimeCommand {
  const env = collectPersistentEnv(options.env ?? process.env);
  return {
    executable: options.bunPath || process.execPath,
    args: ["run", resolve(options.scriptPath), "--headless"],
    cwd: options.cwd ? resolve(options.cwd) : process.cwd(),
    env,
  };
}

export function renderAutostartFile(options: {
  platform?: NodeJS.Platform;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  runtime: RunnerRuntimeCommand;
}): { path: string; content: string } {
  const paths = getAutostartPaths(options);
  const platform = paths.platform;

  if (platform === "linux") {
    const environmentLines = Object.entries(options.runtime.env)
      .map(([key, value]) => `Environment=${shellQuote(`${key}=${value}`)}`)
      .join("\n");
    const execStart = [options.runtime.executable, ...options.runtime.args].map(shellQuote).join(" ");
    return {
      path: paths.serviceFile,
      content: [
        "[Unit]",
        "Description=SpaceBot Local Runner",
        "After=default.target network-online.target",
        "Wants=network-online.target",
        "",
        "[Service]",
        "Type=simple",
        `WorkingDirectory=${shellQuote(options.runtime.cwd)}`,
        environmentLines,
        `ExecStart=${execStart}`,
        "Restart=always",
        "RestartSec=5",
        "",
        "[Install]",
        "WantedBy=default.target",
        "",
      ].filter(Boolean).join("\n"),
    };
  }

  if (platform === "darwin") {
    const programArguments = [options.runtime.executable, ...options.runtime.args]
      .map((value) => `\t\t<string>${xmlEscape(value)}</string>`)
      .join("\n");
    const envVars = Object.entries(options.runtime.env)
      .map(([key, value]) => `\t\t<key>${xmlEscape(key)}</key>\n\t\t<string>${xmlEscape(value)}</string>`)
      .join("\n");
    return {
      path: paths.serviceFile,
      content: [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0">',
        '<dict>',
        `\t<key>Label</key>`,
        `\t<string>${xmlEscape(paths.serviceLabel)}</string>`,
        '\t<key>ProgramArguments</key>',
        '\t<array>',
        programArguments,
        '\t</array>',
        '\t<key>WorkingDirectory</key>',
        `\t<string>${xmlEscape(options.runtime.cwd)}</string>`,
        '\t<key>RunAtLoad</key>',
        '\t<true/>',
        '\t<key>KeepAlive</key>',
        '\t<true/>',
        envVars ? '\t<key>EnvironmentVariables</key>' : '',
        envVars ? '\t<dict>' : '',
        envVars,
        envVars ? '\t</dict>' : '',
        '</dict>',
        '</plist>',
        '',
      ].filter(Boolean).join("\n"),
    };
  }

  const envLines = Object.entries(options.runtime.env)
    .map(([key, value]) => `set ${key}=${value.replace(/\r?\n/g, " ")}`)
    .join("\r\n");
  const command = [options.runtime.executable, ...options.runtime.args]
    .map((value) => `"${value.replace(/"/g, '""')}"`)
    .join(" ");
  return {
    path: paths.serviceFile,
    content: [
      "@echo off",
      `cd /d "${options.runtime.cwd.replace(/"/g, '""')}"`,
      envLines,
      `start "" /min ${command}`,
      "",
    ].filter(Boolean).join("\r\n"),
  };
}

function commandSucceeded(command: string, args: string[]): boolean {
  try {
    const result = spawnSync(command, args, {
      encoding: "utf8",
      windowsHide: true,
      timeout: 4000,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

export function detectAutostartStatus(options: {
  platform?: NodeJS.Platform;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
} = {}): RunnerAutostartStatus {
  const paths = getAutostartPaths(options);
  const preference = readAutostartPreference(options);
  let installed = existsSync(paths.serviceFile);
  let detail = installed
    ? `Detected ${paths.installKind} at ${paths.serviceFile}`
    : `No ${paths.installKind} detected at ${paths.serviceFile}`;

  if (paths.platform === "linux" && installed) {
    installed = commandSucceeded("systemctl", ["--user", "is-enabled", `${paths.serviceLabel}.service`]);
    detail = installed
      ? `systemd user service ${paths.serviceLabel}.service is enabled`
      : `systemd unit file exists but ${paths.serviceLabel}.service is not enabled`;
  }

  if (paths.platform === "darwin" && installed) {
    try {
      const uid = userInfo().uid;
      installed = commandSucceeded("launchctl", ["print", `gui/${uid}/${paths.serviceLabel}`]);
      detail = installed
        ? `launchd agent ${paths.serviceLabel} is loaded`
        : `LaunchAgent file exists but ${paths.serviceLabel} is not loaded`;
    } catch {
      detail = `LaunchAgent file exists at ${paths.serviceFile}`;
    }
  }

  return {
    supported: true,
    installed,
    suppressed: preference.suppressServicePrompt,
    installKind: paths.installKind,
    serviceLabel: paths.serviceLabel,
    serviceFile: paths.serviceFile,
    detail,
  };
}

export function installAutostartService(options: {
  scriptPath: string;
  cwd?: string;
  bunPath?: string;
  platform?: NodeJS.Platform;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
}): RunnerAutostartInstallResult {
  const paths = getAutostartPaths(options);
  const runtime = buildRuntimeCommand({
    scriptPath: options.scriptPath,
    cwd: options.cwd,
    bunPath: options.bunPath,
    env: options.env,
  });
  const rendered = renderAutostartFile({
    platform: options.platform,
    homeDir: options.homeDir,
    env: options.env,
    runtime,
  });

  mkdirSync(dirname(rendered.path), { recursive: true });
  mkdirSync(paths.configDir, { recursive: true });
  writeFileSync(rendered.path, rendered.content, "utf8");

  if (paths.platform === "linux") {
    const reloaded = commandSucceeded("systemctl", ["--user", "daemon-reload"]);
    const enabled = commandSucceeded("systemctl", ["--user", "enable", "--now", `${paths.serviceLabel}.service`]);
    const status = detectAutostartStatus(options);
    return {
      ok: reloaded && enabled && status.installed,
      status,
      detail: enabled
        ? `Installed and enabled ${paths.serviceLabel}.service`
        : `Wrote ${rendered.path}, but could not enable ${paths.serviceLabel}.service automatically`,
    };
  }

  if (paths.platform === "darwin") {
    let uid: number | null = null;
    try {
      uid = userInfo().uid;
    } catch {
      uid = null;
    }

    if (uid !== null) {
      commandSucceeded("launchctl", ["bootout", `gui/${uid}`, rendered.path]);
      const bootstrapped = commandSucceeded("launchctl", ["bootstrap", `gui/${uid}`, rendered.path]);
      const kicked = commandSucceeded("launchctl", ["kickstart", "-k", `gui/${uid}/${paths.serviceLabel}`]);
      const status = detectAutostartStatus(options);
      return {
        ok: bootstrapped && kicked && status.installed,
        status,
        detail: bootstrapped
          ? `Installed and loaded ${paths.serviceLabel}`
          : `Wrote ${rendered.path}, but could not load ${paths.serviceLabel} automatically`,
      };
    }
  }

  const status = detectAutostartStatus(options);
  return {
    ok: status.installed,
    status,
    detail: paths.platform === "win32"
      ? `Installed startup entry at ${rendered.path}. It will run on the next sign-in.`
      : `Installed autostart entry at ${rendered.path}`,
  };
}