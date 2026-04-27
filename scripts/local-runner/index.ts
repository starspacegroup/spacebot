#!/usr/bin/env bun
/**
 * SpaceBot Local Runner
 *
 * Authenticates with the SpaceBot server using a personal runner token,
 * polls for queued jobs, executes them locally as shell commands, and
 * reports the results back.
 *
 * Usage:
 *   SPACEBOT_RUNNER_TOKEN=sbr_... bun run scripts/local-runner/index.ts
 *
 * Or create a .env file / runner.config.ts next to this file.
 *
 * Config (env vars):
 *   SPACEBOT_RUNNER_TOKEN   – Required. Runner token from Account > Local Runners.
 *   SPACEBOT_API_URL        – Optional. Defaults to https://spacebot.starspace.group
 *   RUNNER_DEFAULT_WORKDIR  – Optional. Default working directory for commands.
 *   RUNNER_POLL_INTERVAL_MS – Optional. Polling interval in ms (default 3000).
 *   RUNNER_MAX_OUTPUT_BYTES – Optional. Max captured output per job (default 65536).
 *   RUNNER_ALLOWED_PATHS    – Optional. Colon-separated list of path prefixes that
 *                             working_dir must start with (security allowlist).
 *   RUNNER_SHELL            – Optional. Shell to use (default: /bin/sh on Unix, cmd.exe on Windows).
 */

import { spawn } from "bun";
import { join, resolve, isAbsolute } from "node:path";
import { existsSync } from "node:fs";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TOKEN = process.env.SPACEBOT_RUNNER_TOKEN ?? "";
const API_URL = (process.env.SPACEBOT_API_URL ?? "https://spacebot.starspace.group").replace(/\/$/, "");
const DEFAULT_WORKDIR = process.env.RUNNER_DEFAULT_WORKDIR ?? process.cwd();
const POLL_INTERVAL_MS = Number(process.env.RUNNER_POLL_INTERVAL_MS ?? "3000");
const MAX_OUTPUT_BYTES = Number(process.env.RUNNER_MAX_OUTPUT_BYTES ?? "65536");
const ALLOWED_PATHS: string[] = process.env.RUNNER_ALLOWED_PATHS
  ? process.env.RUNNER_ALLOWED_PATHS.split(":").map((p) => resolve(p))
  : [];
const IS_WINDOWS = process.platform === "win32";
const SHELL = process.env.RUNNER_SHELL ?? (IS_WINDOWS ? "cmd.exe" : "/bin/sh");
const SHELL_FLAG = IS_WINDOWS ? "/C" : "-c";

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
// Helpers
// ---------------------------------------------------------------------------

function log(...args: unknown[]) {
  const ts = new Date().toISOString();
  console.log(`[${ts}]`, ...args);
}

function warn(...args: unknown[]) {
  const ts = new Date().toISOString();
  console.warn(`[${ts}] WARN`, ...args);
}

function err(...args: unknown[]) {
  const ts = new Date().toISOString();
  console.error(`[${ts}] ERR`, ...args);
}

/** POST JSON to the SpaceBot API with runner token auth */
async function api(path: string, body?: object): Promise<{ ok: boolean; data: unknown; }> {
  const method = body !== undefined ? "POST" : "GET";
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${TOKEN}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  return { ok: res.ok, data };
}

/**
 * Resolve and validate the working directory for a job.
 * Returns the resolved path or throws if it fails the allowlist check.
 */
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
      // Pass runner context to scripts
      SPACEBOT_JOB_ID: String(job.id),
      SPACEBOT_JOB_LABEL: job.label ?? "",
    },
  });

  // Stream stdout + stderr together
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
// Poll loop
// ---------------------------------------------------------------------------

let consecutiveErrors = 0;
const MAX_BACKOFF_MS = 60_000;

async function poll() {
  const { ok, data } = await api("/api/runner/poll");

  if (!ok) {
    consecutiveErrors++;
    const backoff = Math.min(POLL_INTERVAL_MS * Math.pow(2, consecutiveErrors), MAX_BACKOFF_MS);
    err(`Poll failed (${(data as { error?: string; })?.error ?? "unknown error"}). Retrying in ${backoff}ms…`);
    await Bun.sleep(backoff);
    return;
  }

  consecutiveErrors = 0;
  const jobs = (data as { jobs?: Job[]; })?.jobs ?? [];

  if (jobs.length === 0) return;

  log(`Received ${jobs.length} job(s).`);

  // Execute jobs sequentially (safe default; no parallel shell mayhem)
  for (const job of jobs) {
    log(`Running job #${job.id}${job.label ? ` (${job.label})` : ""}…`);

    const result = await executeJob(job);

    const { ok: reported, data: reportData } = await api("/api/runner/result", {
      jobId: job.id,
      status: result.status,
      output: result.output,
      exitCode: result.exitCode,
    });

    if (!reported) {
      err(`Failed to report result for job #${job.id}:`, (reportData as { error?: string; })?.error);
    } else {
      log(`Job #${job.id} reported as ${result.status}.`);
    }
  }
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
log(`  API:  ${API_URL}`);
log(`  Poll: every ${POLL_INTERVAL_MS}ms`);
log(`  CWD:  ${DEFAULT_WORKDIR}`);
if (ALLOWED_PATHS.length > 0) {
  log(`  Allowed paths: ${ALLOWED_PATHS.join(", ")}`);
} else {
  warn("No RUNNER_ALLOWED_PATHS set — any working_dir will be accepted. Consider setting it for safety.");
}
log("");

// Graceful shutdown
let running = true;
process.on("SIGINT", () => {
  log("Shutting down…");
  running = false;
});
process.on("SIGTERM", () => {
  log("Shutting down…");
  running = false;
});

while (running) {
  try {
    await poll();
  } catch (e) {
    err("Unexpected error in poll loop:", e);
    consecutiveErrors++;
  }
  if (running) await Bun.sleep(POLL_INTERVAL_MS);
}

log("Runner stopped.");
