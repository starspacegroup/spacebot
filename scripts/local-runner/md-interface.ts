/**
 * Markdown inbox: file-based interaction with the runner.
 *
 * Any `.md` file dropped into `<home>/inbox/` is treated as a message. The
 * runner appends a `## SpaceBot Response` section to the same file, so each
 * file becomes a running conversation thread — edit it again (add text below
 * the response) to continue.
 *
 * A file whose first non-empty line is `remember: <title>` is stored as a
 * memory entry instead of being answered.
 *
 * Processed state is tracked by content hash in `.state/inbox.json`; our own
 * appends update the recorded hash, so only user edits trigger reprocessing.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { appendJournal, saveMemory } from "./memory";

const MAX_INBOX_FILE_BYTES = 256 * 1024;
const REMEMBER_RE = /^#{0,6}\s*remember:\s*(.+)$/i;

export interface InboxWatcherOptions {
  root: string;
  intervalMs?: number;
  /** Produce a reply for the given conversation text. Throw or return null on failure. */
  respond: (conversation: string) => Promise<string | null>;
  log?: (message: string) => void;
}

interface InboxState {
  [fileName: string]: { hash: string; processedAt: string };
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 32);
}

function readInboxState(root: string): InboxState {
  try {
    const file = join(root, ".state", "inbox.json");
    if (!existsSync(file)) return {};
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeInboxState(root: string, state: InboxState): void {
  try {
    mkdirSync(join(root, ".state"), { recursive: true });
    writeFileSync(join(root, ".state", "inbox.json"), JSON.stringify(state, null, 2) + "\n", "utf8");
  } catch {
    // State persistence is best-effort; worst case a file is answered twice.
  }
}

function extractRememberDirective(content: string): { title: string; body: string } | null {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const match = line.match(REMEMBER_RE);
    if (!match) return null;
    const body = lines.slice(i + 1).join("\n").trim();
    return { title: match[1].trim(), body: body || match[1].trim() };
  }
  return null;
}

async function processInboxFile(options: InboxWatcherOptions, fileName: string, content: string): Promise<void> {
  const { root, respond } = options;
  const filePath = join(root, "inbox", fileName);
  const stamp = new Date().toISOString();

  const remember = extractRememberDirective(content);
  if (remember) {
    const saved = saveMemory(root, remember.title, remember.body);
    const note = saved.ok
      ? `_Saved to memory as \`memory/${saved.file?.split("/").pop()}\` and indexed in MEMORY.md._`
      : `_Failed to save memory: ${saved.error}_`;
    appendFileSync(filePath, `\n\n## SpaceBot Response (${stamp})\n\n${note}\n`, "utf8");
    return;
  }

  let reply: string | null = null;
  let failure: string | null = null;
  try {
    reply = await respond(content);
  } catch (e) {
    failure = e instanceof Error ? e.message : String(e);
  }

  const section = reply?.trim()
    ? `\n\n## SpaceBot Response (${stamp})\n\n${reply.trim()}\n`
    : `\n\n## SpaceBot Response (${stamp})\n\n_SpaceBot could not answer this right now${failure ? `: ${failure}` : "."}_\n`;
  appendFileSync(filePath, section, "utf8");
  appendJournal(root, `inbox: ${reply?.trim() ? "answered" : "failed to answer"} inbox/${fileName}`);
}

/**
 * Start polling the inbox. Returns a stop function. Files are processed
 * sequentially; a scan is skipped while a previous one is still working.
 */
export function startInboxWatcher(options: InboxWatcherOptions): () => void {
  const { root, log } = options;
  const inboxDir = join(root, "inbox");
  const intervalMs = Math.max(1000, options.intervalMs ?? 3000);
  let busy = false;
  let stopped = false;

  const scan = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      if (!existsSync(inboxDir)) return;
      const state = readInboxState(root);
      let stateDirty = false;

      for (const fileName of readdirSync(inboxDir)) {
        if (stopped) break;
        if (!fileName.endsWith(".md") || fileName.startsWith(".")) continue;

        const filePath = join(inboxDir, fileName);
        let content: string;
        try {
          if (statSync(filePath).size > MAX_INBOX_FILE_BYTES) continue;
          content = readFileSync(filePath, "utf8");
        } catch {
          continue;
        }
        if (!content.trim()) continue;

        const hash = hashContent(content);
        if (state[fileName]?.hash === hash) continue;

        log?.(`Inbox message detected: inbox/${fileName}`);
        await processInboxFile(options, fileName, content);

        // Record the post-append content so our own write doesn't retrigger.
        try {
          state[fileName] = { hash: hashContent(readFileSync(filePath, "utf8")), processedAt: new Date().toISOString() };
          stateDirty = true;
        } catch {
          // File vanished mid-processing; it will be rescanned if it returns.
        }
      }

      if (stateDirty) writeInboxState(root, state);
    } finally {
      busy = false;
    }
  };

  const timer = setInterval(() => { void scan(); }, intervalMs);
  void scan();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
