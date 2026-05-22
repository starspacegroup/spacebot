import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { getAutostartPaths } from "./service-manager";

export type PermissionMode = "sandbox" | "home" | "root" | "custom";

export interface PersistedPermissionConfig {
  mode: PermissionMode;
  paths: string[];
  configuredAt: string;
  // If true the user explicitly acknowledged a risky scope (home or root).
  acknowledgedRisk?: boolean;
}

function getConfigFile(): string {
  const paths = getAutostartPaths();
  return join(paths.configDir, "permissions.json");
}

/** Default sandbox folder: ~/spacebot — created on demand. */
export function getDefaultSandboxPath(): string {
  return resolve(join(homedir(), "spacebot"));
}

/** Resolve the canonical paths for a chosen mode. */
export function resolvePathsForMode(mode: PermissionMode, customPaths: string[] = []): string[] {
  switch (mode) {
    case "sandbox":
      return [getDefaultSandboxPath()];
    case "home":
      return [resolve(homedir())];
    case "root":
      return ["/"];
    case "custom":
      return customPaths.map((p) => resolve(p)).filter((p) => p.length > 0);
  }
}

/** Ensure the sandbox directory exists on disk. Best effort; returns true if it exists after. */
export function ensureSandboxDir(): { ok: boolean; path: string; error?: string } {
  const path = getDefaultSandboxPath();
  try {
    if (!existsSync(path)) {
      mkdirSync(path, { recursive: true });
    }
    return { ok: true, path };
  } catch (e) {
    return { ok: false, path, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Read the persisted permission config. Returns null if the user hasn't configured one yet. */
export function readPersistedPermissionConfig(): PersistedPermissionConfig | null {
  try {
    const file = getConfigFile();
    if (!existsSync(file)) return null;
    const raw = readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const mode = parsed.mode;
    if (mode !== "sandbox" && mode !== "home" && mode !== "root" && mode !== "custom") return null;
    const paths = Array.isArray(parsed.paths)
      ? parsed.paths.filter((p: unknown): p is string => typeof p === "string" && p.length > 0)
      : [];
    return {
      mode,
      paths,
      configuredAt: typeof parsed.configuredAt === "string" ? parsed.configuredAt : new Date().toISOString(),
      acknowledgedRisk: Boolean(parsed.acknowledgedRisk),
    };
  } catch {
    return null;
  }
}

export function writePersistedPermissionConfig(config: PersistedPermissionConfig): { ok: boolean; error?: string } {
  try {
    const paths = getAutostartPaths();
    mkdirSync(paths.configDir, { recursive: true });
    writeFileSync(getConfigFile(), JSON.stringify(config, null, 2) + "\n", "utf8");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Clear the persisted permissions, forcing the wizard to ask again next run. */
export function clearPersistedPermissionConfig(): { ok: boolean; error?: string } {
  try {
    const paths = getAutostartPaths();
    mkdirSync(paths.configDir, { recursive: true });
    const file = getConfigFile();
    if (existsSync(file)) {
      writeFileSync(file, "", "utf8");
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Resolve the effective allowed paths for this process.
 * Precedence:
 *   1. RUNNER_ALLOWED_PATHS env var (explicit override)
 *   2. Persisted permission config
 *   3. Empty (no restriction; should only happen when the user picked "Skip" or hasn't run setup)
 */
export function resolveEffectiveAllowedPaths(): { paths: string[]; source: "env" | "persisted" | "none"; mode: PermissionMode | null } {
  if (process.env.RUNNER_ALLOWED_PATHS) {
    return {
      paths: process.env.RUNNER_ALLOWED_PATHS.split(":").map((p) => resolve(p)).filter((p) => p.length > 0),
      source: "env",
      mode: null,
    };
  }
  const persisted = readPersistedPermissionConfig();
  if (persisted) {
    return { paths: persisted.paths, source: "persisted", mode: persisted.mode };
  }
  return { paths: [], source: "none", mode: null };
}

export function describePermissionMode(mode: PermissionMode): string {
  switch (mode) {
    case "sandbox": return "Sandbox (~/spacebot)";
    case "home":    return "Home directory (~/)";
    case "root":    return "Entire filesystem (/)";
    case "custom":  return "Custom paths";
  }
}
