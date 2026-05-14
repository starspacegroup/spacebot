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
 *                              working_dir must start with (security allowlist).
 *   RUNNER_SHELL             – Optional. Shell to use (default: /bin/sh on Unix, cmd.exe on Windows).
 *   RUNNER_RECONNECT_BASE_MS – Optional. Base reconnect delay in ms (default 1000).
 *   RUNNER_DISPLAY_NAME      – Optional. Human-readable name for this machine.
 *   RUNNER_INSTANCE_KEY      – Optional. Stable unique key for this installation.
 */

import { spawn } from "bun";
import { resolve } from "node:path";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { hostname, release, tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gatherSystemProfile } from "./capabilities";
import { bridgeDiscover, bridgeOpenWorkspace, bridgeSendCopilotMessage } from "./vscode-bridge-client";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TOKEN = process.env.SPACEBOT_RUNNER_TOKEN ?? "";
const API_URL = (process.env.SPACEBOT_API_URL ?? "https://spacebot.starspace.group").replace(/\/$/, "");
const DEFAULT_WORKDIR = process.env.RUNNER_DEFAULT_WORKDIR ?? process.cwd();
const MAX_OUTPUT_BYTES = Number(process.env.RUNNER_MAX_OUTPUT_BYTES ?? "65536");
const ALLOWED_PATHS: string[] = process.env.RUNNER_ALLOWED_PATHS
  ? process.env.RUNNER_ALLOWED_PATHS.split(":").map((p) => resolve(p))
  : [];
const IS_WINDOWS = process.platform === "win32";
const SHELL = process.env.RUNNER_SHELL ?? (IS_WINDOWS ? "cmd.exe" : "/bin/sh");
const SHELL_FLAG = IS_WINDOWS ? "/C" : "-c";
const RECONNECT_BASE_MS = Number(process.env.RUNNER_RECONNECT_BASE_MS ?? "1000");
const RECONNECT_MAX_MS = 60_000;
const MAX_ARTIFACT_BYTES = Number(process.env.RUNNER_MAX_ARTIFACT_BYTES ?? "2000000");
const HOSTNAME = hostname();
const RUNNER_VERSION = "2026.05.07";
const INSTANCE_KEY = process.env.RUNNER_INSTANCE_KEY
  ?? `sbrinst_${createHash("sha256").update([HOSTNAME, process.platform, process.arch, DEFAULT_WORKDIR].join("::")).digest("hex").slice(0, 24)}`;
const DISPLAY_NAME = process.env.RUNNER_DISPLAY_NAME ?? `${HOSTNAME} (${process.platform}/${process.arch})`;

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

function captureScreenshotBuffer(): Buffer {
  const tempPath = `${tmpdir()}/spacebot-runner-${Date.now()}-${Math.random().toString(16).slice(2)}.png`;

  if (process.platform === "darwin") {
    const result = spawnSync("screencapture", ["-x", tempPath], { encoding: "utf8" });
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
    });

    if (result.status !== 0) {
      throw new Error(result.stderr?.trim() || "PowerShell screenshot failed");
    }
  } else {
    const command = [
      "if command -v grim >/dev/null 2>&1; then grim '$1';",
      "elif command -v gnome-screenshot >/dev/null 2>&1; then gnome-screenshot -f '$1';",
      "elif command -v import >/dev/null 2>&1; then import -window root '$1';",
      "else exit 127; fi",
    ].join(" ");

    const result = spawnSync(SHELL, [SHELL_FLAG, command, "--", tempPath], { encoding: "utf8" });
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

async function executeTypedJob(job: Job): Promise<JobResult | null> {
  const jobType = job.job_type || "shell_command";
  const payload = parsePayload(job.payload_json);

  if (jobType === "shell_command") {
    return null;
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
      const buffer = captureScreenshotBuffer();
      if (buffer.length > MAX_ARTIFACT_BYTES) {
        return {
          status: "failed",
          output: `Screenshot exceeds RUNNER_MAX_ARTIFACT_BYTES (${buffer.length} > ${MAX_ARTIFACT_BYTES}).`,
          exitCode: 1,
          truncated: false,
        };
      }

      const artifact = {
        artifactType: "screenshot",
        mimeType: "image/png",
        byteSize: buffer.length,
        captureMode: typeof payload.mode === "string" ? payload.mode : "all_displays",
        storageMode: "inline_base64",
        blobBase64: buffer.toString("base64"),
      };

      return {
        status: "completed",
        output: `Captured screenshot (${buffer.length} bytes).`,
        exitCode: 0,
        truncated: false,
        artifactRefs: [artifact],
        result: {
          captureMode: artifact.captureMode,
          workspaceContextIncluded: Boolean(payload.includeWorkspaceContext),
          note: "Current implementation captures the visible desktop as one image. Per-display expansion is planned.",
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
        output: `Path is not permitted by RUNNER_ALLOWED_PATHS: ${target}`,
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

  if (ALLOWED_PATHS.length > 0) {
    const allowed = ALLOWED_PATHS.some((p) => base.startsWith(p));
    if (!allowed) {
      throw new Error(
        `Working directory "${base}" is not in the allowed paths list. ` +
        `Set RUNNER_ALLOWED_PATHS to permit it.`
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
  if (ALLOWED_PATHS.length === 0) return true;
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

function connect() {
  if (!running) return;

  log(`Connecting to ${API_URL}/api/runner/ws …`);

  const ws = new WebSocket(WS_URL);
  activeSocket = ws;

  ws.onopen = () => {
    log("WebSocket connected. Waiting for jobs…");
    reconnectAttempts = 0;
    sendJson({ type: "hello", instance: buildHelloPayload() });
  };

  ws.onmessage = (event: MessageEvent) => {
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
        sendJson({ type: "pong" });
        break;
    }
  };

  ws.onclose = (event: CloseEvent) => {
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

if (!TOKEN || !TOKEN.startsWith("sbr_")) {
  err("SPACEBOT_RUNNER_TOKEN is missing or has an invalid format (expected sbr_…).");
  err("Set it via environment variable or create a .env file.");
  process.exit(1);
}

log("SpaceBot Local Runner starting…");
log(`  Server: ${API_URL}`);
log(`  CWD:    ${DEFAULT_WORKDIR}`);
log(`  Name:   ${DISPLAY_NAME}`);
log(`  Host:   ${HOSTNAME}`);
if (ALLOWED_PATHS.length > 0) {
  log(`  Allowed paths: ${ALLOWED_PATHS.join(", ")}`);
} else {
  warn("No RUNNER_ALLOWED_PATHS set — any working_dir will be accepted. Consider setting it for safety.");
}
log("");

process.on("SIGINT", () => { log("Shutting down…"); running = false; process.exit(0); });
process.on("SIGTERM", () => { log("Shutting down…"); running = false; process.exit(0); });

connect();

