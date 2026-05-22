import { spawn, spawnSync } from "node:child_process";

export interface CopilotAvailability {
  /** True if the official standalone `copilot` CLI is installed. */
  copilotCli: boolean;
  /** True if `gh` is installed AND `gh copilot` extension is present. */
  ghCopilot: boolean;
  /** True if user is signed in to `gh` (needed for any gh-based call). */
  ghAuthed: boolean;
  /** First-line diagnostic for the agent strip. */
  summary: string;
}

/**
 * Known Copilot CLI model identifiers. The standalone `copilot` CLI accepts these via `--model`.
 * Kept conservative & curated; users can also pass any identifier the CLI accepts.
 *
 * `multiplier` is the GitHub Copilot premium-request multiplier (per GitHub's published table
 * at https://docs.github.com/en/copilot/concepts/billing/copilot-requests#model-multipliers).
 * 0 = does not consume premium requests on paid plans.
 * null = varies (e.g. auto model selection picks per-prompt; paid plans get a 10% discount).
 * Subject to change by GitHub.
 */
export const COPILOT_MODELS: ReadonlyArray<{ id: string; label: string; multiplier: number | null }> = [
  { id: "auto", label: "Auto — let Copilot pick the best model (10% discount on paid plans)", multiplier: null },
  { id: "claude-sonnet-4.5", label: "Claude Sonnet 4.5 (balanced)", multiplier: 1 },
  { id: "claude-sonnet-4.6", label: "Claude Sonnet 4.6", multiplier: 1 },
  { id: "claude-haiku-4.5", label: "Claude Haiku 4.5 (fast)", multiplier: 0.33 },
  { id: "claude-opus-4.5", label: "Claude Opus 4.5 (premium)", multiplier: 3 },
  { id: "claude-opus-4.6", label: "Claude Opus 4.6 (premium)", multiplier: 3 },
  { id: "claude-opus-4.7", label: "Claude Opus 4.7 (top-tier)", multiplier: 15 },
  { id: "gpt-5.2", label: "GPT-5.2", multiplier: 1 },
  { id: "gpt-5.4", label: "GPT-5.4", multiplier: 1 },
  { id: "gpt-5.4-mini", label: "GPT-5.4 mini (cheap)", multiplier: 0.33 },
  { id: "gpt-5.4-nano", label: "GPT-5.4 nano (cheapest premium)", multiplier: 0.25 },
  { id: "gpt-5-mini", label: "GPT-5 mini (included)", multiplier: 0 },
  { id: "gpt-4.1", label: "GPT-4.1 (included)", multiplier: 0 },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", multiplier: 1 },
  { id: "gemini-3.1-pro", label: "Gemini 3.1 Pro", multiplier: 1 },
  { id: "gemini-3-flash", label: "Gemini 3 Flash (fast)", multiplier: 0.33 },
];

export const DEFAULT_COPILOT_MODEL = "auto";

/** Formats a request-cost multiplier for compact UI display. */
export function formatCopilotMultiplier(m: number | null): string {
  if (m === null) return "varies";
  if (m === 0) return "0× (included)";
  if (Number.isInteger(m)) return `${m}×`;
  return `${m.toFixed(2).replace(/\.?0+$/, "")}×`;
}

export interface CopilotConfig {
  model: string;
  /** Which CLI path the user wants: "copilot" (standalone) or "gh" (extension). */
  via: "copilot" | "gh";
}

export function storeCopilotConfig(config: CopilotConfig): void {
  process.env.SPACEBOT_COPILOT_MODEL = config.model;
  process.env.SPACEBOT_COPILOT_VIA = config.via;
}

export function getCopilotConfig(): CopilotConfig | null {
  const model = process.env.SPACEBOT_COPILOT_MODEL;
  const via = process.env.SPACEBOT_COPILOT_VIA;
  if (!model || (via !== "copilot" && via !== "gh")) return null;
  return { model, via };
}

function which(cmd: string): string | null {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], {
    encoding: "utf8",
  });
  if (r.status === 0) return (r.stdout || "").split("\n")[0]?.trim() || null;
  return null;
}

function tryRun(cmd: string, args: string[], timeoutMs = 3000): { ok: boolean; stdout: string; stderr: string } {
  try {
    const r = spawnSync(cmd, args, { encoding: "utf8", timeout: timeoutMs });
    return {
      ok: r.status === 0,
      stdout: r.stdout?.toString() ?? "",
      stderr: r.stderr?.toString() ?? "",
    };
  } catch {
    return { ok: false, stdout: "", stderr: "" };
  }
}

/** Detect every Copilot integration path we can use. */
export async function detectCopilotAvailability(): Promise<CopilotAvailability> {
  const hasGh = !!which("gh");
  let ghAuthed = false;
  let ghCopilot = false;

  if (hasGh) {
    const auth = tryRun("gh", ["auth", "status"]);
    ghAuthed = auth.ok || /Logged in to github\.com/i.test(auth.stderr + auth.stdout);

    const ext = tryRun("gh", ["extension", "list"]);
    ghCopilot = /github\/gh-copilot/i.test(ext.stdout);
  }

  const copilotCli = !!which("copilot");

  const parts: string[] = [];
  if (copilotCli) parts.push("copilot-cli");
  if (ghCopilot) parts.push(ghAuthed ? "gh-copilot" : "gh-copilot(unauthed)");
  if (!parts.length && hasGh) parts.push("gh(no-ext)");
  const summary = parts.length ? parts.join(" + ") : "not installed";

  return { copilotCli, ghCopilot, ghAuthed, summary };
}

