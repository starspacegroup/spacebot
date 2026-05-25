#!/usr/bin/env bun
/**
 * SpaceBot Local Runner
 *
 * Connects to the SpaceBot server via WebSocket, receives jobs in real time,
 * executes them locally as shell commands, and reports results back over the
 * same connection.
 *
 * Usage:
 *   SPACEBOT_RUNNER_TOKEN=sbr_... bun run scripts/local-runner/index.ts
 *
 * Config (env vars):
 *   SPACEBOT_RUNNER_TOKEN    – Required. Runner token from Account > Local Runners.
 *   SPACEBOT_API_URL         – Optional. Defaults to https://spacebot.starspace.group
 *   RUNNER_DEFAULT_WORKDIR   – Optional. Default working directory for commands.
 *   RUNNER_MAX_OUTPUT_BYTES  – Optional. Max captured output per job (default 65536).
 *   RUNNER_ALLOWED_PATHS     – Optional. Colon-separated list of path prefixes that
 *                              working_dir must start with (security allowlist). When
 *                              unset, the runner reads ~/.config/spacebot/permissions.json
 *                              (or the platform equivalent) written by the interactive
 *                              startup wizard. When that's missing too, all paths are
 *                              accepted and a loud warning is logged.
 *   RUNNER_SHELL             – Optional. Shell to use (default: /bin/sh on Unix, cmd.exe on Windows).
 *   RUNNER_RECONNECT_BASE_MS – Optional. Base reconnect delay in ms (default 1000).
 *   RUNNER_DISPLAY_NAME      – Optional. Human-readable name for this machine.
 *   RUNNER_INSTANCE_KEY      – Optional. Stable unique key for this installation.
 */

import { spawn } from "bun";
import { delimiter, dirname, join, resolve } from "node:path";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, hostname, release, tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { gatherSystemProfile } from "./capabilities";
import { bridgeDiscover, bridgeOpenWorkspace, bridgeSendCopilotMessage } from "./vscode-bridge-client";
import { collectWorkspaceContext } from "./workspace-context";
import { resolveEffectiveAllowedPaths } from "./permission-config";
import {
  DEFAULT_COPILOT_MODEL,
  detectCopilotAvailability,
  getCopilotConfig,
  runCopilotPrompt,
} from "./copilot-utils";
import { detectOllamaRunning, generateOllamaResponse, getOllamaConfig } from "./ollama-utils";
import { readPersistedProviderConfig } from "./provider-config";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TOKEN = process.env.SPACEBOT_RUNNER_TOKEN ?? "";
const API_URL = (process.env.SPACEBOT_API_URL ?? "https://spacebot.starspace.group").replace(/\/$/, "");
const DEFAULT_WORKDIR = process.env.RUNNER_DEFAULT_WORKDIR ?? process.cwd();
const MAX_OUTPUT_BYTES = Number(process.env.RUNNER_MAX_OUTPUT_BYTES ?? "65536");
const PERMISSION_RESOLUTION = resolveEffectiveAllowedPaths();
const ALLOWED_PATHS: string[] = PERMISSION_RESOLUTION.paths;
const PERMISSION_SOURCE = PERMISSION_RESOLUTION.source;
const PERMISSION_MODE = PERMISSION_RESOLUTION.mode;
const IS_WINDOWS = process.platform === "win32";
const SHELL = process.env.RUNNER_SHELL ?? (IS_WINDOWS ? "cmd.exe" : "/bin/sh");
const SHELL_FLAG = IS_WINDOWS ? "/C" : "-c";
const RECONNECT_BASE_MS = Number(process.env.RUNNER_RECONNECT_BASE_MS ?? "1000");
const RECONNECT_MAX_MS = 60_000;
const CLIENT_HEARTBEAT_INTERVAL_MS = Number(process.env.RUNNER_HEARTBEAT_MS ?? "20000");
const CODE_WATCH_INTERVAL_MS = Number(process.env.RUNNER_CODE_WATCH_INTERVAL_MS ?? "3000");
const MAX_ARTIFACT_BYTES = Number(process.env.RUNNER_MAX_ARTIFACT_BYTES ?? "2000000");
const HOSTNAME = hostname();
const RUNNER_VERSION = "2026.05.07";
const FORCE_HEADLESS = process.argv.includes("--headless")
  || process.env.RUNNER_TUI_DISABLE === "1"
  || process.env.RUNNER_TUI_CHILD === "1"
  || !process.stdin.isTTY;
const SPACEBOT_STATE_DIR = join(homedir(), ".spacebot");
const SYSTEM_MD_PATH = join(SPACEBOT_STATE_DIR, "SYSTEM.md");
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const LOCAL_RUNNER_DIR = resolve(dirname(SCRIPT_PATH));
const REPO_ROOT_DIR = resolve(LOCAL_RUNNER_DIR, "..", "..");
const INSTANCE_KEY = process.env.RUNNER_INSTANCE_KEY
  ?? `sbrinst_${createHash("sha256").update([HOSTNAME, process.platform, process.arch, DEFAULT_WORKDIR].join("::")).digest("hex").slice(0, 24)}`;
const DISPLAY_NAME = process.env.RUNNER_DISPLAY_NAME ?? `${HOSTNAME} (${process.platform}/${process.arch})`;
const WATCH_PATH_SPLIT = process.env.RUNNER_WATCH_PATHS
  ? process.env.RUNNER_WATCH_PATHS.split(delimiter)
  : [LOCAL_RUNNER_DIR, join(REPO_ROOT_DIR, "package.json"), join(REPO_ROOT_DIR, "bun.lock")];
const RUNNER_WATCH_PATHS = WATCH_PATH_SPLIT.map((entry) => resolve(entry.trim())).filter(Boolean);

// Build the WebSocket URL (http→ws, https→wss)
const WS_URL = API_URL.replace(/^http/, "ws") + `/api/runner/ws?token=${encodeURIComponent(TOKEN)}`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Job {
  id: number;
  command: string;
  working_dir: string | null;
  label: string | null;
  job_type?: string | null;
  payload_json?: unknown;
  target_instance_id?: number | null;
}

interface JobResult {
  status: "completed" | "failed";
  output: string;
  exitCode: number;
  truncated: boolean;
  result?: unknown;
  artifactRefs?: unknown[];
}

