import { cpus, hostname, release, totalmem, uptime, userInfo } from "node:os";
import { env, platform, arch } from "node:process";
import { spawnSync } from "node:child_process";

export interface RunnerDisplay {
  id: string;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  primary: boolean;
}

export interface RunnerSystemProfile {
  collectedAt: string;
  os: {
    platform: string;
    release: string;
    arch: string;
    hostname: string;
    username: string | null;
  };
  hardware: {
    cpuCount: number;
    totalMemoryBytes: number;
    uptimeSeconds: number;
  };
  displays: {
    count: number;
    arrangementKnown: boolean;
    items: RunnerDisplay[];
  };
  installedApps: {
    mode: "light";
    packageManagers: string[];
    tools: Record<string, boolean>;
  };
  capabilities: {
    screenshotAvailable: boolean;
    workspaceMetadataAvailable: boolean;
    vscodeControlAvailable: boolean;
    copilotMessageAvailable: boolean;
  };
}

function runCommand(command: string, args: string[]): string {
  try {
    const result = spawnSync(command, args, {
      encoding: "utf8",
      timeout: 2000,
      windowsHide: true,
    });
    if (result.status !== 0 || !result.stdout) return "";
    return result.stdout.trim();
  } catch {
    return "";
  }
}

function commandExists(command: string): boolean {
  if (platform === "win32") {
    return runCommand("where", [command]).length > 0;
  }
  return runCommand("which", [command]).length > 0;
}

function detectDisplaysLinux(): RunnerDisplay[] {
  const out = runCommand("xrandr", ["--query"]);
  if (!out) return [];

  const displays: RunnerDisplay[] = [];
  for (const line of out.split("\n")) {
    if (!line.includes(" connected ")) continue;

    const primary = line.includes(" primary ");
    const id = line.split(" ")[0] || `display-${displays.length + 1}`;

    const match = line.match(/(\d+)x(\d+)\+(\d+)\+(\d+)/);
    if (!match) continue;

    displays.push({
      id,
      name: id,
      width: Number(match[1]),
      height: Number(match[2]),
      x: Number(match[3]),
      y: Number(match[4]),
      primary,
    });
  }

  return displays;
}

function detectDisplaysMac(): RunnerDisplay[] {
  const out = runCommand("system_profiler", ["SPDisplaysDataType", "-json"]);
  if (!out) return [];

  try {
    const parsed = JSON.parse(out);
    const gpuItems = parsed?.SPDisplaysDataType;
    if (!Array.isArray(gpuItems)) return [];

    const displays: RunnerDisplay[] = [];
    for (const gpu of gpuItems) {
      const nd = gpu?.spdisplays_ndrvs;
      if (!Array.isArray(nd)) continue;
      for (const d of nd) {
        const res = typeof d?._spdisplays_resolution === "string" ? d._spdisplays_resolution : "";
        const match = res.match(/(\d+)\s*x\s*(\d+)/i);
        if (!match) continue;

        displays.push({
          id: d?._name || `display-${displays.length + 1}`,
          name: d?._name || undefined,
          width: Number(match[1]),
          height: Number(match[2]),
          x: 0,
          y: 0,
          primary: displays.length === 0,
        });
      }
    }

    return displays;
  } catch {
    return [];
  }
}

function detectDisplaysWindows(): RunnerDisplay[] {
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms;",
    "$i=0;",
    "[System.Windows.Forms.Screen]::AllScreens | ForEach-Object {",
    "$i=$i+1;",
    "Write-Output (\"$i|\" + $_.DeviceName + \"|\" + $_.Bounds.X + \"|\" + $_.Bounds.Y + \"|\" + $_.Bounds.Width + \"|\" + $_.Bounds.Height + \"|\" + $_.Primary)",
    "}",
  ].join(" ");

  const out = runCommand("powershell", ["-NoProfile", "-Command", script]);
  if (!out) return [];

  const displays: RunnerDisplay[] = [];
  for (const line of out.split("\n")) {
    const [idx, name, x, y, width, height, primary] = line.split("|");
    if (!idx || !width || !height) continue;
    displays.push({
      id: `display-${idx}`,
      name,
      x: Number(x || 0),
      y: Number(y || 0),
      width: Number(width),
      height: Number(height),
      primary: String(primary).toLowerCase() === "true",
    });
  }

  return displays;
}

function detectDisplays(): RunnerDisplay[] {
  if (platform === "linux") return detectDisplaysLinux();
  if (platform === "darwin") return detectDisplaysMac();
  if (platform === "win32") return detectDisplaysWindows();
  return [];
}

function detectPackageManagers(): string[] {
  const managers = ["bun", "npm", "pnpm", "yarn", "pip", "brew", "choco", "winget", "apt", "dnf", "pacman"];
  return managers.filter((name) => commandExists(name));
}

function detectCommonTools(): Record<string, boolean> {
  const tools = ["git", "node", "bun", "python", "python3", "code", "docker", "gh"];
  const entries = tools.map((name) => [name, commandExists(name)]);
  return Object.fromEntries(entries);
}

export function gatherSystemProfile(): RunnerSystemProfile {
  const displays = detectDisplays();
  const hasDisplayEnv = Boolean(env.DISPLAY || env.WAYLAND_DISPLAY || platform === "win32" || platform === "darwin");
  const hasCodeCli = commandExists("code");
  const hasBridgeUrl = Boolean(env.RUNNER_VSCODE_BRIDGE_URL || env.RUNNER_VSCODE_BRIDGE_TOKEN);
  const hasBridgeToken = Boolean(env.RUNNER_VSCODE_BRIDGE_TOKEN);
  const screenshotEnabled = env.RUNNER_ENABLE_SCREENSHOTS === "1";
  const vscodeControlEnabled = env.RUNNER_ENABLE_VSCODE_CONTROL !== "0";
  const copilotChatEnabled = env.RUNNER_ENABLE_COPILOT_CHAT === "1";

  return {
    collectedAt: new Date().toISOString(),
    os: {
      platform,
      release: release(),
      arch,
      hostname: hostname(),
      username: (() => {
        try {
          return userInfo().username;
        } catch {
          return null;
        }
      })(),
    },
    hardware: {
      cpuCount: cpus().length,
      totalMemoryBytes: totalmem(),
      uptimeSeconds: Math.floor(uptime()),
    },
    displays: {
      count: displays.length,
      arrangementKnown: displays.length > 0,
      items: displays,
    },
    installedApps: {
      mode: "light",
      packageManagers: detectPackageManagers(),
      tools: detectCommonTools(),
    },
    capabilities: {
      screenshotAvailable: hasDisplayEnv && screenshotEnabled,
      workspaceMetadataAvailable: platform === "win32" || platform === "darwin" || Boolean(env.DISPLAY),
      vscodeControlAvailable: vscodeControlEnabled && (hasCodeCli || hasBridgeUrl),
      copilotMessageAvailable: copilotChatEnabled && hasBridgeToken,
    },
  };
}
