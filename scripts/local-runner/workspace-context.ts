import { platform } from "node:process";
import { spawnSync } from "node:child_process";

export interface WorkspaceContext {
  available: boolean;
  platform: string;
  currentWorkspace: string | null;
  workspaces: Array<Record<string, unknown>>;
  windows: Array<Record<string, unknown>>;
  reason?: string;
}

function runCommand(command: string, args: string[]): string {
  try {
    const result = spawnSync(command, args, {
      encoding: "utf8",
      timeout: 2500,
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

function collectLinuxContext(): WorkspaceContext {
  if (!commandExists("wmctrl")) {
    return {
      available: false,
      platform,
      currentWorkspace: null,
      workspaces: [],
      windows: [],
      reason: "wmctrl_not_installed",
    };
  }

  const desktopsOut = runCommand("wmctrl", ["-d"]);
  const windowsOut = runCommand("wmctrl", ["-l"]);

  const workspaces = desktopsOut
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      return {
        id: parts[0] ?? null,
        current: parts[1] === "*",
        raw: line,
      };
    });

  const current = workspaces.find((w) => w.current)?.id ?? null;

  const windows = windowsOut
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      return {
        windowId: parts[0] ?? null,
        workspaceId: parts[1] ?? null,
        raw: line,
      };
    });

  return {
    available: true,
    platform,
    currentWorkspace: current,
    workspaces,
    windows,
  };
}

function collectMacContext(): WorkspaceContext {
  const frontApp = runCommand("osascript", [
    "-e",
    "tell application \"System Events\" to get name of first process whose frontmost is true",
  ]);

  if (!frontApp) {
    return {
      available: false,
      platform,
      currentWorkspace: null,
      workspaces: [],
      windows: [],
      reason: "osascript_unavailable_or_denied",
    };
  }

  return {
    available: true,
    platform,
    currentWorkspace: frontApp,
    workspaces: [{ id: "frontmost-app", name: frontApp }],
    windows: [],
  };
}

function collectWindowsContext(): WorkspaceContext {
  const ps = runCommand("powershell", [
    "-NoProfile",
    "-Command",
    "Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object -First 20 ProcessName,MainWindowTitle | ForEach-Object { Write-Output ($_.ProcessName + '|' + $_.MainWindowTitle) }",
  ]);

  if (!ps) {
    return {
      available: false,
      platform,
      currentWorkspace: null,
      workspaces: [],
      windows: [],
      reason: "window_listing_unavailable",
    };
  }

  const windows = ps
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [processName, title] = line.split("|");
      return {
        processName: processName ?? null,
        title: title ?? null,
      };
    });

  return {
    available: true,
    platform,
    currentWorkspace: "windows-desktop",
    workspaces: [{ id: "windows-desktop" }],
    windows,
  };
}

export function collectWorkspaceContext(): WorkspaceContext {
  if (platform === "linux") return collectLinuxContext();
  if (platform === "darwin") return collectMacContext();
  if (platform === "win32") return collectWindowsContext();

  return {
    available: false,
    platform,
    currentWorkspace: null,
    workspaces: [],
    windows: [],
    reason: "unsupported_platform",
  };
}