interface RunnerHelloPayload {
  instanceKey: string;
  displayName: string;
  hostname: string;
  platform: string;
  platformRelease: string;
  arch: string;
  runnerVersion: string;
  defaultWorkdir: string;
  metadata: {
    shell: string;
    pid: number;
    allowedPaths: string[];
    maxOutputBytes: number;
    maxArtifactBytes: number;
    capabilities: {
      screenshotAvailable: boolean;
      workspaceMetadataAvailable: boolean;
      vscodeControlAvailable: boolean;
      copilotMessageAvailable: boolean;
    };
    llm: {
      preferredProvider: LlmProvider | null;
      chain: Array<{
        provider: LlmProvider;
        model: string | null;
        via: "copilot" | "gh" | null;
      }>;
      copilot: {
        configured: boolean;
        model: string | null;
        via: "copilot" | "gh" | null;
      };
      ollama: {
        configured: boolean;
        model: string | null;
        host: string | null;
        port: number | null;
      };
    };
    systemProfile: unknown;
  };
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(...args: unknown[]) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

function warn(...args: unknown[]) {
  console.warn(`[${new Date().toISOString()}] WARN`, ...args);
}

function err(...args: unknown[]) {
  console.error(`[${new Date().toISOString()}] ERR`, ...args);
}

let activeSocket: WebSocket | null = null;
let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
let lastServerMessageAt = 0;
// Server sends a heartbeat every 30 s. If we go 3× that without any server
// message the TCP connection has silently died and we must force-reconnect.
const DEAD_SOCKET_THRESHOLD_MS = 90_000;
let codeWatchTimer: ReturnType<typeof setInterval> | null = null;
let codeWatchSignature = "";
let codeRestartRequested = false;

function stopKeepalive() {
  if (!keepaliveTimer) return;
  clearInterval(keepaliveTimer);
  keepaliveTimer = null;
}

function startKeepalive() {
  stopKeepalive();
  keepaliveTimer = setInterval(() => {
    // Watchdog: detect silent TCP drops where no close/error event fires.
    if (lastServerMessageAt > 0 && Date.now() - lastServerMessageAt > DEAD_SOCKET_THRESHOLD_MS) {
      const dead = activeSocket;
      activeSocket = null;
      stopKeepalive();
      if (dead) { try { dead.close(); } catch {} }
      if (!running) return;
      reconnectAttempts++;
      const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, reconnectAttempts - 1), RECONNECT_MAX_MS);
      warn(`WebSocket closed (code 0). Reconnecting in ${delay}ms… (attempt ${reconnectAttempts})`);
      setTimeout(connect, delay);
      return;
    }
    sendJson({ type: "pong", instance: buildHelloPayload() });
  }, Math.max(5_000, CLIENT_HEARTBEAT_INTERVAL_MS));
}

function stopCodeWatcher() {
  if (!codeWatchTimer) return;
  clearInterval(codeWatchTimer);
  codeWatchTimer = null;
}

function collectWatchFiles(targetPath: string, output: string[]) {
  let stat;
  try {
    stat = statSync(targetPath);
  } catch {
    return;
  }

  if (stat.isFile()) {
    output.push(targetPath);
    return;
  }
  if (!stat.isDirectory()) return;

  let entries: string[] = [];
  try {
    entries = readdirSync(targetPath);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry === ".git" || entry === "node_modules" || entry.startsWith(".")) continue;
    collectWatchFiles(join(targetPath, entry), output);
  }
}

function computeCodeWatchSignature(paths: string[]): string {
  const files: string[] = [];
  for (const path of paths) {
    collectWatchFiles(path, files);
  }

  if (files.length === 0) return "";

  let newestTime = 0;
  let newestFile = files[0] ?? "";
  for (const file of files) {
    try {
      const mtime = statSync(file).mtimeMs;
      if (mtime > newestTime) {
        newestTime = mtime;
        newestFile = file;
      }
    } catch {
      // File vanished between directory scan and stat.
    }
  }

  return `${files.length}:${Math.floor(newestTime)}:${newestFile}`;
}

function startCodeWatcher() {
  if (CODE_WATCH_INTERVAL_MS <= 0 || RUNNER_WATCH_PATHS.length === 0) return;
  codeWatchSignature = computeCodeWatchSignature(RUNNER_WATCH_PATHS);

  codeWatchTimer = setInterval(() => {
    if (!running || shuttingDown || codeRestartRequested) return;
    const nextSignature = computeCodeWatchSignature(RUNNER_WATCH_PATHS);
    if (!nextSignature || nextSignature === codeWatchSignature) return;

    codeRestartRequested = true;
    const message = "Code update detected. Restarting runner to load latest changes.";
    warn(message);
    sendRunnerEvent("runner.restarting", message, { watchPaths: RUNNER_WATCH_PATHS }, "warn");
    void gracefulShutdown("codebase update detected").finally(() => process.exit(75));
  }, CODE_WATCH_INTERVAL_MS);
}

function sendJson(payload: unknown) {
  if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) return;
  activeSocket.send(JSON.stringify(payload));
}

function sendRunnerEvent(eventType: string, message: string, details?: Record<string, unknown>, level: "info" | "warn" | "error" = "info", jobId?: number) {
  sendJson({
    type: "event",
    eventType,
    level,
    message,
    details,
    jobId,
  });
}

function getPreferredProvider(): LlmProvider | null {
  const persisted = readPersistedProviderConfig();
  if (process.env.SPACEBOT_LLM_PROVIDER === "copilot" || process.env.SPACEBOT_LLM_PROVIDER === "ollama") {
    return process.env.SPACEBOT_LLM_PROVIDER;
  }
  if (persisted.provider === "copilot" || persisted.provider === "ollama") {
    return persisted.provider;
  }
  return null;
}

function buildProviderMetadata() {
  const persisted = readPersistedProviderConfig();
  const copilotCfg = getCopilotConfig() ?? (persisted.copilot
    ? { model: persisted.copilot.model, via: persisted.copilot.via }
    : null);
  const ollamaCfg = getOllamaConfig() ?? (persisted.ollama
    ? { host: persisted.ollama.host, port: persisted.ollama.port, model: persisted.ollama.model }
    : null);
  const chain = resolveProviderChain({}).map((entry) => ({
    provider: entry.provider,
    model: entry.model ?? null,
    via: entry.via ?? null,
  }));

  return {
    preferredProvider: getPreferredProvider(),
    chain,
    copilot: {
      configured: Boolean(copilotCfg),
      model: copilotCfg?.model ?? null,
      via: copilotCfg?.via ?? null,
    },
    ollama: {
      configured: Boolean(ollamaCfg),
      model: ollamaCfg?.model ?? null,
      host: ollamaCfg?.host ?? null,
      port: ollamaCfg?.port ?? null,
    },
  };
}

function buildHelloPayload(): RunnerHelloPayload {
  const profile = gatherSystemProfile();
  return {
    instanceKey: INSTANCE_KEY,
    displayName: DISPLAY_NAME,
    hostname: HOSTNAME,
    platform: process.platform,
    platformRelease: release(),
    arch: process.arch,
    runnerVersion: RUNNER_VERSION,
    defaultWorkdir: DEFAULT_WORKDIR,
    metadata: {
      shell: SHELL,
      pid: process.pid,
      allowedPaths: ALLOWED_PATHS,
      maxOutputBytes: MAX_OUTPUT_BYTES,
      maxArtifactBytes: MAX_ARTIFACT_BYTES,
      capabilities: profile.capabilities,
      llm: buildProviderMetadata(),
      systemProfile: profile,
    },
  };
}

