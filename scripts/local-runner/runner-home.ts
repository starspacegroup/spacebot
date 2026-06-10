/**
 * Runner home directory ("SpaceBot home").
 *
 * The runner home is a user-chosen root directory (e.g. ~/SpaceBot) where the
 * runner keeps everything it learns and everything the user can interact with
 * through plain markdown files:
 *
 *   <home>/
 *     README.md      – explains the layout and how to talk to the runner
 *     SYSTEM.md      – auto-refreshed profile of this machine (+ manual notes)
 *     MEMORY.md      – index of stored memories
 *     memory/        – one markdown file per remembered fact
 *     journal/       – daily activity logs (YYYY-MM-DD.md)
 *     inbox/         – drop a .md file here; the runner answers in place
 *     outbox/        – runner-initiated notes for the user
 *     .state/        – internal bookkeeping (processed inbox hashes, profile cache)
 *
 * The chosen root is persisted in <configDir>/runner-home.json so every later
 * launch (TUI, headless, systemd) finds it again. SPACEBOT_RUNNER_HOME
 * overrides the persisted choice.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { getAutostartPaths } from "./service-manager";

export interface RunnerHomeConfig {
  root: string;
  configuredAt: string;
}

export interface ResolvedRunnerHome {
  root: string | null;
  source: "env" | "config" | "none";
}

const HOME_SUBDIRS = ["memory", "journal", "inbox", "outbox", ".state"] as const;

function getHomePointerFile(): string {
  return join(getAutostartPaths().configDir, "runner-home.json");
}

/** Default home: ~/SpaceBot — visible and easy to browse. */
export function getDefaultRunnerHome(): string {
  return resolve(join(homedir(), "SpaceBot"));
}

/** Expand a leading ~ and resolve to an absolute path. Returns null for unusable input. */
export function expandUserPath(input: string): string | null {
  const trimmed = String(input || "").trim();
  if (!trimmed) return null;
  const expanded = trimmed === "~"
    ? homedir()
    : trimmed.startsWith("~/")
      ? join(homedir(), trimmed.slice(2))
      : trimmed;
  if (!isAbsolute(expanded)) return null;
  return resolve(expanded);
}

export function readRunnerHomeConfig(): RunnerHomeConfig | null {
  try {
    const file = getHomePointerFile();
    if (!existsSync(file)) return null;
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object" || typeof parsed.root !== "string" || !parsed.root) return null;
    return {
      root: resolve(parsed.root),
      configuredAt: typeof parsed.configuredAt === "string" ? parsed.configuredAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function writeRunnerHomeConfig(root: string): { ok: boolean; error?: string } {
  try {
    const paths = getAutostartPaths();
    mkdirSync(paths.configDir, { recursive: true });
    const config: RunnerHomeConfig = { root: resolve(root), configuredAt: new Date().toISOString() };
    writeFileSync(getHomePointerFile(), JSON.stringify(config, null, 2) + "\n", "utf8");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Resolve the effective runner home for this process.
 * Precedence: SPACEBOT_RUNNER_HOME env var, then the persisted pointer file.
 */
export function resolveRunnerHome(): ResolvedRunnerHome {
  const fromEnv = process.env.SPACEBOT_RUNNER_HOME ? expandUserPath(process.env.SPACEBOT_RUNNER_HOME) : null;
  if (fromEnv) return { root: fromEnv, source: "env" };
  const persisted = readRunnerHomeConfig();
  if (persisted) return { root: persisted.root, source: "config" };
  return { root: null, source: "none" };
}

function buildHomeReadme(root: string): string {
  return [
    "# SpaceBot Home",
    "",
    "This directory is the SpaceBot local runner's workspace on this machine.",
    "Everything here is plain markdown — read it, edit it, or version it however you like.",
    "",
    "## Layout",
    "",
    "| Path | Purpose |",
    "| --- | --- |",
    "| `SYSTEM.md` | What the runner knows about this machine. The block between the auto-generated markers is rewritten on startup; everything outside it (your notes) is preserved. |",
    "| `MEMORY.md` | Index of stored memories, one line each. |",
    "| `memory/` | One markdown file per remembered fact. |",
    "| `journal/` | Daily activity logs (`YYYY-MM-DD.md`): connections, jobs, detected system changes. |",
    "| `inbox/` | **Talk to the runner here.** Drop any `.md` file with a question or request; the runner appends its response to the same file. Start the file with `remember:` to store the content as a memory instead. |",
    "| `outbox/` | Notes the runner writes for you on its own initiative. |",
    "| `.state/` | Internal bookkeeping. Safe to delete; the runner will rebuild it. |",
    "",
    "## Interacting via markdown",
    "",
    "1. Create a file like `inbox/question.md` containing your request.",
    "2. Within a few seconds the runner appends a `## SpaceBot Response` section.",
    "3. Edit the file again (add text below the response) to continue the thread.",
    "",
    "To teach the runner something durable, create an inbox file whose first line is",
    "`remember: <short title>` followed by the fact — it is filed under `memory/` and",
    "indexed in `MEMORY.md`.",
    "",
    "You can also use the interactive TUI (`spacebot-runner`) for the same things.",
    "",
    `_Home: ${root} — created ${new Date().toISOString()}_`,
    "",
  ].join("\n");
}

/**
 * Create the home directory structure. Idempotent — never overwrites existing
 * files. Migrates a legacy ~/.spacebot/SYSTEM.md into the new home if present.
 */
export function scaffoldRunnerHome(root: string, options: { legacySystemMdPath?: string } = {}): { ok: boolean; created: string[]; error?: string } {
  const created: string[] = [];
  try {
    if (!existsSync(root)) {
      mkdirSync(root, { recursive: true });
      created.push(root);
    }
    for (const sub of HOME_SUBDIRS) {
      const dir = join(root, sub);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
        created.push(dir);
      }
    }

    const readme = join(root, "README.md");
    if (!existsSync(readme)) {
      writeFileSync(readme, buildHomeReadme(root), "utf8");
      created.push(readme);
    }

    const systemMd = join(root, "SYSTEM.md");
    const legacy = options.legacySystemMdPath;
    if (!existsSync(systemMd) && legacy && existsSync(legacy)) {
      copyFileSync(legacy, systemMd);
      created.push(systemMd);
    }

    return { ok: true, created };
  } catch (e) {
    return { ok: false, created, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Interactive first-run prompt asking where the SpaceBot home should live.
 * Only call when stdin is a TTY. Returns the chosen (validated) absolute path.
 */
export async function promptForRunnerHome(): Promise<string> {
  const defaultHome = getDefaultRunnerHome();
  const hiddenHome = resolve(join(homedir(), ".spacebot", "workspace"));
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log("");
    console.log("SpaceBot needs a home directory on this machine — a folder where it keeps");
    console.log("its memory of this system, activity journals, and the markdown inbox you");
    console.log("can use to talk to it.");
    console.log("");
    console.log(`  1) ${defaultHome}  (recommended — easy to browse)`);
    console.log(`  2) ${hiddenHome}  (hidden)`);
    console.log("  3) Somewhere else (enter a path)");
    console.log("");

    while (true) {
      const answer = (await rl.question("Where should SpaceBot live? [1] ")).trim();
      if (answer === "" || answer === "1") return defaultHome;
      if (answer === "2") return hiddenHome;

      const raw = answer === "3"
        ? await rl.question("Enter an absolute path (or ~/path): ")
        : answer;
      const expanded = expandUserPath(raw);
      if (expanded) return expanded;
      console.log("That doesn't look like a usable path. Try an absolute path or ~/path.");
    }
  } finally {
    rl.close();
  }
}
