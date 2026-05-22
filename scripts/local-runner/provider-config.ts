import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAutostartPaths } from "./service-manager";

export interface PersistedProviderConfig {
  provider?: "ollama" | "copilot";
  ollama?: {
    host: string;
    port: number;
    model: string;
  };
  copilot?: {
    model: string;
    via: "copilot" | "gh";
  };
}

function getConfigFile(): string {
  const paths = getAutostartPaths();
  return join(paths.configDir, "provider.json");
}

export function readPersistedProviderConfig(): PersistedProviderConfig {
  try {
    const file = getConfigFile();
    if (!existsSync(file)) return {};
    const raw = readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === "object" ? parsed : {}) as PersistedProviderConfig;
  } catch {
    return {};
  }
}

export function writePersistedProviderConfig(patch: PersistedProviderConfig): void {
  try {
    const paths = getAutostartPaths();
    mkdirSync(paths.configDir, { recursive: true });
    const current = readPersistedProviderConfig();
    const merged: PersistedProviderConfig = { ...current, ...patch };
    writeFileSync(getConfigFile(), JSON.stringify(merged, null, 2), "utf8");
  } catch {
    // Best-effort; the in-memory env vars still keep the choice for the session.
  }
}