function commandExists(command: string): boolean {
  try {
    const probe = IS_WINDOWS
      ? spawnSync("where", [command], { encoding: "utf8", windowsHide: true })
      : spawnSync("which", [command], { encoding: "utf8" });
    return probe.status === 0 && Boolean(probe.stdout?.trim());
  } catch {
    return false;
  }
}

function parsePayload(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object") return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      return {};
    }
  }
  return {};
}

type LlmProvider = "ollama" | "copilot";

interface ProviderChainEntry {
  provider: LlmProvider;
  model?: string;
  host?: string;
  port?: number;
  via?: "copilot" | "gh";
}

interface ProviderAttempt {
  provider: LlmProvider;
  model: string;
  ok: boolean;
  error?: string;
  durationMs?: number;
  via?: string;
}

let cachedCopilotAvailability: Awaited<ReturnType<typeof detectCopilotAvailability>> | null = null;

function stringifyHistory(history: unknown): string {
  if (!Array.isArray(history)) return "";

  const lines: string[] = [];
  for (const entry of history.slice(-20)) {
    if (!entry || typeof entry !== "object") continue;
    const role = typeof (entry as Record<string, unknown>).role === "string"
      ? ((entry as Record<string, unknown>).role as string)
      : "user";
    const content = typeof (entry as Record<string, unknown>).content === "string"
      ? ((entry as Record<string, unknown>).content as string).trim()
      : "";
    if (!content) continue;
    lines.push(`${role}: ${content}`);
  }

  return lines.join("\n");
}

function buildDmPrompt(payload: Record<string, unknown>): string {
  const userName = typeof payload.user_name === "string" ? payload.user_name : "Discord user";
  const userMessage = typeof payload.message === "string" ? payload.message.trim() : "";
  const historyText = stringifyHistory(payload.history);
  const contextBlock = historyText
    ? `Conversation history:\n${historyText}\n\n`
    : "";

  return [
    "You are SpaceBot replying in a Discord DM.",
    "Answer clearly and directly.",
    "If the request is unclear, ask one concise follow-up question.",
    "Do not include role labels or metadata in your answer.",
    "",
    contextBlock,
    `${userName} says: ${userMessage}`,
    "",
    "Reply:",
  ].join("\n");
}

function parseProviderChainInput(value: unknown): ProviderChainEntry[] {
  const raw = Array.isArray(value) ? value : [];
  const items: ProviderChainEntry[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    const provider = candidate.provider === "ollama" || candidate.provider === "copilot"
      ? candidate.provider
      : null;
    if (!provider) continue;
    const item: ProviderChainEntry = { provider };
    if (typeof candidate.model === "string" && candidate.model.trim()) item.model = candidate.model.trim();
    if (typeof candidate.host === "string" && candidate.host.trim()) item.host = candidate.host.trim();
    if (typeof candidate.port === "number" && Number.isFinite(candidate.port)) item.port = Math.trunc(candidate.port);
    if (candidate.via === "copilot" || candidate.via === "gh") item.via = candidate.via;
    items.push(item);
  }

  return items;
}