export interface CopilotGenerateResult {
  ok: boolean;
  text?: string;
  error?: string;
  /** Which underlying CLI handled the request. */
  via?: "copilot-cli" | "gh-copilot-suggest" | "gh-copilot-explain";
  durationMs?: number;
}

/**
 * Run a prompt through the best available Copilot pathway.
 *
 * Strategy:
 *   1. Standalone `copilot` CLI (if installed) — best general chat.
 *   2. `gh copilot suggest -t shell` with the prompt — works for command-style asks.
 *   3. `gh copilot explain` — only useful for "what does <command> do?".
 *
 * Returns clean stdout text. We strip ANSI/control codes upstream.
 */
export async function runCopilotPrompt(
  prompt: string,
  availability: CopilotAvailability,
  opts?: { model?: string; preferVia?: "copilot" | "gh" },
): Promise<CopilotGenerateResult> {
  const trimmed = prompt.trim();
  if (!trimmed) return { ok: false, error: "Empty prompt." };

  const startedAt = Date.now();
  const preferStandalone = opts?.preferVia !== "gh";

  // 1. Standalone `copilot` CLI (preferred unless explicitly told to use gh)
  if (availability.copilotCli && preferStandalone) {
    const args = ["--no-color", "--allow-all-tools"];
    if (opts?.model && opts.model !== "auto") {
      args.push("--model", opts.model);
    }
    args.push("-p", trimmed);
    const r = await runChild("copilot", args, 60000);
    if (r.ok && r.stdout.trim()) {
      return {
        ok: true,
        text: cleanCopilotCliOutput(r.stdout),
        via: "copilot-cli",
        durationMs: Date.now() - startedAt,
      };
    }
    // If the standalone CLI failed AND no gh fallback is available, surface its error.
    if (!availability.ghCopilot) {
      return {
        ok: false,
        error: (r.stderr || r.stdout || "copilot CLI returned no output").trim(),
      };
    }
    // Otherwise fall through to gh.
  }

  if (!availability.ghCopilot) {
    return {
      ok: false,
      error: "No Copilot CLI available. Install `gh` + `gh extension install github/gh-copilot`, or install the standalone `copilot` CLI.",
    };
  }

  if (!availability.ghAuthed) {
    return {
      ok: false,
      error: "`gh` is not authenticated. Run `gh auth login` then retry.",
    };
  }

  // 2. gh copilot suggest (best for command/general asks)
  const suggest = await runChild(
    "gh",
    ["copilot", "suggest", "-t", "shell", trimmed],
    30000,
  );
  if (suggest.ok && suggest.stdout.trim()) {
    return { ok: true, text: cleanGhCopilotOutput(suggest.stdout), via: "gh-copilot-suggest", durationMs: Date.now() - startedAt };
  }

  // 3. gh copilot explain (fallback for "what does X do?")
  const explain = await runChild(
    "gh",
    ["copilot", "explain", trimmed],
    30000,
  );
  if (explain.ok && explain.stdout.trim()) {
    return { ok: true, text: cleanGhCopilotOutput(explain.stdout), via: "gh-copilot-explain", durationMs: Date.now() - startedAt };
  }

  const errParts = [suggest.stderr, explain.stderr].filter(Boolean).join(" ");
  return { ok: false, error: errParts || "Copilot CLI returned no output." };
}

/** Strip ANSI / cursor / spinner artifacts emitted by the standalone copilot CLI. */
function cleanCopilotCliOutput(raw: string): string {
  return raw
    // strip ANSI escapes
    .replace(/\x1B\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/\x1B\][^\x07]*\x07/g, "")
    // strip cursor positioning sequences
    .replace(/\r/g, "")
    // collapse trailing whitespace per line
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .trim();
}

function cleanGhCopilotOutput(raw: string): string {
  // Remove ANSI color codes and TUI artifacts gh copilot likes to emit.
  const noAnsi = raw.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "");
  // Strip box-drawing decorations and prompt artifacts
  return noAnsi
    .split("\n")
    .map((l) => l.replace(/^[│┃┆╎┇┊]\s?/, "").trimEnd())
    .filter((l) => !/^[─━┄┈]+$/.test(l))
    .join("\n")
    .trim();
}

function runChild(
  cmd: string,
  args: string[],
  timeoutMs: number,
  stdin?: string,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let resolved = false;
    const finish = (ok: boolean) => {
      if (resolved) return;
      resolved = true;
      resolve({ ok, stdout, stderr });
    };

    let child;
    try {
      child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    } catch (err) {
      const e = err as Error;
      resolve({ ok: false, stdout: "", stderr: e.message });
      return;
    }

    const timer = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
      finish(false);
    }, timeoutMs);

    child.stdout?.on("data", (d) => { stdout += d.toString(); });
    child.stderr?.on("data", (d) => { stderr += d.toString(); });
    child.on("error", () => { clearTimeout(timer); finish(false); });
    child.on("close", (code) => { clearTimeout(timer); finish(code === 0); });

    if (typeof stdin === "string" && child.stdin) {
      try {
        child.stdin.write(stdin);
        child.stdin.end();
      } catch {
        // Some CLIs close stdin themselves; ignore.
      }
    }
  });
}
