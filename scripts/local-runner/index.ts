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
 */

import { spawn } from "bun";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

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

// ---------------------------------------------------------------------------
// Job executor
// ---------------------------------------------------------------------------

async function executeJob(job: Job): Promise<{ status: "completed" | "failed"; output: string; exitCode: number; }> {
  let workDir: string;
  try {
    workDir = resolveWorkDir(job.working_dir);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: "failed", output: `Runner error: ${msg}`, exitCode: 1 };
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

  return { status, output, exitCode };
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

    let result: { status: "completed" | "failed"; output: string; exitCode: number; };
    try {
      result = await executeJob(job);
    } catch (e) {
      result = { status: "failed", output: `Unexpected runner error: ${e}`, exitCode: 1 };
    }

    try {
      ws.send(JSON.stringify({
        type: "result",
        jobId: job.id,
        status: result.status,
        output: result.output,
        exitCode: result.exitCode,
      }));
    } catch {
      err(`Failed to send result for job #${job.id} — connection lost.`);
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

  ws.onopen = () => {
    log("WebSocket connected. Waiting for jobs…");
    reconnectAttempts = 0;
  };

  ws.onmessage = (event: MessageEvent) => {
    let msg: { type: string; job?: Job; jobId?: number; };
    try {
      msg = JSON.parse(event.data as string);
    } catch {
      return;
    }

    switch (msg.type) {
      case "connected":
        log("Authenticated — runner ready.");
        break;

      case "job":
        if (msg.job) {
          jobQueue.push(msg.job);
          drainQueue(ws).catch((e) => err("Job queue error:", e));
        }
        break;

      case "ack":
        log(`Job #${msg.jobId} confirmed by server.`);
        break;

      case "heartbeat":
        // silently ignore
        break;
    }
  };

  ws.onclose = (event: CloseEvent) => {
    if (!running) return;
    reconnectAttempts++;
    const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, reconnectAttempts - 1), RECONNECT_MAX_MS);
    warn(`WebSocket closed (code ${event.code}). Reconnecting in ${delay}ms… (attempt ${reconnectAttempts})`);
    setTimeout(connect, delay);
  };

  ws.onerror = (event: Event) => {
    err("WebSocket error:", (event as ErrorEvent).message ?? event.type);
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
if (ALLOWED_PATHS.length > 0) {
  log(`  Allowed paths: ${ALLOWED_PATHS.join(", ")}`);
} else {
  warn("No RUNNER_ALLOWED_PATHS set — any working_dir will be accepted. Consider setting it for safety.");
}
log("");

process.on("SIGINT", () => { log("Shutting down…"); running = false; process.exit(0); });
process.on("SIGTERM", () => { log("Shutting down…"); running = false; process.exit(0); });

connect();