function dedupeProviderChain(entries: ProviderChainEntry[]): ProviderChainEntry[] {
  const out: ProviderChainEntry[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = [entry.provider, entry.model ?? "", entry.host ?? "", String(entry.port ?? ""), entry.via ?? ""].join("::");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

function resolveProviderChain(payload: Record<string, unknown>): ProviderChainEntry[] {
  const persisted = readPersistedProviderConfig();

  const fromPayload = parseProviderChainInput(payload.provider_chain);
  if (fromPayload.length > 0) return dedupeProviderChain(fromPayload);

  const fromEnv: ProviderChainEntry[] = (() => {
    try {
      const raw = process.env.SPACEBOT_PROVIDER_CHAIN;
      if (!raw) return [];
      return parseProviderChainInput(JSON.parse(raw));
    } catch {
      return [];
    }
  })();
  if (fromEnv.length > 0) return dedupeProviderChain(fromEnv);

  const fromPersisted = parseProviderChainInput(persisted.chain);
  if (fromPersisted.length > 0) return dedupeProviderChain(fromPersisted);

  const copilotCfg = getCopilotConfig() ?? (persisted.copilot
    ? { model: persisted.copilot.model, via: persisted.copilot.via }
    : null);
  const ollamaCfg = getOllamaConfig() ?? (persisted.ollama
    ? { host: persisted.ollama.host, port: persisted.ollama.port, model: persisted.ollama.model }
    : null);

  const preferred = process.env.SPACEBOT_LLM_PROVIDER === "copilot" || process.env.SPACEBOT_LLM_PROVIDER === "ollama"
    ? process.env.SPACEBOT_LLM_PROVIDER
    : (persisted.provider === "copilot" || persisted.provider === "ollama" ? persisted.provider : null);

  const defaults: ProviderChainEntry[] = [];
  const addCopilot = () => {
    if (!copilotCfg) return;
    defaults.push({ provider: "copilot", model: copilotCfg.model || DEFAULT_COPILOT_MODEL, via: copilotCfg.via });
  };
  const addOllama = () => {
    if (!ollamaCfg) return;
    defaults.push({ provider: "ollama", model: ollamaCfg.model, host: ollamaCfg.host, port: ollamaCfg.port });
  };

  if (preferred === "copilot") {
    addCopilot();
    addOllama();
  } else if (preferred === "ollama") {
    addOllama();
    addCopilot();
  } else {
    addCopilot();
    addOllama();
  }

  return dedupeProviderChain(defaults);
}

async function runPromptThroughProviderChain(prompt: string, payload: Record<string, unknown>): Promise<{
  ok: boolean;
  text?: string;
  attempts: ProviderAttempt[];
}> {
  const chain = resolveProviderChain(payload);
  const attempts: ProviderAttempt[] = [];

  for (const entry of chain) {
    if (entry.provider === "copilot") {
      const model = entry.model || DEFAULT_COPILOT_MODEL;
      if (!cachedCopilotAvailability) {
        cachedCopilotAvailability = await detectCopilotAvailability();
      }
      const availability = cachedCopilotAvailability;
      if (!availability.copilotCli && !availability.ghCopilot) {
        attempts.push({
          provider: "copilot",
          model,
          ok: false,
          error: "Copilot CLI is not available on this runner",
        });
        continue;
      }

      const result = await runCopilotPrompt(prompt, availability, {
        model,
        preferVia: entry.via,
      });

      if (result.ok && typeof result.text === "string" && result.text.trim()) {
        attempts.push({
          provider: "copilot",
          model,
          ok: true,
          durationMs: result.durationMs,
          via: result.via,
        });
        return { ok: true, text: result.text.trim(), attempts };
      }

      attempts.push({
        provider: "copilot",
        model,
        ok: false,
        error: result.error ?? "Copilot returned no output",
        durationMs: result.durationMs,
      });
      continue;
    }

    const persisted = readPersistedProviderConfig();
    const configured = getOllamaConfig() ?? persisted.ollama ?? null;
    const host = entry.host || configured?.host || "localhost";
    const port = entry.port || configured?.port || 11434;
    const model = entry.model || configured?.model || "";

    if (!model) {
      attempts.push({
        provider: "ollama",
        model: "(missing)",
        ok: false,
        error: "No Ollama model configured",
      });
      continue;
    }

    const running = await detectOllamaRunning(host, port);
    if (!running) {
      attempts.push({
        provider: "ollama",
        model,
        ok: false,
        error: `Ollama is not reachable at ${host}:${port}`,
      });
      continue;
    }

    const generated = await generateOllamaResponse({
      host,
      port,
      model,
      prompt,
    });

    if (generated.ok && generated.text.trim()) {
      attempts.push({
        provider: "ollama",
        model,
        ok: true,
        durationMs: generated.stats.totalDurationMs,
      });
      return { ok: true, text: generated.text.trim(), attempts };
    }

    attempts.push({
      provider: "ollama",
      model,
      ok: false,
      error: generated.ok ? "Ollama returned no output" : generated.error,
    });
  }

  return { ok: false, attempts };
}

interface PreparedArtifact {
  artifactType: string;
  mimeType: string;
  byteSize: number;
  width?: number;
  height?: number;
  captureSource?: string;
  captureIndex?: number;
  storageMode: string;
  blobBase64: string;
}

function encodeArtifact(buffer: Buffer, options: { width?: number; height?: number; captureSource?: string; captureIndex?: number }): PreparedArtifact {
  return {
    artifactType: "screenshot",
    mimeType: "image/png",
    byteSize: buffer.length,
    width: options.width,
    height: options.height,
    captureSource: options.captureSource,
    captureIndex: options.captureIndex,
    storageMode: "inline_base64",
    blobBase64: buffer.toString("base64"),
  };
}

function captureScreenshotBuffer(): Buffer {
  const tempPath = `${tmpdir()}/spacebot-runner-${Date.now()}-${Math.random().toString(16).slice(2)}.png`;

  const SCREENSHOT_TIMEOUT_MS = 30_000;

  if (process.platform === "darwin") {
    const result = spawnSync("screencapture", ["-x", tempPath], { encoding: "utf8", timeout: SCREENSHOT_TIMEOUT_MS });
    if (result.signal === "SIGTERM" || result.error?.message?.includes("ETIMEDOUT")) {
      throw new Error("screencapture timed out (30s) — is the display available?");
    }
    if (result.status !== 0) {
      throw new Error(result.stderr?.trim() || "screencapture failed");
    }
  } else if (IS_WINDOWS) {
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms;",
      "Add-Type -AssemblyName System.Drawing;",
      "$b=[System.Windows.Forms.SystemInformation]::VirtualScreen;",
      "$img=New-Object System.Drawing.Bitmap $b.Width,$b.Height;",
      "$g=[System.Drawing.Graphics]::FromImage($img);",
      "$g.CopyFromScreen($b.X,$b.Y,0,0,$img.Size);",
      `$img.Save('${tempPath.replace(/\\/g, "/")}', [System.Drawing.Imaging.ImageFormat]::Png);`,
      "$g.Dispose();",
      "$img.Dispose();",
    ].join(" ");

    const result = spawnSync("powershell", ["-NoProfile", "-Command", script], {
      encoding: "utf8",
      windowsHide: true,
      timeout: SCREENSHOT_TIMEOUT_MS,
    });

    if (result.signal === "SIGTERM" || result.error?.message?.includes("ETIMEDOUT")) {
      throw new Error("PowerShell screenshot timed out (30s)");
    }
    if (result.status !== 0) {
      throw new Error(result.stderr?.trim() || "PowerShell screenshot failed");
    }
  } else {
    const command = [
      'if command -v grim >/dev/null 2>&1; then grim "$1";',
      'elif command -v gnome-screenshot >/dev/null 2>&1; then gnome-screenshot -f "$1";',
      'elif command -v import >/dev/null 2>&1; then import -window root "$1";',
      "else exit 127; fi",
    ].join(" ");

    const result = spawnSync(SHELL, [SHELL_FLAG, command, "--", tempPath], { encoding: "utf8", timeout: SCREENSHOT_TIMEOUT_MS });
    if (result.signal === "SIGTERM" || result.error?.message?.includes("ETIMEDOUT")) {
      throw new Error("Screenshot tool timed out (30s) — is WAYLAND_DISPLAY or DISPLAY set?");
    }
    if (result.status !== 0) {
      throw new Error(result.stderr?.trim() || "No Linux screenshot utility available");
    }
  }

  if (!existsSync(tempPath)) {
    throw new Error("Screenshot file was not created");
  }

  const buf = readFileSync(tempPath);
  try {
    unlinkSync(tempPath);
  } catch {
    // Best effort cleanup.
  }
  return buf;
}

function captureWindowsPerDisplayArtifacts(): PreparedArtifact[] {
  const tempDir = mkdtempSync(join(tmpdir(), "spacebot-runner-screens-"));
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms;",
    "Add-Type -AssemblyName System.Drawing;",
    `$dir='${tempDir.replace(/\\/g, "/")}';`,
    "$i=0;",
    "[System.Windows.Forms.Screen]::AllScreens | ForEach-Object {",
    "$bounds=$_.Bounds;",
    "$path=Join-Path $dir (\"screen-\" + $i + \".png\");",
    "$bmp=New-Object System.Drawing.Bitmap $bounds.Width,$bounds.Height;",
    "$g=[System.Drawing.Graphics]::FromImage($bmp);",
    "$g.CopyFromScreen($bounds.X,$bounds.Y,0,0,$bmp.Size);",
    "$bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png);",
    "$g.Dispose();",
    "$bmp.Dispose();",
    "Write-Output ($path + '|' + $bounds.Width + '|' + $bounds.Height + '|' + $_.DeviceName + '|' + $i);",
    "$i=$i+1;",
    "}",
  ].join(" ");

  const result = spawnSync("powershell", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
  });

  if (result.signal === "SIGTERM" || result.error?.message?.includes("ETIMEDOUT")) {
    rmSync(tempDir, { recursive: true, force: true });
    throw new Error("PowerShell per-display screenshot timed out (30s)");
  }
  if (result.status !== 0) {
    rmSync(tempDir, { recursive: true, force: true });
    throw new Error(result.stderr?.trim() || "PowerShell per-display screenshot failed");
  }

  const lines = (result.stdout || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const artifacts: PreparedArtifact[] = [];

  for (const line of lines) {
    const [path, width, height, source, index] = line.split("|");
    if (!path || !existsSync(path)) continue;
    const buf = readFileSync(path);
    if (buf.length > MAX_ARTIFACT_BYTES) {
      throw new Error(`Screenshot exceeds RUNNER_MAX_ARTIFACT_BYTES for ${source || path}`);
    }
    artifacts.push(encodeArtifact(buf, {
      width: Number(width) || undefined,
      height: Number(height) || undefined,
      captureSource: source || "display",
      captureIndex: Number(index) || artifacts.length,
    }));
  }

  rmSync(tempDir, { recursive: true, force: true });
  return artifacts;
}

function captureMacPerDisplayArtifacts(displayItems: Array<Record<string, unknown>>): PreparedArtifact[] {
  if (!commandExists("screencapture")) {
    throw new Error("screencapture is not available");
  }

  const tempDir = mkdtempSync(join(tmpdir(), "spacebot-runner-mac-screens-"));
  const artifacts: PreparedArtifact[] = [];

  try {
    const displayCount = Math.max(displayItems.length, 1);
    for (let i = 1; i <= displayCount; i++) {
      const tempPath = join(tempDir, `screen-${i}.png`);
      const result = spawnSync("screencapture", ["-x", "-D", String(i), tempPath], { encoding: "utf8", timeout: 30_000 });
      if (result.signal === "SIGTERM" || result.status !== 0) {
        continue;
      }
      if (!existsSync(tempPath)) {
        continue;
      }
      const buf = readFileSync(tempPath);
      if (buf.length > MAX_ARTIFACT_BYTES) {
        throw new Error(`Screenshot exceeds RUNNER_MAX_ARTIFACT_BYTES for display ${i}`);
      }
      const display = displayItems[i - 1] ?? {};
      artifacts.push(encodeArtifact(buf, {
        width: typeof display.width === "number" ? display.width : undefined,
        height: typeof display.height === "number" ? display.height : undefined,
        captureSource: typeof display.id === "string" ? display.id : `display-${i}`,
        captureIndex: i - 1,
      }));
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  if (artifacts.length === 0) {
    throw new Error("No per-display captures were produced by screencapture");
  }

  return artifacts;
}

function captureLinuxPerDisplayArtifacts(displayItems: Array<Record<string, unknown>>): PreparedArtifact[] {
  if (!commandExists("grim")) {
    throw new Error("grim is not available for per-display capture");
  }

  const outputs = displayItems
    .map((item) => (typeof item.id === "string" ? item.id : ""))
    .filter(Boolean);

  if (outputs.length === 0) {
    throw new Error("No display outputs detected for per-display capture");
  }

  const tempDir = mkdtempSync(join(tmpdir(), "spacebot-runner-linux-screens-"));
  const artifacts: PreparedArtifact[] = [];

  try {
    for (let i = 0; i < outputs.length; i++) {
      const outputName = outputs[i];
      const tempPath = join(tempDir, `screen-${i}.png`);
      const result = spawnSync("grim", ["-o", outputName, tempPath], { encoding: "utf8", timeout: 30_000 });
      if (result.signal === "SIGTERM" || result.status !== 0 || !existsSync(tempPath)) {
        continue;
      }

      const buf = readFileSync(tempPath);
      if (buf.length > MAX_ARTIFACT_BYTES) {
        throw new Error(`Screenshot exceeds RUNNER_MAX_ARTIFACT_BYTES for ${outputName}`);
      }

      const display = displayItems[i] ?? {};
      artifacts.push(encodeArtifact(buf, {
        width: typeof display.width === "number" ? display.width : undefined,
        height: typeof display.height === "number" ? display.height : undefined,
        captureSource: outputName,
        captureIndex: i,
      }));
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  if (artifacts.length === 0) {
    throw new Error("No per-display captures were produced by grim");
  }

  return artifacts;
}

function captureScreenshotArtifacts(mode: string, displayItems: Array<Record<string, unknown>>): PreparedArtifact[] {
  if (mode === "per_display") {
    if (IS_WINDOWS) {
      const artifacts = captureWindowsPerDisplayArtifacts();
      if (artifacts.length > 0) return artifacts;
    }

    if (process.platform === "darwin") {
      const artifacts = captureMacPerDisplayArtifacts(displayItems);
      if (artifacts.length > 0) return artifacts;
    }

    if (process.platform === "linux") {
      const artifacts = captureLinuxPerDisplayArtifacts(displayItems);
      if (artifacts.length > 0) return artifacts;
    }
  }

  const single = captureScreenshotBuffer();
  if (single.length > MAX_ARTIFACT_BYTES) {
    throw new Error(`Screenshot exceeds RUNNER_MAX_ARTIFACT_BYTES (${single.length} > ${MAX_ARTIFACT_BYTES}).`);
  }

  return [encodeArtifact(single, {
    captureSource: mode,
    captureIndex: 0,
  })];
}

async function executeVscodeDiscover(): Promise<JobResult> {
  const bridge = await bridgeDiscover();
  if (bridge.ok) {
    return {
      status: "completed",
      output: "VS Code discovery completed via bridge.",
      exitCode: 0,
      truncated: false,
      result: {
        bridge: true,
        ...(bridge.body ?? {}),
      },
    };
  }

  const hasCode = commandExists("code");
  const instances: string[] = [];

  try {
    if (IS_WINDOWS) {
      const result = spawnSync("tasklist", ["/FI", "IMAGENAME eq Code.exe"], {
        encoding: "utf8",
        windowsHide: true,
      });
      if (result.status === 0 && result.stdout) {
        instances.push(...result.stdout.split("\n").filter((line) => line.toLowerCase().includes("code.exe")));
      }
    } else {
      const result = spawnSync("pgrep", ["-fa", "code|Code"], { encoding: "utf8" });
      if (result.status === 0 && result.stdout) {
        instances.push(...result.stdout.split("\n").filter(Boolean));
      }
    }
  } catch {
    // Ignore process listing failures.
  }

  return {
    status: "completed",
    output: `VS Code CLI ${hasCode ? "available" : "missing"}. Detected ${instances.length} process entries.`,
    exitCode: 0,
    truncated: false,
    result: {
      hasCodeCli: hasCode,
      runningInstances: instances,
      copilotBridgeConnected: false,
      bridgeError: bridge.error ?? null,
    },
  };
}

async function executeDmJob(payload: Record<string, unknown>): Promise<JobResult> {
  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  if (!message) {
    return {
      status: "failed",
      output: "dm job requires payload.message",
      exitCode: 1,
      truncated: false,
      result: {
        done: false,
        reason: "missing_message",
      },
    };
  }

  const prompt = buildDmPrompt(payload);
  const run = await runPromptThroughProviderChain(prompt, payload);
  if (!run.ok || !run.text) {
    const failureSummary = run.attempts.length > 0
      ? run.attempts
        .map((entry) => `${entry.provider}/${entry.model}: ${entry.error || "failed"}`)
        .join("; ")
      : "No providers/models were configured.";

    return {
      status: "failed",
      output: `Unable to complete dm job: ${failureSummary}`,
      exitCode: 1,
      truncated: false,
      result: {
        done: false,
        reason: "all_providers_failed",
        attempts: run.attempts,
      },
    };
  }

  return {
    status: "completed",
    output: run.text,
    exitCode: 0,
    truncated: false,
    result: {
      done: true,
      response: run.text,
      attempts: run.attempts,
      responseTarget: payload.response_target ?? null,
    },
  };
}

async function executeTypedJob(job: Job): Promise<JobResult | null> {
  const jobType = job.job_type || "shell_command";
  const payload = parsePayload(job.payload_json);

  if (jobType === "shell_command") {
    return null;
  }

  if (jobType === "dm") {
    return executeDmJob(payload);
  }

  if (jobType === "system_profile") {
    const profile = gatherSystemProfile();
    return {
      status: "completed",
      output: `System profile collected for ${profile.os.hostname} (${profile.os.platform}/${profile.os.arch}), displays: ${profile.displays.count}`,
      exitCode: 0,
      truncated: false,
      result: profile,
    };
  }

  if (jobType === "screenshot_capture") {
    if (process.env.RUNNER_ENABLE_SCREENSHOTS !== "1") {
      return {
        status: "failed",
        output: "Screenshot capture is disabled. Set RUNNER_ENABLE_SCREENSHOTS=1 to enable.",
        exitCode: 1,
        truncated: false,
      };
    }

    try {
      const profile = gatherSystemProfile();
      const captureMode = typeof payload.mode === "string" ? payload.mode : "all_displays";
      const includeWorkspaceContext = payload.includeWorkspaceContext !== false;
      const artifacts = captureScreenshotArtifacts(captureMode, profile.displays.items as Array<Record<string, unknown>>);
      const workspaceContext = includeWorkspaceContext ? collectWorkspaceContext() : null;
      const totalBytes = artifacts.reduce((sum, item) => sum + (item.byteSize || 0), 0);
      const perDisplayFallback = captureMode === "per_display" && artifacts.length === 1 && profile.displays.count > 1;

      return {
        status: "completed",
        output: `Captured ${artifacts.length} screenshot artifact(s), total ${totalBytes} bytes.`,
        exitCode: 0,
        truncated: false,
        artifactRefs: artifacts,
        result: {
          captureMode,
          artifactCount: artifacts.length,
          totalBytes,
          workspaceContextIncluded: includeWorkspaceContext,
          workspaceContext,
          displays: profile.displays,
          fallbackReason: perDisplayFallback ? "per_display_capture_fell_back_to_single_image" : null,
        },
      };
    } catch (e) {
      return {
        status: "failed",
        output: `Screenshot capture failed: ${e instanceof Error ? e.message : String(e)}`,
        exitCode: 1,
        truncated: false,
      };
    }
  }

  if (jobType === "vscode_discover_instances") {
    if (process.env.RUNNER_ENABLE_VSCODE_CONTROL === "0") {
      return {
        status: "failed",
        output: "VS Code control is disabled. Set RUNNER_ENABLE_VSCODE_CONTROL=1 to enable.",
        exitCode: 1,
        truncated: false,
      };
    }
    return executeVscodeDiscover();
  }

  if (jobType === "vscode_open_workspace") {
    if (process.env.RUNNER_ENABLE_VSCODE_CONTROL === "0") {
      return {
        status: "failed",
        output: "VS Code control is disabled. Set RUNNER_ENABLE_VSCODE_CONTROL=1 to enable.",
        exitCode: 1,
        truncated: false,
      };
    }

    const target = typeof payload.path === "string" ? payload.path : null;
    if (!target) {
      return {
        status: "failed",
        output: "vscode_open_workspace requires payload.path",
        exitCode: 1,
        truncated: false,
      };
    }

    if (!isAllowedPath(target)) {
      return {
        status: "failed",
        output: `Path is not within the runner's allowed paths: ${target}`,
        exitCode: 1,
        truncated: false,
      };
    }

    const bridge = await bridgeOpenWorkspace(target, payload.newWindow === true);
    if (bridge.ok) {
      return {
        status: "completed",
        output: `Opened workspace path in VS Code via bridge: ${target}`,
        exitCode: 0,
        truncated: false,
      };
    }

    const args = [target];
    if (payload.newWindow === true) args.unshift("--new-window");
    const run = spawnSync("code", args, { encoding: "utf8", windowsHide: true });
    if (run.status !== 0) {
      return {
        status: "failed",
        output: `${run.stderr?.trim() || "Failed to open workspace in VS Code"}${bridge.error ? ` (bridge fallback failed: ${bridge.error})` : ""}`,
        exitCode: run.status ?? 1,
        truncated: false,
      };
    }

    return {
      status: "completed",
      output: `Opened workspace path in VS Code: ${target}`,
      exitCode: 0,
      truncated: false,
    };
  }

  if (jobType === "vscode_send_copilot_message") {
    if (process.env.RUNNER_ENABLE_COPILOT_CHAT !== "1") {
      return {
        status: "failed",
        output: "Copilot chat bridge is not enabled yet. Set RUNNER_ENABLE_COPILOT_CHAT=1 once bridge support is installed.",
        exitCode: 1,
        truncated: false,
        result: {
          supported: false,
          reason: "bridge_not_installed",
        },
      };
    }

    const message = typeof payload.message === "string" ? payload.message.trim() : "";
    if (!message) {
      return {
        status: "failed",
        output: "vscode_send_copilot_message requires payload.message",
        exitCode: 1,
        truncated: false,
      };
    }

    const sent = await bridgeSendCopilotMessage(message);
    if (!sent.ok) {
      return {
        status: "failed",
        output: `Failed to send Copilot message via VS Code bridge: ${sent.error || "unknown error"}`,
        exitCode: 1,
        truncated: false,
        result: {
          supported: false,
          reason: "bridge_unavailable_or_command_missing",
          bridgeStatus: sent.status ?? null,
        },
      };
    }

    return {
      status: "completed",
      output: "Copilot message sent via VS Code bridge.",
      exitCode: 0,
      truncated: false,
      result: {
        supported: true,
        bridgeResponse: sent.body ?? null,
      },
    };
  }

  return {
    status: "failed",
    output: `Unsupported job type: ${jobType}`,
    exitCode: 1,
    truncated: false,
  };
}

// ---------------------------------------------------------------------------
// Working directory validation
// ---------------------------------------------------------------------------

function resolveWorkDir(jobDir: string | null): string {
  const base = jobDir ? resolve(jobDir) : resolve(DEFAULT_WORKDIR);

  // If the user hasn't configured any permission scope (no env, no persisted
  // wizard answer), refuse the job. This is the "by default none" posture —
  // safer than silently accepting anything.
  if (ALLOWED_PATHS.length === 0 && PERMISSION_SOURCE === "none") {
    throw new Error(
      `Refusing to run: no allowed-paths scope is configured for this runner. ` +
      `Launch the runner interactively and pick a scope (sandbox / home / root), ` +
      `or set RUNNER_ALLOWED_PATHS in the environment.`
    );
  }

  if (ALLOWED_PATHS.length > 0) {
    const allowed = ALLOWED_PATHS.some((p) => base.startsWith(p));
    if (!allowed) {
      throw new Error(
        `Working directory "${base}" is not within the allowed paths for this runner. ` +
        `Allowed: ${ALLOWED_PATHS.join(", ")}. ` +
        `Use /permissions in the runner TUI to broaden scope, or set RUNNER_ALLOWED_PATHS.`
      );
    }
  }

  if (!existsSync(base)) {
    throw new Error(`Working directory "${base}" does not exist.`);
  }

  return base;
}

function isAllowedPath(pathValue: string): boolean {
  const base = resolve(pathValue);
  if (ALLOWED_PATHS.length === 0) {
    // No-scope-configured = deny. Explicit empty-from-env still denies; users
    // who want unrestricted access must set RUNNER_ALLOWED_PATHS=/ or pick
    // "Entire filesystem" in the wizard.
    return false;
  }
  return ALLOWED_PATHS.some((p) => base.startsWith(p));
}

// ---------------------------------------------------------------------------
// Job executor
// ---------------------------------------------------------------------------

async function executeJob(job: Job): Promise<JobResult> {
  const typedResult = await executeTypedJob(job);
  if (typedResult) {
    return typedResult;
  }

  let workDir: string;
  try {
    workDir = resolveWorkDir(job.working_dir);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: "failed", output: `Runner error: ${msg}`, exitCode: 1, truncated: false };
  }

  log(`  CMD: ${job.command}`);
  log(`  DIR: ${workDir}`);

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let truncated = false;

  const proc = spawn({
    cmd: [SHELL, SHELL_FLAG, job.command],
    cwd: workDir,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      SPACEBOT_JOB_ID: String(job.id),
      SPACEBOT_JOB_LABEL: job.label ?? "",
    },
  });

  async function consumeStream(stream: ReadableStream<Uint8Array>) {
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (truncated) continue;
      const remaining = MAX_OUTPUT_BYTES - totalBytes;
      if (remaining <= 0) {
        truncated = true;
        continue;
      }
      const slice = value.slice(0, remaining);
      chunks.push(Buffer.from(slice));
      totalBytes += slice.length;
    }
  }

  await Promise.all([consumeStream(proc.stdout), consumeStream(proc.stderr)]);
  const exitCode = await proc.exited;

  let output = Buffer.concat(chunks).toString("utf8");
  if (truncated) output += `\n--- output truncated at ${MAX_OUTPUT_BYTES} bytes ---`;

  const status = exitCode === 0 ? "completed" : "failed";
  log(`  EXIT: ${exitCode} (${status})`);

  return { status, output, exitCode, truncated };
}

// ---------------------------------------------------------------------------
// Job queue (sequential processing, safe against parallel shell mayhem)
// ---------------------------------------------------------------------------

let jobQueue: Job[] = [];
let jobRunning = false;

async function drainQueue(ws: WebSocket) {
  if (jobRunning) return;
  while (jobQueue.length > 0) {
    const job = jobQueue.shift()!;
    jobRunning = true;
    log(`Running job #${job.id}${job.label ? ` (${job.label})` : ""}…`);
    sendRunnerEvent(
      "job.started",
      `Started job #${job.id}${job.label ? ` (${job.label})` : ""}`,
      {
        command: job.command,
        workingDir: job.working_dir ?? DEFAULT_WORKDIR,
        targetInstanceId: job.target_instance_id ?? null,
      },
      "info",
      job.id,
    );

    let result: JobResult;
    try {
      result = await executeJob(job);
    } catch (e) {
      result = { status: "failed", output: `Unexpected runner error: ${e}`, exitCode: 1, truncated: false };
    }

    // Upload large artifacts (e.g. screenshots) via HTTP before sending the WS
    // result message.  Cloudflare has a ~1 MB WebSocket message limit; a 2 MB
    // PNG base64-encodes to ~2.7 MB which would silently drop the connection.
    let uploadedArtifactIds: number[] | undefined;
    if (result.artifactRefs && result.artifactRefs.length > 0) {
      const ids: number[] = [];
      let allUploaded = true;
      for (const artifact of result.artifactRefs) {
        try {
          const res = await fetch(`${API_URL}/api/runner/artifacts/upload`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${TOKEN}`,
            },
            body: JSON.stringify({ jobId: job.id, artifact }),
          });
          if (res.ok) {
            const data = await res.json() as { success: boolean; artifactId: number };
            if (data.success && typeof data.artifactId === "number") {
              ids.push(data.artifactId);
            } else {
              allUploaded = false;
            }
          } else {
            allUploaded = false;
            err(`Artifact upload failed (HTTP ${res.status}) for job #${job.id}`);
          }
        } catch (uploadErr) {
          allUploaded = false;
          err(`Artifact upload error for job #${job.id}: ${uploadErr}`);
        }
      }
      if (allUploaded && ids.length === result.artifactRefs.length) {
        uploadedArtifactIds = ids;
        // Strip inline blobs from the WS result — server reads them from D1
        result = { ...result, artifactRefs: undefined };
      }
      // If any upload failed, fall back to inline sending (best-effort)
    }

    try {
      ws.send(JSON.stringify({
        type: "result",
        jobId: job.id,
        status: result.status,
        output: result.output,
        exitCode: result.exitCode,
        truncated: result.truncated,
        result: result.result,
        artifactRefs: result.artifactRefs,
        uploadedArtifactIds,
      }));
    } catch {
      err(`Failed to send result for job #${job.id} — connection lost.`);
      sendRunnerEvent("runner.error", `Failed to send result for job #${job.id}`, undefined, "error", job.id);
    }

    jobRunning = false;
  }
}

// ---------------------------------------------------------------------------
// WebSocket connection with auto-reconnect
// ---------------------------------------------------------------------------

let running = true;
let reconnectAttempts = 0;
let shuttingDown = false;

async function gracefulShutdown(reason: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  running = false;
  stopKeepalive();
  stopCodeWatcher();
  log(`Shutting down (${reason})…`);

  const ws = activeSocket;
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({ type: "disconnect", reason, instance: buildHelloPayload() }));
    } catch {
      // Ignore send failures during shutdown.
    }

    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      const timer = setTimeout(finish, 500);
      ws.addEventListener("close", () => {
        clearTimeout(timer);
        finish();
      }, { once: true });
      try {
        ws.close(1000, "Runner shutting down");
      } catch {
        clearTimeout(timer);
        finish();
      }
    });
  }
}

function connect() {
  if (!running) return;

  log(`Connecting to ${API_URL}/api/runner/ws …`);

  const ws = new WebSocket(WS_URL);
  activeSocket = ws;

  ws.onopen = () => {
    log("WebSocket connected. Waiting for jobs…");
    reconnectAttempts = 0;
    lastServerMessageAt = Date.now();
    startKeepalive();
    sendJson({ type: "hello", instance: buildHelloPayload() });
  };

  ws.onmessage = (event: MessageEvent) => {
    lastServerMessageAt = Date.now();
    let msg: { type: string; job?: Job; jobId?: number; instanceId?: number; instanceName?: string; };
    try {
      msg = JSON.parse(event.data as string);
    } catch {
      return;
    }

    switch (msg.type) {
      case "connected":
        log(`Authenticated — runner ready as ${msg.instanceName ?? DISPLAY_NAME}.`);
        sendRunnerEvent(
          "runner.ready",
          `Runner ready on ${DISPLAY_NAME}`,
          {
            instanceId: msg.instanceId ?? null,
            instanceKey: INSTANCE_KEY,
            hostname: HOSTNAME,
          },
        );
        break;

      case "job":
        if (msg.job) {
          jobQueue.push(msg.job);
          sendRunnerEvent(
            "job.received",
            `Queued job #${msg.job.id}${msg.job.label ? ` (${msg.job.label})` : ""}`,
            {
              command: msg.job.command,
              workingDir: msg.job.working_dir ?? DEFAULT_WORKDIR,
            },
            "info",
            msg.job.id,
          );
          drainQueue(ws).catch((e) => err("Job queue error:", e));
        }
        break;

      case "ack":
        log(`Job #${msg.jobId} confirmed by server.`);
        break;

      case "heartbeat":
        sendJson({ type: "pong", instance: buildHelloPayload() });
        break;
    }
  };

  ws.onclose = (event: CloseEvent) => {
    stopKeepalive();
    activeSocket = null;
    if (!running) return;
    reconnectAttempts++;
    const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, reconnectAttempts - 1), RECONNECT_MAX_MS);
    warn(`WebSocket closed (code ${event.code}). Reconnecting in ${delay}ms… (attempt ${reconnectAttempts})`);
    setTimeout(connect, delay);
  };

  ws.onerror = (event: Event) => {
    err("WebSocket error:", (event as ErrorEvent).message ?? event.type);
    sendRunnerEvent("runner.error", `WebSocket error: ${(event as ErrorEvent).message ?? event.type}`, undefined, "error");
    // onclose fires after onerror — reconnect is handled there
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function validateRunnerToken() {
  if (!TOKEN || !TOKEN.startsWith("sbr_")) {
    err("SPACEBOT_RUNNER_TOKEN is missing or has an invalid format (expected sbr_…).");
    err("Set it via environment variable or create a .env file.");
    process.exit(1);
  }
}

function buildInitialSystemMarkdown(): string {
  const nowIso = new Date().toISOString();
  const today = nowIso.slice(0, 10);
  return [
    "# SpaceBot Local Runner System Notes",
    "",
    "This file is created automatically on first local-runner startup.",
    "Use it to track what is available on this system, what has been done, and preferences.",
    "",
    "## System Snapshot",
    "",
    `- Initialized: ${nowIso}`,
    `- Hostname: ${HOSTNAME}`,
    `- Platform: ${process.platform}`,
    `- Arch: ${process.arch}`,
    `- OS Release: ${release()}`,
    `- Runner Version: ${RUNNER_VERSION}`,
    `- Default Workdir: ${DEFAULT_WORKDIR}`,
    "",
    "## Available On This System",
    "",
    "- Add installed tools and key capabilities here.",
    "",
    "## Activity Log",
    "",
    `- ${today}: Initialized by SpaceBot local runner.`,
    "",
    "## Preferences",
    "",
    "- Add local runner preferences and conventions here.",
    "",
  ].join("\n");
}

function ensureSystemNotesFile() {
  mkdirSync(SPACEBOT_STATE_DIR, { recursive: true });
  if (existsSync(SYSTEM_MD_PATH)) return;
  writeFileSync(SYSTEM_MD_PATH, buildInitialSystemMarkdown(), "utf8");
}

function startHeadlessRunner() {
  log("SpaceBot Local Runner starting…");
  log(`  Server: ${API_URL}`);
  log(`  CWD:    ${DEFAULT_WORKDIR}`);
  log(`  Name:   ${DISPLAY_NAME}`);
  log(`  Host:   ${HOSTNAME}`);
  if (RUNNER_WATCH_PATHS.length > 0 && CODE_WATCH_INTERVAL_MS > 0) {
    log(`  Watch:  ${RUNNER_WATCH_PATHS.join(", ")} (every ${CODE_WATCH_INTERVAL_MS}ms)`);
  }
  if (ALLOWED_PATHS.length > 0) {
    const sourceLabel = PERMISSION_SOURCE === "env" ? "env"
      : PERMISSION_MODE ? `config:${PERMISSION_MODE}`
      : "config";
    log(`  Allowed paths (${sourceLabel}): ${ALLOWED_PATHS.join(", ")}`);
    if (PERMISSION_MODE === "root") {
      warn("⚠️  PERMISSION MODE = ROOT — the runner can execute commands anywhere on this machine.");
      warn("⚠️  This is the highest-risk setting. Only use it on dedicated machines you control.");
    } else if (PERMISSION_MODE === "home") {
      warn("⚠️  PERMISSION MODE = HOME — the runner can read/write anywhere under your home directory.");
    }
  } else {
    warn("⚠️  No allowed-paths scope is configured — ALL jobs will be rejected.");
    warn("⚠️  Launch the runner interactively and pick a scope (sandbox/home/root), or set RUNNER_ALLOWED_PATHS.");
  }
  log("");

  process.on("SIGINT", () => {
    void gracefulShutdown("SIGINT").finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void gracefulShutdown("SIGTERM").finally(() => process.exit(0));
  });

  startCodeWatcher();
  connect();
}

async function main() {
  try {
    ensureSystemNotesFile();
  } catch (error) {
    warn(`Failed to initialize ${SYSTEM_MD_PATH}:`, error);
  }

  if (FORCE_HEADLESS) {
    validateRunnerToken();
    startHeadlessRunner();
    return;
  }

  const { startRunnerTui } = await import("./tui");
  await startRunnerTui({
    apiUrl: API_URL,
    defaultWorkdir: DEFAULT_WORKDIR,
    displayName: DISPLAY_NAME,
    hostname: HOSTNAME,
    allowedPaths: ALLOWED_PATHS,
    scriptPath: SCRIPT_PATH,
    initialToken: TOKEN,
  });
}

main().catch((error) => {
  err("Local runner startup failed:", error);
  process.exit(1);
});

