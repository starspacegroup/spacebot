/** @jsxImportSource @opentui/react */

import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  detectAutostartStatus,
  installAutostartService,
  shouldPromptForAutostart,
  writeAutostartPreference,
  type RunnerAutostartStatus,
} from "./service-manager";
import { copyTextToClipboard, negotiateRunnerTokenViaBrowser } from "./token-negotiation";
import {
  detectOllamaInstalled,
  detectOllamaRunning,
  getOllamaModels,
  getOllamaConfig,
  storeOllamaConfig,
  generateOllamaResponse,
  formatBytes,
  type OllamaModel,
} from "./ollama-utils";
import {
  readPersistedProviderConfig,
  writePersistedProviderConfig,
} from "./provider-config";
import {
  readPersistedPermissionConfig,
  writePersistedPermissionConfig,
  resolvePathsForMode,
  ensureSandboxDir,
  getDefaultSandboxPath,
  describePermissionMode,
  type PermissionMode,
  type PersistedPermissionConfig,
} from "./permission-config";
import {
  detectCopilotAvailability,
  runCopilotPrompt,
  COPILOT_MODELS,
  DEFAULT_COPILOT_MODEL,
  storeCopilotConfig,
  getCopilotConfig,
  formatCopilotMultiplier,
  type CopilotAvailability,
  type CopilotConfig,
} from "./copilot-utils";

type LlmProvider = "ollama" | "copilot";

// Spinner frames for loading states
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface RunnerTuiOptions {
  apiUrl: string;
  defaultWorkdir: string;
  displayName: string;
  hostname: string;
  allowedPaths: string[];
  scriptPath: string;
  initialToken: string;
}

type PromptChoice = "install" | "skip" | "never";

interface PromptOption {
  id: PromptChoice;
  title: string;
  description: string;
}

interface AppProps extends RunnerTuiOptions {
  onExit: () => void;
}

const IS_GHOSTTY = /ghostty/i.test(process.env.TERM ?? "") || /ghostty/i.test(process.env.TERM_PROGRAM ?? "");

/** Detect if the system prefers dark mode */
function detectDarkMode(): boolean {
  const colorfgbg = process.env.COLORFGBG ?? "";
  if (colorfgbg) {
    const parts = colorfgbg.split(";");
    const bg = parts[parts.length - 1];
    if (["7", "15", "230", "231", "232", "233", "234", "235"].includes(bg)) {
      return false;
    }
  }
  return true;
}

const isDarkMode = detectDarkMode();

// Sophisticated theme with accent colors and visual hierarchy
const THEME = IS_GHOSTTY
  ? isDarkMode
    ? {
      // Dark mode - sophisticated palette
      primary: "#06b6d4",       // Cyan - main brand color
      secondary: "#8b5cf6",     // Purple - accent
      success: "#10b981",       // Emerald - success states
      warning: "#f59e0b",       // Amber - warnings
      error: "#ef4444",         // Red - errors
      info: "#0ea5e9",          // Sky - information
      title: "#f0f9ff",         // Almost white for titles
      heading: "#cffafe",       // Light cyan for headings
      key: "#e0e7ff",           // Indigo wash for keys
      value: "#cbd5e1",         // Cool gray for values
      muted: "#64748b",         // Slate for muted text
      border: "#334155",        // Dark slate for borders
      bg: "#0f172a",            // Navy black background
      accent1: "#06b6d4",       // Cyan accent
      accent2: "#8b5cf6",       // Purple accent
    }
    : {
      // Light mode - sophisticated palette
      primary: "#0891b2",       // Dark cyan
      secondary: "#7c3aed",     // Dark purple
      success: "#059669",       // Dark emerald
      warning: "#d97706",       // Dark amber
      error: "#dc2626",         // Dark red
      info: "#0369a1",          // Dark sky
      title: "#0f172a",         // Almost black
      heading: "#1e293b",       // Slate
      key: "#334155",           // Dark slate
      value: "#475569",         // Gray slate
      muted: "#94a3b8",         // Light gray
      border: "#cbd5e1",        // Light border
      bg: "#f8fafc",            // Off-white
      accent1: "#0891b2",       // Cyan accent
      accent2: "#7c3aed",       // Purple accent
    }
  : isDarkMode
    ? {
      primary: "cyan",
      secondary: "magenta",
      success: "green",
      warning: "yellow",
      error: "red",
      info: "cyan",
      title: "white",
      heading: "cyan",
      key: "white",
      value: "gray",
      muted: "gray",
      border: "gray",
      bg: "black",
      accent1: "cyan",
      accent2: "magenta",
    }
    : {
      primary: "blue",
      secondary: "magenta",
      success: "green",
      warning: "yellow",
      error: "red",
      info: "blue",
      title: "black",
      heading: "blue",
      key: "black",
      value: "gray",
      muted: "gray",
      border: "gray",
      bg: "white",
      accent1: "blue",
      accent2: "magenta",
    };

// Strip common ANSI sequences (CSI/OSC/single-char) to prevent style leakage into TUI rendering.
const ANSI_ESCAPE_RE = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;

function formatInstallKind(kind: RunnerAutostartStatus["installKind"]): string {
  if (kind === "systemd-user") return "systemd user service";
  if (kind === "launch-agent") return "LaunchAgent";
  return "Startup folder entry";
}

function summarizeRunnerLine(line: string): string | null {
  if (line.includes("WebSocket connected")) return "Connected to SpaceBot. Waiting for jobs.";
  if (line.includes("Authenticated - runner ready") || line.includes("Authenticated — runner ready")) {
    return "Runner authenticated and ready.";
  }
  if (line.includes("Reconnecting in")) return line.replace(/^.*WARN\s*/, "");
  if (line.includes("Running job #")) return line.replace(/^.*\]\s*/, "");
  if (line.includes("Shutting down")) return "Runner shutting down.";
  if (line.includes("ERR")) return line.replace(/^.*ERR\s*/, "");
  return null;
}

function trimLogHistory(lines: string[]): string[] {
  return lines.slice(-14);
}

function normalizeDisplayText(value: string): string {
  return value
    .replace(ANSI_ESCAPE_RE, "")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]+/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function buildKeyValueLine(label: string, value: string): string {
  return `${label}: ${normalizeDisplayText(value)}`;
}

function clipForUi(value: string, max = 120): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 3))}...`;
}

function repeatChar(char: string, count: number): string {
  if (count <= 0) return "";
  return new Array(count).fill(char).join("");
}

function fitLine(value: string, width: number): string {
  const clean = normalizeDisplayText(value);
  return clipForUi(clean, width).padEnd(width);
}

function wrapForUi(value: string, width: number): string[] {
  const clean = normalizeDisplayText(value);
  if (!clean) return [""];
  if (width <= 1) return [clipForUi(clean, 1)];

  const words = clean.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (!word) continue;
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= width) {
      current = candidate;
      continue;
    }

    if (current) lines.push(current);

    if (word.length <= width) {
      current = word;
      continue;
    }

    let remaining = word;
    while (remaining.length > width) {
      lines.push(remaining.slice(0, width));
      remaining = remaining.slice(width);
    }
    current = remaining;
  }

  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatTokenStat(tokens?: number, durationMs?: number): string {
  if (typeof tokens !== "number" || tokens <= 0) return "";
  const parts: string[] = [`${tokens} tok`];
  if (typeof durationMs === "number" && durationMs > 0) {
    const seconds = durationMs / 1000;
    if (seconds >= 0.1) {
      const rate = tokens / seconds;
      parts.push(`${seconds.toFixed(seconds < 10 ? 1 : 0)}s`);
      if (rate >= 1) parts.push(`${rate.toFixed(rate < 10 ? 1 : 0)} t/s`);
    }
  }
  return parts.join(" · ");
}

/**
 * Lightweight markdown-ish formatter for terminal display.
 * Returns plain-text lines with inline markers stripped and block structure preserved.
 */
function renderMarkdownLines(text: string): string[] {
  const out: string[] = [];
  const raw = text.replace(/\r\n?/g, "\n").split("\n");
  let inCodeFence = false;
  let prevBlank = false;

  for (let i = 0; i < raw.length; i++) {
    let line = raw[i] ?? "";

    // Fenced code blocks ``` ... ```
    if (/^\s*```/.test(line)) {
      inCodeFence = !inCodeFence;
      out.push(inCodeFence ? "┄┄ code ┄┄" : "┄┄ end ┄┄");
      prevBlank = false;
      continue;
    }

    if (inCodeFence) {
      out.push(`  ${line}`);
      prevBlank = false;
      continue;
    }

    // Headings
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const text = heading[2]?.trim() ?? "";
      out.push(`▎ ${text.toUpperCase()}`);
      prevBlank = false;
      continue;
    }

    // Horizontal rule
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      out.push("─────");
      prevBlank = false;
      continue;
    }

    // Blockquote
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      line = `┃ ${quote[1] ?? ""}`;
    }

    // Bullets: -, *, +
    const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (bullet) {
      const indent = bullet[1] ?? "";
      line = `${indent}• ${bullet[2] ?? ""}`;
    } else {
      // Numbered list keeps its number, just normalize spacing
      const numbered = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
      if (numbered) {
        line = `${numbered[1] ?? ""}${numbered[2]}. ${numbered[3] ?? ""}`;
      }
    }

    // Strip inline emphasis: **bold**, __bold__, *italic*, _italic_
    line = line.replace(/\*\*([^*]+)\*\*/g, "$1");
    line = line.replace(/__([^_]+)__/g, "$1");
    line = line.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2");
    line = line.replace(/(^|[^_])_([^_\n]+)_/g, "$1$2");

    // Inline code: `code` → ⎡code⎤
    line = line.replace(/`([^`]+)`/g, "⎡$1⎤");

    // Strip simple links [text](url) → text (url)
    line = line.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");

    if (!line.trim()) {
      if (!prevBlank && out.length > 0) {
        out.push("");
        prevBlank = true;
      }
      continue;
    }
    out.push(line);
    prevBlank = false;
  }

  // Trim trailing blank
  while (out.length > 0 && !out[out.length - 1]?.trim()) out.pop();
  return out.length > 0 ? out : [""];
}

interface ChatMessageLike {
  type: "user" | "assistant" | "system" | "error" | "success";
  text: string;
  ts: number;
  author?: string;
  model?: string;
  tokens?: number;
  promptTokens?: number;
  durationMs?: number;
}

interface ChatRenderRow {
  tone: keyof typeof THEME;
  text: string;
}

/**
 * Convert a chat message into a sequence of styled rows.
 * Header line carries timestamp + author + optional token stats.
 * Body lines are markdown-rendered and indented for legibility.
 */
function renderChatMessage(msg: ChatMessageLike): ChatRenderRow[] {
  const ts = formatTimestamp(msg.ts);
  const rows: ChatRenderRow[] = [];

  let icon: string;
  let author: string;
  let headerTone: keyof typeof THEME;
  let bodyTone: keyof typeof THEME;
  let meta = "";

  switch (msg.type) {
    case "user":
      icon = "▸";
      author = "you";
      headerTone = "accent2";
      bodyTone = "value";
      break;
    case "assistant":
      icon = "✦";
      author = msg.model ?? "assistant";
      headerTone = "accent1";
      bodyTone = "heading";
      meta = formatTokenStat(msg.tokens, msg.durationMs);
      break;
    case "error":
      icon = "✕";
      author = "error";
      headerTone = "error";
      bodyTone = "error";
      break;
    case "success":
      icon = "✓";
      author = "ok";
      headerTone = "success";
      bodyTone = "success";
      break;
    default:
      icon = "ℹ";
        author = msg.author ?? "system";
      headerTone = "info";
      bodyTone = "muted";
      break;
  }

  const headerText = meta
    ? `${icon} ${ts}  ${author}  ·  ${meta}`
    : `${icon} ${ts}  ${author}`;
  rows.push({ tone: headerTone, text: headerText });

  const body = msg.type === "user" ? msg.text.split("\n") : renderMarkdownLines(msg.text);
  for (const line of body) {
    rows.push({ tone: bodyTone, text: line ? `  ${line}` : "" });
  }
  return rows;
}

function fitSegmentsToWidth(
  segments: Array<{ tone: keyof typeof THEME; text: string }>,
  width: number,
): Array<{ tone: keyof typeof THEME; text: string }> {
  const out: Array<{ tone: keyof typeof THEME; text: string }> = [];
  let remaining = Math.max(0, width);

  for (const segment of segments) {
    if (remaining <= 0) break;
    if (!segment.text) continue;
    const clipped = segment.text.length > remaining ? segment.text.slice(0, remaining) : segment.text;
    if (clipped.length > 0) {
      out.push({ tone: segment.tone, text: clipped });
      remaining -= clipped.length;
    }
  }

  if (remaining > 0) {
    out.push({ tone: "muted", text: repeatChar(" ", remaining) });
  }

  return out;
}

function createPanel(
  title: string,
  rows: Array<{ tone: keyof typeof THEME; text: string; segments?: Array<{ tone: keyof typeof THEME; text: string }> }>,
  width: number,
): StyledLine[] {
  const inner = Math.max(18, width - 4);
  const titlePrefix = `─ ${title} `;
  const titleFill = Math.max(0, inner - titlePrefix.length);

  const lines: StyledLine[] = [
    { tone: "primary", text: `┌${titlePrefix}${repeatChar("─", titleFill)}┐` },
  ];

  for (const row of rows) {
    if (row.segments && row.segments.length > 0) {
      const clippedSegments = fitSegmentsToWidth(row.segments, inner);
      const bodyText = clippedSegments.map((seg) => seg.text).join("");
      lines.push({
        tone: row.tone,
        text: `│${bodyText}│`,
        segments: [
          { tone: "primary", text: "│" },
          ...clippedSegments,
          { tone: "primary", text: "│" },
        ],
      });
      continue;
    }

    for (const wrapped of wrapForUi(row.text, inner)) {
      lines.push({ tone: row.tone, text: `│${fitLine(wrapped, inner)}│` });
    }
  }

  lines.push({ tone: "primary", text: `└${repeatChar("─", inner)}┘` });
  return lines;
}

/**
 * Build a fixed-height panel with vertical scroll support.
 * `contentHeight` is the number of body rows inside the panel (excluding borders).
 * `scrollOffset` is lines from the bottom (0 = pinned to latest).
 */
function createScrollablePanel(
  title: string,
  rows: Array<{ tone: keyof typeof THEME; text: string }>,
  width: number,
  contentHeight: number,
  scrollOffset: number,
): { lines: StyledLine[]; totalWrapped: number; clampedOffset: number } {
  const inner = Math.max(18, width - 4);
  const safeHeight = Math.max(1, contentHeight);

  // Pre-wrap every row so scroll math works on rendered lines
  const wrapped: StyledLine[] = [];
  for (const row of rows) {
    for (const piece of wrapForUi(row.text, inner)) {
      wrapped.push({ tone: row.tone, text: piece });
    }
  }

  const total = wrapped.length;
  const maxOffset = Math.max(0, total - safeHeight);
  const offset = Math.max(0, Math.min(scrollOffset, maxOffset));
  const end = total - offset;
  const start = Math.max(0, end - safeHeight);
  const slice = wrapped.slice(start, end);

  // Pad to fill height for stable layout
  while (slice.length < safeHeight) slice.push({ tone: "muted", text: "" });

  // Title with scroll indicator
  const scrollSuffix = total > safeHeight
    ? offset > 0
      ? ` ↑${offset}/${maxOffset}`
      : ` ▼`
    : "";
  const titlePrefix = `─ ${title}${scrollSuffix} `;
  const titleFill = Math.max(0, inner - titlePrefix.length);

  const lines: StyledLine[] = [
    { tone: "primary", text: `┌${titlePrefix}${repeatChar("─", titleFill)}┐` },
  ];
  for (const row of slice) {
    lines.push({ tone: row.tone, text: `│${fitLine(row.text, inner)}│` });
  }
  lines.push({ tone: "primary", text: `└${repeatChar("─", inner)}┘` });

  return { lines, totalWrapped: total, clampedOffset: offset };
}

interface StyledLine {
  tone: keyof typeof THEME;
  text: string;
  /** Optional colored segments rendered left-to-right; when present, overrides `tone+text`. */
  segments?: Array<{ tone: keyof typeof THEME; text: string }>;
}

/**
 * Get spinner character based on current tick
 */
function getSpinner(tick: number): string {
  return SPINNER_FRAMES[tick % SPINNER_FRAMES.length] ?? "⠋";
}

/**
 * Format status with visual indicator
 */
function formatStatus(status: "running" | "stopped" | "loading" | "ready" | "error", tick?: number): string {
  switch (status) {
    case "running":
      return `${tick !== undefined ? getSpinner(tick) : "▶"} Running`;
    case "stopped":
      return "⊘ Stopped";
    case "loading":
      return `${tick !== undefined ? getSpinner(tick) : "⠋"} Loading...`;
    case "ready":
      return "◉ Ready";
    case "error":
      return "✕ Error";
  }
}

type RunnerSocketState = "disconnected" | "connecting" | "connected" | "reconnecting";

function parseRunnerSocketState(line: string): RunnerSocketState | null {
  const lower = line.toLowerCase();
  if (lower.includes("websocket connected") || lower.includes("authenticated")) return "connected";
  if (lower.includes("connecting to") && lower.includes("/api/runner/ws")) return "connecting";
  if (lower.includes("websocket closed") || lower.includes("websocket error") || lower.includes("reconnecting in")) return "reconnecting";
  if (lower.includes("shutting down") || lower.includes("runner exited")) return "disconnected";
  return null;
}

function App({ apiUrl, defaultWorkdir, displayName, hostname, allowedPaths, scriptPath, initialToken, onExit }: AppProps) {
  const initialStatus = useMemo(() => detectAutostartStatus(), []);
  // Hydrate persisted provider/ollama/copilot config so users don't re-pick on every launch.
  const initialProvider = useMemo<LlmProvider | null>(() => {
    const persisted = readPersistedProviderConfig();
    if (persisted.ollama) {
      process.env.OLLAMA_HOST = persisted.ollama.host;
      process.env.OLLAMA_PORT = String(persisted.ollama.port);
      process.env.OLLAMA_MODEL = persisted.ollama.model;
    }
    if (persisted.copilot) {
      process.env.SPACEBOT_COPILOT_MODEL = persisted.copilot.model;
      process.env.SPACEBOT_COPILOT_VIA = persisted.copilot.via;
    }
    const envProvider = process.env.SPACEBOT_LLM_PROVIDER;
    if (envProvider === "ollama" || envProvider === "copilot") return envProvider;
    if (persisted.provider === "ollama" || persisted.provider === "copilot") {
      process.env.SPACEBOT_LLM_PROVIDER = persisted.provider;
      return persisted.provider;
    }
    return null;
  }, []);
  const [autostartStatus, setAutostartStatus] = useState(initialStatus);
  // Default to "skip" so users can dismiss with a single Enter — autostart is recommended, not required.
  const [promptSelection, setPromptSelection] = useState(0);

  // Permission config (allowed paths) — null means user hasn't picked yet OR they hit Skip last run.
  const initialPermissionConfig = useMemo(() => readPersistedPermissionConfig(), []);
  const [permissionConfig, setPermissionConfig] = useState<PersistedPermissionConfig | null>(initialPermissionConfig);
  // Live allowedPaths used by the dashboard render — env wins, then persisted, else empty.
  const [effectiveAllowedPaths, setEffectiveAllowedPaths] = useState<string[]>(() => {
    if (allowedPaths.length > 0) return allowedPaths;
    return initialPermissionConfig?.paths ?? [];
  });

  const [mode, setMode] = useState<"prompt" | "permission-setup" | "provider-setup" | "dashboard">(() => {
    if (shouldPromptForAutostart(initialStatus)) return "prompt";
    // Skip the permission wizard only if the user already configured a mode, or an env override is in effect.
    const envOverride = allowedPaths.length > 0; // populated from RUNNER_ALLOWED_PATHS at boot
    if (!initialPermissionConfig && !envOverride) return "permission-setup";
    if (!initialProvider) return "provider-setup";
    return "dashboard";
  });
  const [runnerState, setRunnerState] = useState("Preparing runner process...");
  const [serviceMessage, setServiceMessage] = useState(normalizeDisplayText(initialStatus.detail));
  const [logs, setLogs] = useState<string[]>([
    buildKeyValueLine("API", apiUrl),
    buildKeyValueLine("Runner", displayName),
    buildKeyValueLine("Host", hostname),
    buildKeyValueLine("Workdir", defaultWorkdir),
  ]);
  const [childRunning, setChildRunning] = useState(false);
  const [socketState, setSocketState] = useState<RunnerSocketState>("disconnected");
  const [disconnectAlert, setDisconnectAlert] = useState<string | null>(null);
  const [runnerToken, setRunnerToken] = useState(initialToken.trim());
  const [tokenNegotiating, setTokenNegotiating] = useState(false);
  const [manualOpenUrl, setManualOpenUrl] = useState("");
  const childRef = useRef<ChildProcessWithoutNullStreams | null>(null);
  const stdoutCarryRef = useRef("");
  const stderrCarryRef = useRef("");
  const bootedDashboardRef = useRef(false);
  const [spinnerTick, setSpinnerTick] = useState(0);

  // Ollama state
  const [ollamaInstalled, setOllamaInstalled] = useState(false);
  const [ollamaRunning, setOllamaRunning] = useState(false);
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [ollamaDetecting, setOllamaDetecting] = useState(true);

  // Copilot state
  const [copilotAvailability, setCopilotAvailability] = useState<CopilotAvailability | null>(null);
  const [activeCopilotConfig, setActiveCopilotConfig] = useState<CopilotConfig | null>(() => getCopilotConfig());

  // Active LLM provider — null means user hasn't picked yet.
  const [activeProvider, setActiveProvider] = useState<LlmProvider | null>(initialProvider);
  const providerPromptShownRef = useRef(false);

  // Provider setup wizard state
  const [providerSetupStep, setProviderSetupStep] = useState<"provider" | "model" | "copilot-model">("provider");
  const [providerSetupSelection, setProviderSetupSelection] = useState(0);
  const [modelSetupSelection, setModelSetupSelection] = useState(0);
  const [copilotModelSetupSelection, setCopilotModelSetupSelection] = useState(0);
  const [providerSetupError, setProviderSetupError] = useState<string | null>(null);
  // True when the model picker was opened via /models from the chat rather than the initial wizard.
  const [modelPickerFromCommand, setModelPickerFromCommand] = useState(false);

  // Permission setup wizard state
  const [permissionSetupSelection, setPermissionSetupSelection] = useState(0);
  const [permissionSetupConfirm, setPermissionSetupConfirm] = useState<null | "home" | "root">(null);
  const [permissionSetupMessage, setPermissionSetupMessage] = useState<string | null>(null);
  
  // Chat interface state
  interface ChatMessage {
    type: "user" | "assistant" | "system" | "error" | "success";
    text: string;
    ts: number;
    author?: string;
    model?: string;
    tokens?: number;
    promptTokens?: number;
    durationMs?: number;
  }
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { type: "system", text: "Welcome to SpaceBot Runner. Type /help for available commands.", ts: Date.now(), author: displayName },
  ]);
  const [chatScrollOffset, setChatScrollOffset] = useState(0);
  const [chatInput, setChatInput] = useState("");
  const [chatMode, setChatMode] = useState(!shouldPromptForAutostart(initialStatus));
  const [chatBusy, setChatBusy] = useState(false);
  const [activeOllamaConfig, setActiveOllamaConfig] = useState(() => getOllamaConfig());
  const [terminalSize, setTerminalSize] = useState(() => ({
    width: process.stdout.columns ?? 120,
    height: process.stdout.rows ?? 36,
  }));
  const [panelsVisible, setPanelsVisible] = useState(true);

  // Slash-command definitions for Tab autocomplete.
  // Each entry: the full command token (with leading /) and an optional args hint.
  const SLASH_COMMANDS: ReadonlyArray<{ cmd: string; args?: string }> = [
    { cmd: "/help" },
    { cmd: "/models" },
    { cmd: "/connect", args: "<model>" },
    { cmd: "/provider", args: "<copilot|ollama>" },
    { cmd: "/providers" },
    { cmd: "/config" },
    { cmd: "/token" },
    { cmd: "/autostart" },
    { cmd: "/restart" },
    { cmd: "/permissions" },
    { cmd: "/perms" },
    { cmd: "/panels" },
    { cmd: "/show-panels" },
    { cmd: "/hide-panels" },
    { cmd: "/toggle-panels" },
    { cmd: "/clear" },
    { cmd: "/quit" },
  ];

  // Exit confirmation (double Ctrl+C / q to exit)
  const [exitConfirmPending, setExitConfirmPending] = useState(false);
  const exitConfirmTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Ephemeral status message shown in unified status bar (auto-clears)
  const [statusFlash, setStatusFlash] = useState<{ tone: keyof typeof THEME; text: string } | null>(null);
  const statusFlashTimerRef = useRef<NodeJS.Timeout | null>(null);

  const flashStatus = (tone: keyof typeof THEME, text: string, ms = 3000) => {
    setStatusFlash({ tone, text });
    if (statusFlashTimerRef.current) clearTimeout(statusFlashTimerRef.current);
    statusFlashTimerRef.current = setTimeout(() => setStatusFlash(null), ms);
  };

  const requestExit = () => {
    if (exitConfirmPending) {
      stopRunnerChild();
      onExit();
      return;
    }
    setExitConfirmPending(true);
    const serviceMsg = autostartStatus.installed
      ? "⚠  Press Ctrl+C again to exit · background service will keep the runner online"
      : "⚠  Press Ctrl+C again to exit · runner will stop (no background service installed)";
    flashStatus("warning", serviceMsg, 4000);
    if (exitConfirmTimerRef.current) clearTimeout(exitConfirmTimerRef.current);
    exitConfirmTimerRef.current = setTimeout(() => setExitConfirmPending(false), 4000);
  };

  /** Append a chat message with a timestamp and snap the conversation to the latest. */
  const addChatMessage = (msg: Omit<ChatMessage, "ts"> & { ts?: number }) => {
    const stamped: ChatMessage = {
      ts: Date.now(),
      ...(msg.type === "system" && !msg.author ? { author: displayName } : {}),
      ...msg,
    };
    setChatMessages((prev) => {
      const next = [...prev, stamped];
      // Keep history bounded to avoid runaway memory
      return next.length > 500 ? next.slice(-500) : next;
    });
    setChatScrollOffset(0);
  };

  // Spinner animation loop
  useEffect(() => {
    const interval = setInterval(() => {
      setSpinnerTick((t) => t + 1);
    }, 100);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!childRunning) {
      setDisconnectAlert(null);
      return;
    }

    if (socketState === "connected") {
      if (disconnectAlert) {
        flashStatus("success", "WebSocket reconnected. Runner is receiving jobs again.", 3000);
      }
      setDisconnectAlert(null);
      return;
    }

    if (socketState === "reconnecting" || socketState === "disconnected") {
      const alertText = socketState === "reconnecting"
        ? "WEBSOCKET CONNECTION LOST - reconnecting now"
        : "WEBSOCKET DISCONNECTED - runner cannot receive jobs";
      setDisconnectAlert(alertText);
      setRunnerState(alertText);
      flashStatus("error", alertText, 3500);
      return;
    }

    setDisconnectAlert(null);
  }, [childRunning, disconnectAlert, socketState]);

  // Logo eye blink/wink animation. Schedules itself at randomized intervals so
  // the bot face feels alive instead of robotic. "both" = full blink, "left" /
  // "right" = wink.
  const [eyeBlink, setEyeBlink] = useState<null | "both" | "left" | "right">(null);
  useEffect(() => {
    let cancelled = false;
    let timer: NodeJS.Timeout | null = null;
    const scheduleNext = () => {
      // 2.5–6.5s between blinks
      const delay = 2500 + Math.random() * 4000;
      timer = setTimeout(() => {
        if (cancelled) return;
        // ~12% chance to wink (left or right), otherwise full blink
        const roll = Math.random();
        const variant: "both" | "left" | "right" =
          roll < 0.06 ? "left" : roll < 0.12 ? "right" : "both";
        setEyeBlink(variant);
        // Hold the closed frame briefly; winks linger a touch longer
        const closedFor = variant === "both" ? 120 : 220;
        timer = setTimeout(() => {
          if (cancelled) return;
          setEyeBlink(null);
          scheduleNext();
        }, closedFor);
      }, delay);
    };
    scheduleNext();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setTerminalSize({
        width: process.stdout.columns ?? 120,
        height: process.stdout.rows ?? 36,
      });
    };

    process.stdout.on("resize", handleResize);
    return () => {
      process.stdout.off("resize", handleResize);
    };
  }, []);

  // Detect Ollama and Copilot on startup, then guide selection if needed.
  useEffect(() => {
    (async () => {
      let ollamaReady = false;
      let ollamaModelCount = 0;
      try {
        const installed = await detectOllamaInstalled();
        setOllamaInstalled(installed);

        if (installed) {
          const running = await detectOllamaRunning();
          setOllamaRunning(running);

          if (running) {
            const models = await getOllamaModels();
            setOllamaModels(models);
            setActiveOllamaConfig(getOllamaConfig());
            ollamaModelCount = models.length;
            ollamaReady = models.length > 0;
          }
        }
      } catch {
        // Silently fail Ollama detection
      } finally {
        setOllamaDetecting(false);
      }

      let copilot: CopilotAvailability | null = null;
      try {
        copilot = await detectCopilotAvailability();
        setCopilotAvailability(copilot);
      } catch {
        // Detection is best-effort.
      }

      // Detection done; if user is in the provider-setup wizard, the picker will render the fresh values automatically.
      // No inline chat picker on first run — the dedicated wizard handles guided selection.
      providerPromptShownRef.current = true;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const autostartOptions: PromptOption[] = [
    {
      id: "skip",
      title: "Skip for now",
      description: "Continue to the dashboard. You can install autostart later with `i` or /autostart.",
    },
    {
      id: "install",
      title: `Install ${formatInstallKind(autostartStatus.installKind)} (recommended)`,
      description: "Persist the current SPACEBOT_/RUNNER_ environment so the runner starts automatically.",
    },
    {
      id: "never",
      title: "Don't ask again",
      description: "Suppress this prompt until you install autostart manually from the dashboard.",
    },
  ];

  const promptOptions = autostartOptions;

  function appendLogLines(lines: string[]) {
    if (lines.length === 0) return;
    const cleaned = lines
      .map((line) => normalizeDisplayText(line))
      .filter(Boolean)
      .map((line) => clipForUi(line, 180));
    if (cleaned.length === 0) return;

    let nextSocketState: RunnerSocketState | null = null;
    for (const line of cleaned) {
      const parsed = parseRunnerSocketState(line);
      if (parsed) nextSocketState = parsed;
    }
    if (nextSocketState) setSocketState(nextSocketState);

    setLogs((current) => trimLogHistory([...current, ...cleaned]));
    const lastSummary = [...cleaned].reverse().map(summarizeRunnerLine).find(Boolean);
    if (lastSummary) setRunnerState(lastSummary);
  }

  function wireChildStream(bufferRef: React.MutableRefObject<string>, chunk: Buffer) {
    const text = bufferRef.current + chunk.toString("utf8");
    const parts = text.split(/[\r\n]+/);
    bufferRef.current = parts.pop() ?? "";
    appendLogLines(parts.filter(Boolean));
  }

  function stopRunnerChild() {
    const child = childRef.current;
    if (!child) return;
    childRef.current = null;
    stdoutCarryRef.current = "";
    stderrCarryRef.current = "";
    setChildRunning(false);
    setSocketState("disconnected");
    child.kill("SIGTERM");
  }

  function startRunnerChild(tokenOverride?: string) {
    if (childRef.current) return;
    const effectiveToken = (tokenOverride || runnerToken).trim();

    if (!effectiveToken || !effectiveToken.startsWith("sbr_")) {
      setRunnerState("No runner token configured. Use /token to fetch one from the production site.");
      return;
    }

    setRunnerState("Starting headless runner process...");
    setSocketState("connecting");
    const child = spawn(process.execPath, ["run", scriptPath, "--headless"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        SPACEBOT_RUNNER_TOKEN: effectiveToken,
        RUNNER_TUI_CHILD: "1",
        // Forward the wizard's chosen permission scope into the headless child.
        // Falls back to whatever was already in the env if the user skipped the wizard.
        ...(effectiveAllowedPaths.length > 0
          ? { RUNNER_ALLOWED_PATHS: effectiveAllowedPaths.join(":") }
          : {}),
        NO_COLOR: "1",
        FORCE_COLOR: "0",
        CLICOLOR: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    childRef.current = child;
    setChildRunning(true);
    appendLogLines([`Spawned runner child with ${process.execPath}.`]);

    child.stdout.on("data", (chunk) => wireChildStream(stdoutCarryRef, chunk));
    child.stderr.on("data", (chunk) => wireChildStream(stderrCarryRef, chunk));
    child.on("exit", (code, signal) => {
      if (stdoutCarryRef.current) appendLogLines([stdoutCarryRef.current]);
      if (stderrCarryRef.current) appendLogLines([stderrCarryRef.current]);
      stdoutCarryRef.current = "";
      stderrCarryRef.current = "";
      childRef.current = null;
      setChildRunning(false);
      setSocketState("disconnected");

      if (code === 75) {
        appendLogLines(["Code update detected. Restarting runner child automatically..."]);
        setRunnerState("Code updated - restarting runner child...");
        setTimeout(() => startRunnerChild(), 200);
        return;
      }

      setRunnerState(signal
        ? `Runner exited after ${signal}.`
        : `Runner exited with code ${code ?? 0}. Run /restart to start it again.`);
    });
  }

  async function handleChatCommand(input: string) {
    const text = input.trim();
    if (!text) return;

    // Collapse panels on first user message
    if (chatMessages.every((m) => m.type !== "user")) {
      setPanelsVisible(false);
    }

    setChatMessages((prev) => {
      const next = [...prev, { type: "user" as const, text, ts: Date.now() }];
      return next.length > 500 ? next.slice(-500) : next;
    });
    setChatScrollOffset(0);
    setChatInput("");

    if (text === "/help") {
      const helpText = [
        "### AI Provider",
        "- `/providers`           Show detected backends (Ollama, Copilot)",
        "- `/provider <name>`     Switch backend: `ollama` or `copilot`",
        "",
        "### Ollama",
        "- `/models`             List available models (Ollama or Copilot, depending on active provider)",
        "- `/connect <model>`    Connect to a specific model",
        "- `/config`             Show active provider configuration",
        "- `/clear`              Clear conversation history",
        "",
        "### Runner",
        "- `/token`               Negotiate a runner token via browser",
        "- `/autostart`           Install autostart service",
        "- `/permissions`         Re-open the allowed-paths wizard",
        "- `/restart`             Restart the runner child process",
        "- `/quit`                Exit SpaceBot Runner",
        "",
        "### Interface",
        "- `/panels`              Toggle side panels",
        "- `/hide-panels`         Hide side panels (chat-focused)",
        "- `/show-panels`         Show all panels",
        "",
        "### Keyboard",
        "- **PgUp / PgDn**        Scroll conversation by page",
        "- **Shift+Up / Down**    Scroll conversation by line",
        "- **Ctrl+End**           Jump to latest message",
        "- **Esc**                Unfocus chat input",
        "- **Tab**                Toggle panels",
        "- **Ctrl+C ×2**          Exit",
      ].join("\n");
      addChatMessage({ type: "system", text: helpText });
      return;
    }

    if (text === "/panels" || text === "/toggle-panels") {
      setPanelsVisible((prev) => !prev);
      addChatMessage({ type: "system", text: `Panels ${!panelsVisible ? "hidden" : "shown"}.` });
      return;
    }

    if (text === "/show-panels") {
      setPanelsVisible(true);
      addChatMessage({ type: "system", text: "Panels shown." });
      return;
    }

    if (text === "/hide-panels") {
      setPanelsVisible(false);
      addChatMessage({ type: "system", text: "Panels hidden." });
      return;
    }

    if (text === "/models") {
      if (activeProvider === "copilot") {
        const current = activeCopilotConfig?.model ?? DEFAULT_COPILOT_MODEL;
        const idx = COPILOT_MODELS.findIndex((m) => m.id === current);
        setCopilotModelSetupSelection(idx >= 0 ? idx : 0);
        setModelPickerFromCommand(true);
        setChatMode(false);
        setChatInput("");
        setProviderSetupStep("copilot-model");
        setMode("provider-setup");
        return;
      }
      if (!ollamaRunning) {
        addChatMessage({ type: "error", text: "Ollama is not running" });
        return;
      }

      const models = await getOllamaModels();
      setOllamaModels(models);
      if (models.length === 0) {
        addChatMessage({ type: "error", text: "No models found in Ollama" });
        return;
      }

      setModelSetupSelection(0);
      setModelPickerFromCommand(true);
      setChatMode(false);
      setChatInput("");
      setProviderSetupStep("model");
      setMode("provider-setup");
      return;
    }

    if (text.startsWith("/connect ")) {
      const model = text.slice(9).trim();
      if (!model) {
        addChatMessage({ type: "error", text: "Usage: /connect <model>" });
        return;
      }

      if (activeProvider === "copilot") {
        const c = copilotAvailability;
        if (!c || (!c.copilotCli && !(c.ghCopilot && c.ghAuthed))) {
          addChatMessage({ type: "error", text: "Copilot CLI is not available. Run `/providers` for status." });
          return;
        }
        const via: "copilot" | "gh" = c.copilotCli ? "copilot" : "gh";
        const cfg: CopilotConfig = { model, via };
        storeCopilotConfig(cfg);
        setActiveCopilotConfig(cfg);
        writePersistedProviderConfig({ provider: "copilot", copilot: cfg });
        const known = COPILOT_MODELS.find((m) => m.id === model);
        addChatMessage({
          type: "success",
          text: known
            ? `Copilot model set to \`${model}\` · ${formatCopilotMultiplier(known.multiplier)} _(${known.label})_.`
            : `Copilot model set to \`${model}\` _(custom — cost unknown; make sure the CLI accepts this id)_.`,
        });
        return;
      }

      if (!ollamaRunning) {
        addChatMessage({ type: "error", text: "Ollama is not running" });
        return;
      }

      let models = ollamaModels;
      if (models.length === 0) {
        models = await getOllamaModels();
        setOllamaModels(models);
      }
      if (!models.some((m) => m.name === model)) {
        addChatMessage({ type: "error", text: `Model not found: ${model}. Use /models first.` });
        return;
      }

      const config = { host: "localhost", port: 11434, model };
      storeOllamaConfig(config);
      setActiveOllamaConfig(config);
      if (!activeProvider) {
        setActiveProvider("ollama");
        process.env.SPACEBOT_LLM_PROVIDER = "ollama";
      }
      writePersistedProviderConfig({ provider: "ollama", ollama: config });
      addChatMessage({ type: "success", text: `Connected to model: \`${model}\` (provider: ollama)` });
      return;
    }

    if (text === "/config") {
      if (activeProvider === "copilot") {
        const c = copilotAvailability;
        const cfg = activeCopilotConfig ?? getCopilotConfig();
        const modelId = cfg?.model ?? DEFAULT_COPILOT_MODEL;
        const known = COPILOT_MODELS.find((m) => m.id === modelId);
        const lines = [
          "### Copilot Config",
          `- **Active provider**: \`copilot\``,
          `- **Model**: \`${modelId}\`${cfg ? "" : " _(default)_"}`,
          `- **Cost**: ${known ? formatCopilotMultiplier(known.multiplier) + " premium-request multiplier" : "_unknown (custom model id)_"}`,
          `- **CLI path**: ${c?.copilotCli ? "standalone `copilot`" : c?.ghCopilot && c?.ghAuthed ? "`gh copilot` extension" : "_unavailable_"}`,
        ];
        addChatMessage({ type: "system", text: lines.join("\n") });
        return;
      }
      const config = activeOllamaConfig ?? getOllamaConfig();
      if (!config) {
        addChatMessage({ type: "error", text: "No Ollama config set up yet" });
        return;
      }
      addChatMessage({
        type: "system",
        text: `### Ollama Config\n- **Active provider**: \`ollama\`\n- **Host**: ${config.host}\n- **Port**: ${config.port}\n- **Model**: \`${config.model}\``,
      });
      return;
    }

    if (text === "/token") {
      await negotiateToken();
      addChatMessage({ type: "success", text: "Token negotiation completed." });
      return;
    }

    if (text === "/autostart") {
      installFromDashboard();
      addChatMessage({ type: "success", text: "Autostart installation attempted." });
      return;
    }

    if (text === "/restart") {
      stopRunnerChild();
      setTimeout(() => {
        startRunnerChild();
      }, 150);
      addChatMessage({ type: "success", text: "Restarting runner child process." });
      return;
    }

    if (text === "/permissions" || text === "/perms") {
      addChatMessage({
        type: "system",
        text: permissionConfig
          ? `Current scope: **${describePermissionMode(permissionConfig.mode)}**\nPaths: \`${permissionConfig.paths.join("`, `")}\`\n\nOpening the wizard to change it…`
          : "Opening the allowed-paths wizard…",
      });
      stopRunnerChild();
      setPermissionSetupSelection(0);
      setPermissionSetupConfirm(null);
      setPermissionSetupMessage(null);
      setMode("permission-setup");
      return;
    }

    if (text === "/quit") {
      requestExit();
      return;
    }

    if (text === "/clear") {
      setChatMessages([{ type: "system", text: "Chat cleared. Type /help for commands.", ts: Date.now(), author: displayName }]);
      setChatScrollOffset(0);
      return;
    }

    if (text === "/providers") {
      const lines: string[] = ["### Detected providers"];
      lines.push(`- **Ollama**: ${ollamaRunning ? `running · ${ollamaModels.length} model(s)` : ollamaInstalled ? "installed but not running" : "not detected"}`);
      if (copilotAvailability) {
        const c = copilotAvailability;
        const ghPart = c.ghCopilot ? (c.ghAuthed ? "ready" : "unauthed (run `gh auth login`)") : "not installed";
        lines.push(`- **GitHub Copilot CLI**: ${c.copilotCli ? "standalone ready" : "not installed"}`);
        lines.push(`- **gh copilot extension**: ${ghPart}`);
      }
      lines.push("");
      lines.push(`> Active: \`${activeProvider ?? "none"}\` · switch with \`/provider ollama\` or \`/provider copilot\``);
      addChatMessage({ type: "system", text: lines.join("\n") });
      return;
    }

    if (text.startsWith("/provider")) {
      const arg = text.slice("/provider".length).trim().toLowerCase();
      if (!arg) {
        addChatMessage({
          type: "system",
          text: `Active provider: \`${activeProvider ?? "none"}\`. Switch with \`/provider ollama\` or \`/provider copilot\`.`,
        });
        return;
      }
      if (arg !== "ollama" && arg !== "copilot") {
        addChatMessage({ type: "error", text: "Usage: /provider <ollama|copilot>" });
        return;
      }
      if (arg === "ollama") {
        setActiveProvider("ollama");
        process.env.SPACEBOT_LLM_PROVIDER = "ollama";
        writePersistedProviderConfig({ provider: "ollama" });
        if (!ollamaRunning) {
          addChatMessage({ type: "error", text: "Ollama provider selected, but Ollama is not running. Start it, then `/models` and `/connect <model>`." });
        } else if (!(activeOllamaConfig ?? getOllamaConfig())?.model) {
          addChatMessage({ type: "success", text: "Switched to Ollama. Use `/models` then `/connect <model>` to pick a model." });
        } else {
          addChatMessage({ type: "success", text: `Switched to Ollama (\`${(activeOllamaConfig ?? getOllamaConfig())!.model}\`).` });
        }
        return;
      }
      // copilot
      setActiveProvider("copilot");
      process.env.SPACEBOT_LLM_PROVIDER = "copilot";
      writePersistedProviderConfig({ provider: "copilot" });
      let copilot = copilotAvailability;
      if (!copilot) {
        copilot = await detectCopilotAvailability();
        setCopilotAvailability(copilot);
      }
      if (!copilot.copilotCli && !copilot.ghCopilot) {
        addChatMessage({
          type: "error",
          text: "Copilot selected, but no Copilot CLI was found. Install one of:\n- `gh extension install github/gh-copilot` (with `gh auth login`)\n- Standalone `copilot` CLI",
        });
        return;
      }
      if (copilot.ghCopilot && !copilot.ghAuthed && !copilot.copilotCli) {
        addChatMessage({ type: "error", text: "`gh copilot` is installed but `gh` is not authenticated. Run `gh auth login`, then retry." });
        return;
      }
      addChatMessage({ type: "success", text: `Switched to GitHub Copilot _(${copilot.summary})_.` });
      return;
    }

    if (text.startsWith("/")) {
      addChatMessage({ type: "error", text: `Unknown command: ${text}. Type /help for help.` });
      return;
    }

    // ---- LLM dispatch ----
    // If no provider chosen yet, prompt the user.
    if (!activeProvider) {
      addChatMessage({
        type: "error",
        text: "No AI provider selected. Run `/providers` to see what's available, then `/provider ollama` or `/provider copilot`.",
      });
      return;
    }

    if (activeProvider === "copilot") {
      let copilot = copilotAvailability;
      if (!copilot) {
        copilot = await detectCopilotAvailability();
        setCopilotAvailability(copilot);
      }
      if (!copilot.copilotCli && !copilot.ghCopilot) {
        addChatMessage({
          type: "error",
          text: "GitHub Copilot CLI is not installed. Install it or switch to Ollama with `/provider ollama`.",
        });
        return;
      }
      setChatBusy(true);
      const cfg = activeCopilotConfig ?? getCopilotConfig();
      const model = cfg?.model ?? DEFAULT_COPILOT_MODEL;
      const preferVia: "copilot" | "gh" =
        cfg?.via ?? (copilot.copilotCli ? "copilot" : "gh");
      const result = await runCopilotPrompt(text, copilot, { model, preferVia });
      setChatBusy(false);
      if (!result.ok) {
        addChatMessage({
          type: "error",
          text: `Copilot: ${result.error ?? "unknown error"}\n_Fallback: try \`/provider ollama\` if available._`,
        });
        return;
      }
      addChatMessage({
        type: "assistant",
        text: result.text ?? "",
        model: `copilot · ${model}`,
        durationMs: result.durationMs,
      });
      return;
    }

    // Ollama path
    if (!ollamaRunning) {
      addChatMessage({
        type: "error",
        text: "Ollama is not running. Start it, then use `/models` and `/connect`. Or switch with `/provider copilot`.",
      });
      return;
    }

    const config = activeOllamaConfig ?? getOllamaConfig();
    if (!config?.model) {
      addChatMessage({ type: "error", text: "No model selected. Use `/models` then `/connect <model>`." });
      return;
    }

    setChatBusy(true);
    const startedAt = Date.now();
    const result = await generateOllamaResponse({
      host: config.host,
      port: config.port,
      model: config.model,
      prompt: text,
    });
    setChatBusy(false);

    if (!result.ok) {
      const errorResult = result as { ok: false; error: string };
      addChatMessage({
        type: "error",
        text: `Ollama: ${errorResult.error}${copilotAvailability && (copilotAvailability.copilotCli || copilotAvailability.ghCopilot) ? "\n_Fallback: try `/provider copilot`._" : ""}`,
      });
      return;
    }

    const durationMs = result.stats.totalDurationMs ?? Date.now() - startedAt;
    addChatMessage({
      type: "assistant",
      text: result.text,
      model: result.stats.model ?? config.model,
      tokens: result.stats.evalCount,
      promptTokens: result.stats.promptEvalCount,
      durationMs,
    });
  }

  function applyPromptChoice(choice: PromptChoice) {
    if (choice === "install") {
      if (!runnerToken || !runnerToken.startsWith("sbr_")) {
        setServiceMessage(normalizeDisplayText("A runner token is required before installing auto-start. Press k first."));
        if (!activeProvider) {
          setMode("provider-setup");
          setProviderSetupStep("provider");
          setProviderSetupSelection(0);
        } else {
          setMode("dashboard");
        }
        return;
      }

      const result = installAutostartService({
        scriptPath,
        env: {
          ...process.env,
          SPACEBOT_RUNNER_TOKEN: runnerToken,
        },
      });
      setAutostartStatus(result.status);
      setServiceMessage(normalizeDisplayText(result.detail));
      appendLogLines([result.detail]);
      writeAutostartPreference({
        suppressServicePrompt: false,
        updatedAt: new Date().toISOString(),
      });
    } else if (choice === "never") {
      writeAutostartPreference({
        suppressServicePrompt: true,
        updatedAt: new Date().toISOString(),
      });
      const refreshed = detectAutostartStatus();
      setAutostartStatus(refreshed);
      setServiceMessage(normalizeDisplayText("Autostart prompt disabled for this machine."));
      appendLogLines(["Autostart prompt disabled for this machine."]);
    } else {
      appendLogLines(["Skipped autostart installation for this session."]);
    }

    // After autostart decision, route to permission wizard first, then provider setup, then dashboard.
    const envOverride = allowedPaths.length > 0;
    if (!permissionConfig && !envOverride) {
      setMode("permission-setup");
      setPermissionSetupSelection(0);
      setPermissionSetupConfirm(null);
      setPermissionSetupMessage(null);
    } else if (!activeProvider) {
      setMode("provider-setup");
      setProviderSetupStep("provider");
      setProviderSetupSelection(0);
    } else {
      setMode("dashboard");
    }
  }

  // -------- Permission Setup Wizard --------

  interface PermissionOption {
    id: PermissionMode | "skip";
    title: string;
    summary: string;
    summaryTone: keyof typeof THEME;
    hint: string;
    confirm?: "home" | "root";
  }

  const buildPermissionOptions = (): PermissionOption[] => {
    return [
      {
        id: "sandbox",
        title: "🟢  Sandbox · ~/spacebot (recommended)",
        summary: `Only allow jobs inside ${getDefaultSandboxPath()}. Folder will be created if missing.`,
        summaryTone: "success",
        hint: "Safest option. Most things you'll ask the runner to do can live in this folder.",
      },
      {
        id: "home",
        title: "🟡  Home directory · ~/",
        summary: "Allow jobs anywhere under your home directory. The runner can touch your dotfiles and projects.",
        summaryTone: "warning",
        hint: "Convenient, but the runner can read/write your entire home dir. Press Enter, then confirm.",
        confirm: "home",
      },
      {
        id: "root",
        title: "🔴  Entire filesystem · /",
        summary: "Allow jobs anywhere on this machine, including /etc and /usr. STRONGLY DISCOURAGED.",
        summaryTone: "error",
        hint: "Only use this on machines you fully control. Requires explicit confirmation.",
        confirm: "root",
      },
      {
        id: "skip",
        title: "⏭️   Skip for now — ask me next time",
        summary: "Continue without setting a scope. The runner will reject every working_dir until you choose one.",
        summaryTone: "muted",
        hint: "Nothing is written to disk. The wizard will reappear on next launch.",
      },
    ];
  };

  function commitPermissionMode(targetMode: PermissionMode) {
    const paths = resolvePathsForMode(targetMode);

    if (targetMode === "sandbox") {
      const ensure = ensureSandboxDir();
      if (!ensure.ok) {
        setPermissionSetupMessage(`Could not create ${ensure.path}: ${ensure.error}`);
        return;
      }
    }

    const config: PersistedPermissionConfig = {
      mode: targetMode,
      paths,
      configuredAt: new Date().toISOString(),
      acknowledgedRisk: targetMode === "home" || targetMode === "root",
    };
    const result = writePersistedPermissionConfig(config);
    if (!result.ok) {
      setPermissionSetupMessage(`Failed to save permissions: ${result.error}`);
      return;
    }

    setPermissionConfig(config);
    setEffectiveAllowedPaths(paths);
    appendLogLines([`Permissions set to ${describePermissionMode(targetMode)} → ${paths.join(", ")}`]);
    addChatMessage({
      type: "success",
      text: `Permissions: **${describePermissionMode(targetMode)}**\n\nAllowed: \`${paths.join("`, `")}\``,
    });

    setPermissionSetupConfirm(null);
    setPermissionSetupMessage(null);

    // Advance to provider setup if needed, else dashboard.
    if (!activeProvider) {
      setMode("provider-setup");
      setProviderSetupStep("provider");
      setProviderSetupSelection(0);
    } else {
      setMode("dashboard");
      // If the dashboard was already booted once (e.g. user re-opened the
      // wizard via /permissions), the auto-start effect won't fire again —
      // restart explicitly so the headless child picks up the new scope.
      if (bootedDashboardRef.current && !childRef.current && runnerToken.startsWith("sbr_")) {
        setTimeout(() => startRunnerChild(), 100);
      }
    }
  }

  function skipPermissionSetup() {
    appendLogLines(["Skipped permission setup — will be asked again on next launch."]);
    addChatMessage({
      type: "system",
      text: "Permissions skipped for this session. The runner will reject every working_dir until you choose a scope. Re-run with `/permissions` or restart to pick one.",
    });
    setPermissionSetupConfirm(null);
    setPermissionSetupMessage(null);
    if (!activeProvider) {
      setMode("provider-setup");
      setProviderSetupStep("provider");
      setProviderSetupSelection(0);
    } else {
      setMode("dashboard");
    }
  }

  function handlePermissionSetupKey(key: { name?: string; sequence?: string; shift?: boolean; ctrl?: boolean }) {
    // Confirmation overlay handling
    if (permissionSetupConfirm) {
      if (key.name === "escape" || key.name === "backspace") {
        setPermissionSetupConfirm(null);
        setPermissionSetupMessage(null);
        return;
      }
      if (key.sequence && (key.sequence.toLowerCase() === "y" || key.name === "return")) {
        const toCommit: PermissionMode = permissionSetupConfirm;
        setPermissionSetupConfirm(null);
        commitPermissionMode(toCommit);
        return;
      }
      if (key.sequence && key.sequence.toLowerCase() === "n") {
        setPermissionSetupConfirm(null);
        return;
      }
      return;
    }

    const opts = buildPermissionOptions();
    if (key.name === "escape") {
      skipPermissionSetup();
      return;
    }
    if (key.name === "up") {
      setPermissionSetupSelection((s) => (s + opts.length - 1) % opts.length);
      setPermissionSetupMessage(null);
      return;
    }
    if (key.name === "down" || key.name === "tab") {
      setPermissionSetupSelection((s) => (s + 1) % opts.length);
      setPermissionSetupMessage(null);
      return;
    }
    if (key.name === "return") {
      const chosen = opts[permissionSetupSelection];
      if (!chosen) return;
      if (chosen.id === "skip") {
        skipPermissionSetup();
        return;
      }
      if (chosen.confirm) {
        setPermissionSetupConfirm(chosen.confirm);
        return;
      }
      commitPermissionMode(chosen.id as PermissionMode);
      return;
    }
  }

  // -------- end Permission Setup Wizard --------

  // -------- Provider Setup Wizard --------

  interface ProviderOption {
    id: "ollama" | "copilot" | "skip";
    title: string;
    status: string;
    statusTone: keyof typeof THEME;
    selectable: boolean; // whether Enter advances/confirms
    hint?: string;
  }

  const buildProviderOptions = (): ProviderOption[] => {
    const opts: ProviderOption[] = [];

    // Ollama row
    if (ollamaDetecting) {
      opts.push({
        id: "ollama",
        title: "Ollama (local)",
        status: "detecting...",
        statusTone: "muted",
        selectable: false,
        hint: "Waiting for detection to complete.",
      });
    } else if (ollamaRunning && ollamaModels.length > 0) {
      opts.push({
        id: "ollama",
        title: "Ollama (local)",
        status: `ready · ${ollamaModels.length} model${ollamaModels.length === 1 ? "" : "s"} available`,
        statusTone: "success",
        selectable: true,
        hint: "Press Enter to pick a model.",
      });
    } else if (ollamaRunning) {
      opts.push({
        id: "ollama",
        title: "Ollama (local)",
        status: "running, but no models installed",
        statusTone: "warning",
        selectable: true,
        hint: "Press Enter to select Ollama anyway (pull a model later with `ollama pull`).",
      });
    } else if (ollamaInstalled) {
      opts.push({
        id: "ollama",
        title: "Ollama (local)",
        status: "installed but not running",
        statusTone: "warning",
        selectable: true,
        hint: "Start Ollama (`ollama serve`), then re-detect from /providers.",
      });
    } else {
      opts.push({
        id: "ollama",
        title: "Ollama (local)",
        status: "not detected",
        statusTone: "error",
        selectable: false,
        hint: "Install from https://ollama.com to enable local inference.",
      });
    }

    // Copilot row
    const c = copilotAvailability;
    if (!c) {
      opts.push({
        id: "copilot",
        title: "GitHub Copilot",
        status: "detecting...",
        statusTone: "muted",
        selectable: false,
      });
    } else if (c.copilotCli) {
      opts.push({
        id: "copilot",
        title: "GitHub Copilot",
        status: "ready · standalone `copilot` CLI",
        statusTone: "success",
        selectable: true,
        hint: "Press Enter to select.",
      });
    } else if (c.ghCopilot && c.ghAuthed) {
      opts.push({
        id: "copilot",
        title: "GitHub Copilot",
        status: "ready · gh extension",
        statusTone: "success",
        selectable: true,
        hint: "Press Enter to select.",
      });
    } else if (c.ghCopilot) {
      opts.push({
        id: "copilot",
        title: "GitHub Copilot",
        status: "needs `gh auth login`",
        statusTone: "warning",
        selectable: false,
        hint: "Authenticate gh, then re-launch.",
      });
    } else {
      opts.push({
        id: "copilot",
        title: "GitHub Copilot",
        status: "not detected",
        statusTone: "error",
        selectable: false,
        hint: "Install `gh extension install github/gh-copilot` or the standalone `copilot` CLI.",
      });
    }

    opts.push({
      id: "skip",
      title: "Skip for now",
      status: "decide later",
      statusTone: "muted",
      selectable: true,
      hint: "Continue to the dashboard. Pick a provider any time with /provider.",
    });

    return opts;
  };

  function selectProviderFromWizard(id: "ollama" | "copilot" | "skip") {
    setProviderSetupError(null);
    if (id === "skip") {
      setMode("dashboard");
      return;
    }
    if (id === "ollama") {
      if (!ollamaRunning) {
        // Allow selection even when not running so user is committed; warn them.
        setActiveProvider("ollama");
        process.env.SPACEBOT_LLM_PROVIDER = "ollama";
        writePersistedProviderConfig({ provider: "ollama" });
        addChatMessage({
          type: "system",
          text: "Ollama selected, but it is not running yet. Start it with `ollama serve`, then `/models` and `/connect <model>`.",
        });
        setMode("dashboard");
        return;
      }
      if (ollamaModels.length === 0) {
        setActiveProvider("ollama");
        process.env.SPACEBOT_LLM_PROVIDER = "ollama";
        writePersistedProviderConfig({ provider: "ollama" });
        addChatMessage({
          type: "system",
          text: "Ollama selected. No models found — pull one (e.g. `ollama pull llama3.2`), then `/connect <model>`.",
        });
        setMode("dashboard");
        return;
      }
      // Models available → go to model selection step
      setProviderSetupStep("model");
      setModelSetupSelection(0);
      return;
    }
    // copilot
    const c = copilotAvailability;
    if (!c || (!c.copilotCli && !(c.ghCopilot && c.ghAuthed))) {
      setProviderSetupError("Copilot isn't ready yet. Install the CLI or authenticate gh, then retry.");
      return;
    }
    setActiveProvider("copilot");
    process.env.SPACEBOT_LLM_PROVIDER = "copilot";
    writePersistedProviderConfig({ provider: "copilot" });
    // Advance to model picker
    setProviderSetupStep("copilot-model");
    // Pre-select current model (or default)
    const current = (activeCopilotConfig ?? getCopilotConfig())?.model ?? DEFAULT_COPILOT_MODEL;
    const idx = COPILOT_MODELS.findIndex((m) => m.id === current);
    setCopilotModelSetupSelection(idx >= 0 ? idx : 0);
  }

  function selectModelFromWizard(modelName: string) {
    const config = { host: "localhost", port: 11434, model: modelName };
    storeOllamaConfig(config);
    setActiveOllamaConfig(config);
    setActiveProvider("ollama");
    process.env.SPACEBOT_LLM_PROVIDER = "ollama";
    writePersistedProviderConfig({ provider: "ollama", ollama: config });
    addChatMessage({ type: "success", text: `Connected to Ollama model: \`${modelName}\`` });
    setModelPickerFromCommand(false);
    setMode("dashboard");
  }

  function selectCopilotModelFromWizard(modelId: string) {
    const c = copilotAvailability;
    const via: "copilot" | "gh" = c?.copilotCli ? "copilot" : "gh";
    const cfg: CopilotConfig = { model: modelId, via };
    storeCopilotConfig(cfg);
    setActiveCopilotConfig(cfg);
    writePersistedProviderConfig({ provider: "copilot", copilot: cfg });
    const known = COPILOT_MODELS.find((m) => m.id === modelId);
    const costPart = known ? ` · ${formatCopilotMultiplier(known.multiplier)}` : "";
    const label = known?.label ?? modelId;
    addChatMessage({ type: "success", text: `Switched to GitHub Copilot · \`${modelId}\`${costPart} _(${label})_.` });
    setModelPickerFromCommand(false);
    setMode("dashboard");
  }

  function handleProviderSetupKey(key: { name?: string; sequence?: string; shift?: boolean; ctrl?: boolean }) {
    if (providerSetupStep === "provider") {
      const opts = buildProviderOptions();
      if (key.name === "escape") {
        selectProviderFromWizard("skip");
        return;
      }
      if (key.name === "up") {
        setProviderSetupSelection((s) => (s + opts.length - 1) % opts.length);
        setProviderSetupError(null);
        return;
      }
      if (key.name === "down" || key.name === "tab") {
        setProviderSetupSelection((s) => (s + 1) % opts.length);
        setProviderSetupError(null);
        return;
      }
      if (key.name === "return") {
        const chosen = opts[providerSetupSelection];
        if (!chosen) return;
        if (!chosen.selectable) {
          setProviderSetupError(chosen.hint ?? "This option isn't ready. Choose another or Skip.");
          return;
        }
        selectProviderFromWizard(chosen.id);
        return;
      }
      return;
    }

    // step === "model"  (ollama)
    if (providerSetupStep === "model") {
      if (key.name === "escape" || (key.name === "tab" && key.shift)) {
        if (modelPickerFromCommand) {
          setModelPickerFromCommand(false);
          setMode("dashboard");
        } else {
          setProviderSetupStep("provider");
          setProviderSetupError(null);
        }
        return;
      }
      if (key.name === "up") {
        setModelSetupSelection((s) => (s + ollamaModels.length - 1) % Math.max(1, ollamaModels.length));
        return;
      }
      if (key.name === "down" || key.name === "tab") {
        setModelSetupSelection((s) => (s + 1) % Math.max(1, ollamaModels.length));
        return;
      }
      if (key.name === "return") {
        const m = ollamaModels[modelSetupSelection];
        if (m) selectModelFromWizard(m.name);
        return;
      }
      return;
    }

    // step === "copilot-model"
    if (providerSetupStep === "copilot-model") {
      if (key.name === "escape" || (key.name === "tab" && key.shift)) {
        if (modelPickerFromCommand) {
          setModelPickerFromCommand(false);
          setMode("dashboard");
        } else {
          setProviderSetupStep("provider");
          setProviderSetupError(null);
        }
        return;
      }
      if (key.name === "up") {
        setCopilotModelSetupSelection((s) => (s + COPILOT_MODELS.length - 1) % COPILOT_MODELS.length);
        return;
      }
      if (key.name === "down" || key.name === "tab") {
        setCopilotModelSetupSelection((s) => (s + 1) % COPILOT_MODELS.length);
        return;
      }
      if (key.name === "return") {
        const m = COPILOT_MODELS[copilotModelSetupSelection];
        if (m) selectCopilotModelFromWizard(m.id);
        return;
      }
      return;
    }
  }

  // -------- end Provider Setup Wizard --------

  function installFromDashboard() {
    if (!runnerToken || !runnerToken.startsWith("sbr_")) {
      setServiceMessage(normalizeDisplayText("A runner token is required before installing auto-start. Press k first."));
      return;
    }

    const result = installAutostartService({
      scriptPath,
      env: {
        ...process.env,
        SPACEBOT_RUNNER_TOKEN: runnerToken,
      },
    });
    setAutostartStatus(result.status);
    setServiceMessage(normalizeDisplayText(result.detail));
    appendLogLines([result.detail]);
    writeAutostartPreference({
      suppressServicePrompt: false,
      updatedAt: new Date().toISOString(),
    });
  }

  async function negotiateToken() {
    if (tokenNegotiating) return;
    setManualOpenUrl("");
    setTokenNegotiating(true);
    setRunnerState("Opening browser to authenticate and negotiate a runner token...");

    const result = await negotiateRunnerTokenViaBrowser({
      apiUrl,
      displayName,
    });

    setTokenNegotiating(false);

    if (!result.ok || !result.token) {
      const message = result.error || "Token negotiation failed.";
      setRunnerState(clipForUi(message, 120));
      appendLogLines([message]);
      if (result.manualOpenRecommended && result.browserUrl) {
        setManualOpenUrl(result.browserUrl);
        appendLogLines([`Open manually: ${result.browserUrl}`]);
      }
      return;
    }

    setManualOpenUrl("");
    setRunnerToken(result.token);
    setRunnerState("Runner token negotiated successfully. Starting runner...");
    appendLogLines(["Runner token negotiated from production session."]);
    startRunnerChild(result.token);
  }

  useEffect(() => {
    if (mode === "dashboard" && !bootedDashboardRef.current) {
      bootedDashboardRef.current = true;
      startRunnerChild();
    }

    if (mode === "dashboard") {
      setChatMode(true);
    }

    return () => {
      stopRunnerChild();
    };
  }, [mode]);

  useKeyboard((key) => {
    if (key.repeated) return;

    if (key.ctrl && key.name === "c") {
      requestExit();
      return;
    }

    // Conversation scrolling — works in any mode
    if (mode === "dashboard") {
      if (key.name === "pageup") {
        setChatScrollOffset((o) => o + 5);
        return;
      }
      if (key.name === "pagedown") {
        setChatScrollOffset((o) => Math.max(0, o - 5));
        return;
      }
      if (key.shift && key.name === "up") {
        setChatScrollOffset((o) => o + 1);
        return;
      }
      if (key.shift && key.name === "down") {
        setChatScrollOffset((o) => Math.max(0, o - 1));
        return;
      }
      if (key.name === "home" && key.ctrl) {
        setChatScrollOffset(99999);
        return;
      }
      if (key.name === "end" && key.ctrl) {
        setChatScrollOffset(0);
        return;
      }
    }

    if (mode === "prompt") {
      if (key.name === "up") {
        setPromptSelection((current) => (current + promptOptions.length - 1) % promptOptions.length);
        return;
      }

      if (key.name === "down" || key.name === "tab") {
        setPromptSelection((current) => (current + 1) % promptOptions.length);
        return;
      }

      if (key.name === "escape") {
        // Esc = skip autostart
        applyPromptChoice("skip");
        return;
      }

      if (key.name === "return") {
        applyPromptChoice(promptOptions[promptSelection]?.id ?? "skip");
        return;
      }
    }

    if (mode === "provider-setup") {
      handleProviderSetupKey(key);
      return;
    }

    if (mode === "permission-setup") {
      handlePermissionSetupKey(key);
      return;
    }

    // Chat mode input handling
    if (chatMode) {
      if (key.name === "escape") {
        setChatMode(false);
        return;
      }

      if (key.name === "return") {
        if (chatInput.trim()) {
          void handleChatCommand(chatInput);
        }
        return;
      }

      if (key.name === "backspace") {
        setChatInput((prev) => prev.slice(0, -1));
        return;
      }

      // Tab autocomplete for slash commands
      if (key.name === "tab" && chatInput.startsWith("/")) {
        // Only autocomplete the command token (before any space)
        const spaceIdx = chatInput.indexOf(" ");
        const partial = spaceIdx === -1 ? chatInput : chatInput.slice(0, spaceIdx);
        const matches = SLASH_COMMANDS.filter((c) => c.cmd.startsWith(partial) && c.cmd !== partial);
        if (matches.length === 1) {
          // Unique match — complete it, appending a space if it takes args
          const completed = matches[0]!.cmd + (matches[0]!.args ? " " : "");
          setChatInput(completed);
        } else if (matches.length > 1) {
          // Find longest common prefix among all matches
          let prefix = matches[0]!.cmd;
          for (const m of matches.slice(1)) {
            let i = 0;
            while (i < prefix.length && i < m.cmd.length && prefix[i] === m.cmd[i]) i++;
            prefix = prefix.slice(0, i);
          }
          if (prefix.length > partial.length) setChatInput(prefix);
        }
        return;
      }

      // Basic text input (limited to printable characters)
      if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
        const maxInput = Math.max(32, terminalSize.width - 26);
        setChatInput((prev) => (prev.length < maxInput ? prev + key.sequence : prev));
      }
      return;
    }

    // Normal mode input handling
    if (mode === "dashboard" && key.sequence === "/") {
      setChatMode(true);
      setChatInput("/");
      return;
    }

    if (key.name === "q") {
      requestExit();
      return;
    }

    if (key.name === "r" && !childRunning) {
      startRunnerChild();
      return;
    }

    if (key.name === "k") {
      void negotiateToken();
      return;
    }

    if (key.name === "c" && manualOpenUrl) {
      const copied = copyTextToClipboard(manualOpenUrl);
      if (copied.ok) {
        setRunnerState("Manual negotiation URL copied to clipboard.");
        appendLogLines(["Manual negotiation URL copied to clipboard."]);
      } else {
        const message = copied.error || "Clipboard copy failed.";
        setRunnerState(clipForUi(message, 120));
        appendLogLines([`Clipboard copy failed: ${message}`]);
      }
      return;
    }

    if (key.name === "i" && !autostartStatus.installed) {
      installFromDashboard();
      return;
    }

    // Toggle panels with Tab or Ctrl+P
    if ((key.name === "tab" || (key.ctrl && key.name === "p")) && mode === "dashboard") {
      setPanelsVisible((prev) => !prev);
      return;
    }

  });

  const renderWidth = Math.max(44, terminalSize.width ?? 120);
  // Reserve one row of headroom: rendering N lines into an N-row terminal
  // causes the final newline/cursor advance to push the last line below the
  // viewport (making it scrollable). Using rows-1 keeps everything visible.
  const renderHeight = Math.max(14, (terminalSize.height ?? 36) - 1);

  // Build the unified status bar (one-line ephemeral + persistent hint)
  const buildStatusBar = (): StyledLine => {
    if (childRunning && disconnectAlert) {
      return { tone: "error", text: fitLine(`🚨 ${disconnectAlert}`, renderWidth) };
    }
    if (statusFlash) {
      return { tone: statusFlash.tone, text: fitLine(statusFlash.text, renderWidth) };
    }
    if (exitConfirmPending) {
      const confirmMsg = autostartStatus.installed
        ? "⚠  Press Ctrl+C again to exit · service keeps running"
        : "⚠  Press Ctrl+C again to exit · runner will stop";
      return { tone: "warning", text: fitLine(confirmMsg, renderWidth) };
    }
    const hints = chatMode
      ? "↵ send · esc focus · pgup/pgdn scroll · tab panels · ctrl+c×2 exit · /help"
      : "/ chat · pgup/pgdn scroll · r restart · k token · i autostart · tab panels · ctrl+c×2 exit";
    return { tone: "muted", text: fitLine(hints, renderWidth) };
  };

  // Compact one-line agent status badges (always shown in bottom strip)
  const buildAgentStrip = (): StyledLine => {
    const socketBadge =
      socketState === "connected"
        ? "🟢 WS"
        : socketState === "connecting"
          ? "🟡 WS"
          : socketState === "reconnecting"
            ? "🟠 WS"
            : "🔴 WS";

    const parts = [
      childRunning ? "🟢 Runner" : "🔴 Offline",
      socketBadge,
      runnerToken.startsWith("sbr_") ? "🔐 Auth" : "🔓 No Auth",
    ];

    const serviceKindCompact = autostartStatus.installKind === "systemd-user"
      ? "systemd"
      : autostartStatus.installKind === "launch-agent"
        ? "launchd"
        : "startup";
    const serviceBadge = !autostartStatus.installed
      ? `⚠ ${serviceKindCompact} off`
      : autostartStatus.running === true
        ? `🟢 ${serviceKindCompact} on`
        : autostartStatus.running === false
          ? `🟡 ${serviceKindCompact} idle`
          : `🟢 ${serviceKindCompact} installed`;
    parts.push(serviceBadge);

    if (childRunning && disconnectAlert) {
      parts.unshift("🚨 CONNECTION LOST");
    }

    // Active provider badge
    if (activeProvider === "ollama") {
      parts.push(activeOllamaConfig?.model ? `🤖 ${activeOllamaConfig.model}` : "🤖 Ollama (no model)");
    } else if (activeProvider === "copilot") {
      const c = copilotAvailability;
      const ready = c && (c.copilotCli || (c.ghCopilot && c.ghAuthed));
      const m = (activeCopilotConfig ?? getCopilotConfig())?.model ?? DEFAULT_COPILOT_MODEL;
      parts.push(ready ? `🐙 ${m}` : "🐙 Copilot (setup needed)");
    } else {
      parts.push("⚙ No Provider");
    }

    // Availability badges (small)
    parts.push(ollamaRunning ? "✨ Ollama" : "❌ Ollama");
    if (copilotAvailability) {
      const c = copilotAvailability;
      const ok = c.copilotCli || (c.ghCopilot && c.ghAuthed);
      parts.push(ok ? "✨ Copilot" : "❌ Copilot");
    }

    return { tone: "info", text: fitLine(parts.join("  ·  "), renderWidth) };
  };

  /** One-line status used inside the INPUT panel describing the active provider. */
  const buildInputStatus = (): string => {
    if (chatBusy) return `${getSpinner(spinnerTick)} thinking...`;
    if (!activeProvider) return "no provider · /providers to choose";
    if (activeProvider === "ollama") {
      const cfg = activeOllamaConfig ?? getOllamaConfig();
      if (!ollamaRunning) return "ollama offline · /provider copilot to switch";
      return cfg?.model ? `ollama · ${cfg.model}` : "ollama · /models then /connect";
    }
    // copilot
    const c = copilotAvailability;
    if (!c) return "copilot · detecting...";
    const model = (activeCopilotConfig ?? getCopilotConfig())?.model ?? DEFAULT_COPILOT_MODEL;
    if (c.copilotCli) return `copilot · ${model}`;
    if (c.ghCopilot && c.ghAuthed) return `copilot · ${model} · gh extension`;
    if (c.ghCopilot) return "copilot · run `gh auth login`";
    return "copilot · CLI not installed";
  };

  /** Returns a dimmed autocomplete hint for the current chatInput, or empty string. */
  const buildTabHint = (): string => {
    if (!chatMode || !chatInput.startsWith("/")) return "";
    const spaceIdx = chatInput.indexOf(" ");
    if (spaceIdx !== -1) {
      // Already has a space — show args hint if the command matches
      const token = chatInput.slice(0, spaceIdx);
      const def = SLASH_COMMANDS.find((c) => c.cmd === token);
      return def?.args ? def.args : "";
    }
    const matches = SLASH_COMMANDS.filter((c) => c.cmd.startsWith(chatInput) && c.cmd !== chatInput);
    if (matches.length === 1) {
      const rest = matches[0]!.cmd.slice(chatInput.length);
      return rest + (matches[0]!.args ? ` ${matches[0]!.args}` : "");
    }
    if (matches.length > 1) {
      // Show only a short list to avoid overflowing the input row.
      const preview = matches.slice(0, 4).map((m) => m.cmd).join("  ");
      const extra = matches.length - 4;
      return extra > 0 ? `[${preview}  +${extra}]` : `[${preview}]`;
    }
    return "";
  };

  const buildScreenLines = (): StyledLine[] => {
    if (renderWidth < 44 || renderHeight < 14) {
      return [
        { tone: "warning", text: "Terminal too small for SpaceBot TUI." },
        { tone: "info", text: "Increase terminal size or reduce font zoom." },
      ];
    }

    // Brand logo (3-line ASCII) — square bot helmet matching the bot's Discord avatar.
    // Width ≈ 2× rows so it reads as a square given terminal cells are ~2:1 tall.
    // Total height matches the previous bordered header (4 lines incl. spacer) so layout math is unchanged.
    // Only the two top-corner eye glyphs animate. When connected the bot blinks
    // at randomized intervals and occasionally winks (see eyeBlink state).
    // While waiting on a response (chatBusy), the eyes squint instead.
    const openEye = "▀";
    const closedEye = "─";
    const squintEye = "_";
    let leftEye = openEye;
    let rightEye = openEye;
    if (childRunning) {
      if (chatBusy) {
        leftEye = squintEye;
        rightEye = squintEye;
      } else if (eyeBlink === "both") {
        leftEye = closedEye;
        rightEye = closedEye;
      } else if (eyeBlink === "left") {
        leftEye = closedEye;
      } else if (eyeBlink === "right") {
        rightEye = closedEye;
      }
    }
    const logoRows = [
      " ╭──────╮ ",
      ` │ ${leftEye}██${rightEye} │ `,
      " ╰──────╯ ",
    ];
    const subtitleRows = panelsVisible
      ? ["   ✦  SPACEBOT", "   Local Agent Runner", ""]
      : ["   ✦  SPACEBOT", "   Chat Mode", ""];
    const logoTones: Array<keyof typeof THEME> = ["primary", "secondary", "accent2"];
    const subTones: Array<keyof typeof THEME> = ["title", "heading", "muted"];
    const buildLogoHeader = (): StyledLine[] => {
      const out: StyledLine[] = [];
      for (let i = 0; i < 3; i++) {
        const left = logoRows[i] ?? "";
        const right = subtitleRows[i] ?? "";
        const totalLen = left.length + right.length;
        const padLen = Math.max(0, renderWidth - totalLen);
        out.push({
          tone: logoTones[i]!,
          text: `${left}${right}${repeatChar(" ", padLen)}`,
          segments: [
            { tone: logoTones[i]!, text: left },
            { tone: subTones[i]!, text: right },
            { tone: "muted", text: repeatChar(" ", padLen) },
          ],
        });
      }
      out.push({ tone: "muted", text: "" });
      return out;
    };

    // Ensure the bottom conversation/input stack is always visible on short
    // terminals (for example with large font sizes).
    const MIN_HEIGHT_FOR_FULL_DASHBOARD = 40;
    const forceCompactDashboard = mode === "dashboard" && renderHeight < MIN_HEIGHT_FOR_FULL_DASHBOARD;

    if (mode === "prompt") {
      const promptRows: Array<{ tone: keyof typeof THEME; text: string }> = [
        { tone: "info", text: "Autostart is recommended but optional — you can install it later from the dashboard." },
        { tone: "value", text: serviceMessage },
        { tone: "muted", text: "↑/↓ or Tab to move · Enter to choose · Esc to skip" },
        ...promptOptions.flatMap((option, idx) => {
          const active = idx === promptSelection;
          return [
            {
              tone: (active ? "secondary" : "value") as keyof typeof THEME,
              text: `${active ? "❯" : " "} ${option.title}`,
            },
            {
              tone: "muted" as keyof typeof THEME,
              text: `  ${option.description}`,
            },
          ];
        }),
      ];

      const lines: StyledLine[] = [
        ...buildLogoHeader(),
        ...createPanel("AUTOSTART · RECOMMENDED (OPTIONAL)", promptRows, renderWidth),
      ];

      while (lines.length < renderHeight) {
        lines.push({ tone: "muted", text: "" });
      }
      return lines.slice(0, renderHeight);
    }

    if (mode === "permission-setup") {
      const opts = buildPermissionOptions();
      const headerLines: StyledLine[] = buildLogoHeader();

      // Confirmation overlay for risky modes
      if (permissionSetupConfirm) {
        const isRoot = permissionSetupConfirm === "root";
        const rows: Array<{ tone: keyof typeof THEME; text: string }> = [];
        if (isRoot) {
          rows.push({ tone: "error", text: "════════════════════════════════════════════════════════════" });
          rows.push({ tone: "error", text: "⚠️  ROOT FILESYSTEM ACCESS — VERY HIGH RISK ⚠️" });
          rows.push({ tone: "error", text: "════════════════════════════════════════════════════════════" });
          rows.push({ tone: "muted", text: "" });
          rows.push({ tone: "warning", text: "You are about to grant the runner permission to execute commands" });
          rows.push({ tone: "warning", text: "ANYWHERE on this machine, including /etc, /usr, /var, and so on." });
          rows.push({ tone: "muted", text: "" });
          rows.push({ tone: "error", text: "  • A compromised SpaceBot account can delete or alter system files." });
          rows.push({ tone: "error", text: "  • A buggy prompt could damage your OS install irrecoverably." });
          rows.push({ tone: "error", text: "  • Secrets in /etc, /root, browser profiles, etc. are all reachable." });
          rows.push({ tone: "muted", text: "" });
          rows.push({ tone: "warning", text: "Only continue on machines you fully own and are willing to wipe." });
        } else {
          rows.push({ tone: "warning", text: "⚠️  Home directory access" });
          rows.push({ tone: "muted", text: "" });
          rows.push({ tone: "warning", text: `The runner will be allowed to read and write anywhere under ${resolvePathsForMode("home")[0]}.` });
          rows.push({ tone: "muted", text: "" });
          rows.push({ tone: "info", text: "  • This includes your projects, dotfiles, SSH keys, browser profiles, and credentials." });
          rows.push({ tone: "info", text: "  • Safer alternative: the Sandbox (~/spacebot) scope." });
        }
        rows.push({ tone: "muted", text: "" });
        rows.push({ tone: "secondary", text: "Press  Y  or  Enter  to confirm" });
        rows.push({ tone: "muted", text: "Press  N  ·  Esc  ·  Backspace  to go back" });

        const lines: StyledLine[] = [
          ...headerLines,
          ...createPanel(isRoot ? "CONFIRM · ROOT ACCESS" : "CONFIRM · HOME ACCESS", rows, renderWidth),
        ];
        while (lines.length < renderHeight) lines.push({ tone: "muted", text: "" });
        return lines.slice(0, renderHeight);
      }

      const rows: Array<{ tone: keyof typeof THEME; text: string }> = [
        { tone: "info", text: "Where is the runner allowed to execute jobs?" },
        { tone: "muted", text: "↑/↓ or Tab to move · Enter to choose · Esc to skip for now" },
        { tone: "muted", text: "" },
      ];

      opts.forEach((option, idx) => {
        const active = idx === permissionSetupSelection;
        const marker = active ? "❯" : " ";
        rows.push({
          tone: active ? "secondary" : "value",
          text: `${marker} ${option.title}`,
        });
        rows.push({ tone: option.summaryTone, text: `    ${option.summary}` });
        if (active && option.hint) {
          rows.push({ tone: "muted", text: `    ${option.hint}` });
        }
      });

      if (permissionSetupMessage) {
        rows.push({ tone: "muted", text: "" });
        rows.push({ tone: "error", text: permissionSetupMessage });
      }

      const lines: StyledLine[] = [
        ...headerLines,
        ...createPanel("RUNNER PERMISSIONS · ALLOWED PATHS", rows, renderWidth),
      ];
      while (lines.length < renderHeight) lines.push({ tone: "muted", text: "" });
      return lines.slice(0, renderHeight);
    }

    if (mode === "provider-setup") {
      const opts = buildProviderOptions();
      const headerLines: StyledLine[] = buildLogoHeader();

      if (providerSetupStep === "provider") {
        const rows: Array<{ tone: keyof typeof THEME; text: string }> = [
          { tone: "info", text: "Pick how SpaceBot should answer your prompts." },
          { tone: "muted", text: "↑/↓ or Tab to move · Enter to choose · Esc to skip" },
          { tone: "muted", text: "" },
        ];
        opts.forEach((option, idx) => {
          const active = idx === providerSetupSelection;
          const marker = active ? "❯" : " ";
          const titleTone: keyof typeof THEME = !option.selectable
            ? "muted"
            : active
              ? "secondary"
              : "value";
          rows.push({
            tone: titleTone,
            text: `${marker} ${option.title}`,
          });
          rows.push({
            tone: option.statusTone,
            text: `    ${option.status}`,
          });
          if (active && option.hint) {
            rows.push({ tone: "muted", text: `    ${option.hint}` });
          }
        });
        if (providerSetupError) {
          rows.push({ tone: "muted", text: "" });
          rows.push({ tone: "error", text: providerSetupError });
        }

        const lines: StyledLine[] = [
          ...headerLines,
          ...createPanel("AI PROVIDER · STEP 1 OF 2", rows, renderWidth),
        ];
        while (lines.length < renderHeight) lines.push({ tone: "muted", text: "" });
        return lines.slice(0, renderHeight);
      }

      // step === "model"  (ollama)
      if (providerSetupStep === "model") {
        const modelRows: Array<{ tone: keyof typeof THEME; text: string }> = [
          { tone: "info", text: "Choose an Ollama model to connect to." },
          { tone: "muted", text: "↑/↓ to move · Enter to connect · Esc/Shift+Tab to go back" },
          { tone: "muted", text: "" },
        ];
        if (ollamaModels.length === 0) {
          modelRows.push({ tone: "warning", text: "No models available. Pull one with `ollama pull <name>`." });
        } else {
          ollamaModels.forEach((m, idx) => {
            const active = idx === modelSetupSelection;
            const marker = active ? "❯" : " ";
            const sizeMb = m.size ? Math.round(m.size / 1024 / 1024) : null;
            const detail = sizeMb ? ` · ${sizeMb} MB` : "";
            modelRows.push({
              tone: active ? "secondary" : "value",
              text: `${marker} ${m.name}${detail}`,
            });
          });
        }

        const ollamaTitle = modelPickerFromCommand
          ? "SELECT OLLAMA MODEL · Enter to switch · Esc to cancel"
          : "AI PROVIDER · STEP 2 OF 2 · OLLAMA MODEL";
        const lines: StyledLine[] = [
          ...headerLines,
          ...createPanel(ollamaTitle, modelRows, renderWidth),
        ];
        while (lines.length < renderHeight) lines.push({ tone: "muted", text: "" });
        return lines.slice(0, renderHeight);
      }

      // step === "copilot-model"
      const c = copilotAvailability;
      const cliLabel = c?.copilotCli
        ? "standalone `copilot` CLI"
        : c?.ghCopilot && c?.ghAuthed
          ? "`gh copilot` extension"
          : "(unavailable)";
      const cmRows: Array<{ tone: keyof typeof THEME; text: string }> = [
        { tone: "info", text: `Choose a Copilot model. Using ${cliLabel}.` },
        { tone: "muted", text: "↑/↓ to move · Enter to connect · Esc/Shift+Tab to go back" },
        { tone: "muted", text: "Cost shown as the GitHub premium-request multiplier per prompt." },
        { tone: "muted", text: "" },
      ];
      COPILOT_MODELS.forEach((m, idx) => {
        const active = idx === copilotModelSetupSelection;
        const marker = active ? "❯" : " ";
        const mult = formatCopilotMultiplier(m.multiplier);
        cmRows.push({
          tone: active ? "secondary" : "value",
          text: `${marker} ${m.id}  ·  ${mult}`,
        });
        cmRows.push({
          tone: "muted",
          text: `    ${m.label}`,
        });
      });

      const copilotTitle = modelPickerFromCommand
        ? "SELECT COPILOT MODEL · Enter to switch · Esc to cancel"
        : "AI PROVIDER · STEP 2 OF 2 · COPILOT MODEL";
      const cmLines: StyledLine[] = [
        ...headerLines,
        ...createPanel(copilotTitle, cmRows, renderWidth),
      ];
      while (cmLines.length < renderHeight) cmLines.push({ tone: "muted", text: "" });
      return cmLines.slice(0, renderHeight);
    }

    // Collapsed layout for chat-focused mode (input stuck to bottom)
    // and automatic fallback when terminal height is limited.
    if (mode === "dashboard" && (!panelsVisible || forceCompactDashboard)) {
      // Bottom stack: agent strip (1) + status bar (1) + input panel (4) = 6 lines reserved
      const inputPanelHeight = 4;
      const reservedForBottom = inputPanelHeight + 2; // input + agent strip + status bar

      // Build rich rows: header + body + spacer between messages
      const chatResponseRows: Array<{ tone: keyof typeof THEME; text: string }> = [];
      for (let i = 0; i < chatMessages.length; i++) {
        const rendered = renderChatMessage(chatMessages[i]!);
        chatResponseRows.push(...rendered);
        if (i < chatMessages.length - 1) {
          chatResponseRows.push({ tone: "muted", text: "" });
        }
      }

      // Chat input panel (compact, 2 content rows + borders)
      // Keep input tail visible and prevent wrapping/clipping on narrow terminals.
      const inputInnerCompact = Math.max(18, renderWidth - 4);
      const statusCompact = buildInputStatus();
      const truncatedStatusCompact = statusCompact.length > inputInnerCompact
        ? statusCompact.slice(0, Math.max(0, inputInnerCompact - 1)) + "…"
        : statusCompact;
      const promptCompact = `${chatMode ? "❯" : "·"} `;
      const cursorCompact = chatMode ? "▏" : "";
      const inputBudgetCompact = Math.max(1, inputInnerCompact - promptCompact.length - cursorCompact.length);
      const visibleInputCompact = chatInput.length > inputBudgetCompact
        ? "…" + chatInput.slice(chatInput.length - (inputBudgetCompact - 1))
        : chatInput;
      const tabHintCompact = buildTabHint();
      const tabHintDecoratedCompact = tabHintCompact ? `  ⇥ ${tabHintCompact}` : "";
      const hintBudgetCompact = Math.max(0, inputInnerCompact - (promptCompact.length + visibleInputCompact.length + cursorCompact.length));
      const visibleTabHintCompact = hintBudgetCompact > 0
        ? (tabHintDecoratedCompact.length > hintBudgetCompact
            ? tabHintDecoratedCompact.slice(0, Math.max(0, hintBudgetCompact - 1)) + "…"
            : tabHintDecoratedCompact)
        : "";
      const chatInputRows: Array<{ tone: keyof typeof THEME; text: string; segments?: Array<{ tone: keyof typeof THEME; text: string }> }> = [
        {
          tone: "muted",
          text: truncatedStatusCompact,
        },
        visibleTabHintCompact
          ? {
              tone: chatMode ? "accent1" : "muted",
              text: "",
              segments: [
                { tone: chatMode ? "accent1" : "muted", text: `${promptCompact}${visibleInputCompact}${cursorCompact}` },
                { tone: "muted", text: visibleTabHintCompact },
              ],
            }
          : {
              tone: chatMode ? "accent1" : "muted",
              text: `${promptCompact}${visibleInputCompact}${cursorCompact}`,
            },
      ];

      // Build header
      const lines: StyledLine[] = buildLogoHeader().slice(0, 3);

      // Calculate conversation panel height: fill everything between header and bottom stack
      const headerHeight = lines.length;
      const conversationPanelHeight = renderHeight - headerHeight - reservedForBottom;
      const conversationContentHeight = Math.max(3, conversationPanelHeight - 2); // minus borders

      const { lines: convoLines } = createScrollablePanel(
        "✦ CONVERSATION",
        chatResponseRows,
        renderWidth,
        conversationContentHeight,
        chatScrollOffset,
      );
      lines.push(...convoLines);

      // Pad to where bottom stack should start (safety net if panel was shorter)
      const bottomStart = renderHeight - reservedForBottom;
      while (lines.length < bottomStart) {
        lines.push({ tone: "muted", text: "" });
      }

      // Bottom stack: agent strip + status bar + input panel
      lines.push(buildAgentStrip());
      lines.push(buildStatusBar());
      lines.push(...createPanel("INPUT", chatInputRows, renderWidth));

      return lines.slice(0, renderHeight);
    }

    // Full layout with all panels — log count is computed AFTER configRows
    // are known so we can guarantee the conversation always has room.

    const statusRows: Array<{ tone: keyof typeof THEME; text: string }> = [
      { tone: childRunning ? "success" : "warning", text: `Session: ${formatStatus(childRunning ? "running" : "stopped", spinnerTick)}` },
      {
        tone: socketState === "connected" ? "success" : socketState === "disconnected" ? "error" : socketState === "reconnecting" ? "error" : "info",
        text: `WebSocket: ${socketState === "connected"
          ? formatStatus("ready")
          : socketState === "disconnected"
            ? "✕ DISCONNECTED - not receiving jobs"
            : socketState === "reconnecting"
              ? `${getSpinner(spinnerTick)} RECONNECTING - jobs may be delayed`
            : `${getSpinner(spinnerTick)} ${socketState === "connecting" ? "Connecting..." : "Reconnecting..."}`}`,
      },
      ...(childRunning && disconnectAlert
        ? [{ tone: "error" as keyof typeof THEME, text: `!!! ${disconnectAlert} !!!` }]
        : []),
      { tone: "value", text: `State: ${runnerState}` },
      { tone: tokenNegotiating ? "info" : "muted", text: tokenNegotiating ? `${getSpinner(spinnerTick)} Negotiating token via browser...` : "Token negotiation idle" },
    ];

    const configRows: Array<{ tone: keyof typeof THEME; text: string }> = [
      { tone: "value", text: buildKeyValueLine("Server", apiUrl) },
      { tone: "value", text: buildKeyValueLine("Runner", displayName) },
      { tone: "value", text: buildKeyValueLine("Host", hostname) },
      {
        tone: runnerToken.startsWith("sbr_") ? "success" : "warning",
        text: buildKeyValueLine("Token", runnerToken.startsWith("sbr_") ? `${runnerToken.slice(0, 8)}... configured` : "missing, use /token"),
      },
      {
        tone: autostartStatus.installed ? "success" : "warning",
        text: buildKeyValueLine(
          formatInstallKind(autostartStatus.installKind),
          autostartStatus.installed
            ? (autostartStatus.running === true
                ? "installed · running"
                : autostartStatus.running === false
                  ? "installed · not running"
                  : "installed")
            : "not installed"
        ),
      },
      { tone: "muted", text: buildKeyValueLine("Paths", effectiveAllowedPaths.length > 0
        ? `${permissionConfig ? describePermissionMode(permissionConfig.mode) + " · " : ""}${effectiveAllowedPaths.join(", ")}`
        : "⚠  none configured — runner will reject every job. /permissions to set.") },
      ...(manualOpenUrl
        ? [
          { tone: "warning" as keyof typeof THEME, text: "Manual browser fallback required:" },
          { tone: "info" as keyof typeof THEME, text: manualOpenUrl },
        ]
        : []),
    ];

    // Calculate available height for activity log dynamically.
    //   header (4) + status panel (rows + 2 borders + 1 spacer)
    //   + config panel (rows + 2 borders + 1 spacer)
    //   + log panel borders+spacer (3) + convo panel borders (2)
    //   + bottom stack (6) + min convo content (6)
    const headerHeight = 4;
    const statusPanelHeight = statusRows.length + 2 + 1;
    const configPanelHeight = configRows.length + 2 + 1;
    const logPanelOverhead = 3; // 2 borders + 1 spacer below
    const convoPanelBorders = 2;
    const bottomStackHeight = 6;
    const minConvoContent = 6;
    const fixedOverhead =
      headerHeight + statusPanelHeight + configPanelHeight + logPanelOverhead + convoPanelBorders + bottomStackHeight + minConvoContent;
    const availableForLog = renderHeight - fixedOverhead;
    const logCount = Math.max(2, Math.min(14, availableForLog));

    const logRows = logs.slice(-logCount).map((line) => {
      const lower = line.toLowerCase();
      let tone: keyof typeof THEME = "value";
      if (lower.includes("error") || lower.includes("failed")) tone = "error";
      else if (lower.includes("connected") || lower.includes("authenticated") || lower.includes("success")) tone = "success";
      else if (lower.includes("warn")) tone = "warning";
      return { tone, text: line };
    });

    const chatResponseRows: Array<{ tone: keyof typeof THEME; text: string }> = [];
    for (let i = 0; i < chatMessages.length; i++) {
      const rendered = renderChatMessage(chatMessages[i]!);
      chatResponseRows.push(...rendered);
      if (i < chatMessages.length - 1) {
        chatResponseRows.push({ tone: "muted", text: "" });
      }
    }

    // Panel inner width matches createPanel's logic. Truncate input rows so the
    // INPUT box stays exactly 4 lines tall (top border + 2 content + bottom border)
    // and never wraps below the visible terminal area.
    const inputInner = Math.max(18, renderWidth - 4);
    const statusText = buildInputStatus();
    const truncatedStatus = statusText.length > inputInner ? statusText.slice(0, Math.max(0, inputInner - 1)) + "…" : statusText;
    const prompt = `${chatMode ? "❯" : "·"} `;
    const cursor = chatMode ? "▏" : "";
    const inputBudget = Math.max(1, inputInner - prompt.length - cursor.length);
    // Show the tail so the cursor stays visible when text exceeds the width.
    const visibleInput = chatInput.length > inputBudget ? "…" + chatInput.slice(chatInput.length - (inputBudget - 1)) : chatInput;
    const tabHint = buildTabHint();
    const tabHintDecorated = tabHint ? `  ⇥ ${tabHint}` : "";
    const hintBudget = Math.max(0, inputInner - (prompt.length + visibleInput.length + cursor.length));
    const visibleTabHint = hintBudget > 0
      ? (tabHintDecorated.length > hintBudget
          ? tabHintDecorated.slice(0, Math.max(0, hintBudget - 1)) + "…"
          : tabHintDecorated)
      : "";
    const chatInputRows: Array<{ tone: keyof typeof THEME; text: string; segments?: Array<{ tone: keyof typeof THEME; text: string }> }> = [
      {
        tone: "muted",
        text: truncatedStatus,
      },
      visibleTabHint
        ? {
            tone: chatMode ? "accent1" : "muted",
            text: "",
            segments: [
              { tone: chatMode ? "accent1" : "muted", text: `${prompt}${visibleInput}${cursor}` },
              { tone: "muted", text: visibleTabHint },
            ],
          }
        : {
            tone: chatMode ? "accent1" : "muted",
            text: `${prompt}${visibleInput}${cursor}`,
          },
    ];

    const headerLines: StyledLine[] = buildLogoHeader();

    const topPanels: StyledLine[] = [
      ...createPanel("◉ AGENT STATUS", statusRows, renderWidth),
      { tone: "muted", text: "" },
      ...createPanel("⚙ RUNTIME CONTEXT", configRows, renderWidth),
      { tone: "muted", text: "" },
      ...createPanel("≡ ACTIVITY LOG", logRows, renderWidth),
      { tone: "muted", text: "" },
    ];

    const lines: StyledLine[] = [...headerLines, ...topPanels];

    // Reserve space for bottom stack: agent strip (1) + status bar (1) + input panel (4) = 6 lines
    const inputPanelHeight = 4;
    const reservedForBottom = inputPanelHeight + 2;

    // Allocate remaining space to the conversation panel (with min size)
    const usedSoFar = lines.length;
    const convoPanelHeight = Math.max(5, renderHeight - usedSoFar - reservedForBottom);
    const convoContentHeight = Math.max(3, convoPanelHeight - 2);

    const { lines: convoLines } = createScrollablePanel(
      "✦ CONVERSATION",
      chatResponseRows,
      renderWidth,
      convoContentHeight,
      chatScrollOffset,
    );
    lines.push(...convoLines);

    const bottomStart = renderHeight - reservedForBottom;
    while (lines.length < bottomStart) {
      lines.push({ tone: "muted", text: "" });
    }

    lines.push(buildAgentStrip());
    lines.push(buildStatusBar());
    lines.push(...createPanel("INPUT", chatInputRows, renderWidth));

    return lines.slice(0, renderHeight);
  };

  const screenLines = buildScreenLines();

  return (
    <text wrapMode="char" truncate>
      {screenLines.map((line, index) => {
        const isLast = index >= screenLines.length - 1;
        if (line.segments && line.segments.length > 0) {
          return (
            <React.Fragment key={`${index}-seg`}>
              {line.segments.map((seg, si) => (
                <span key={si} fg={THEME[seg.tone]}>{seg.text}</span>
              ))}
              {!isLast ? <br /> : null}
            </React.Fragment>
          );
        }
        const normalized = line.text;
        return (
          <React.Fragment key={`${index}-${normalized.slice(0, 18)}`}>
            <span fg={THEME[line.tone]}>{normalized}</span>
            {!isLast ? <br /> : null}
          </React.Fragment>
        );
      })}
    </text>
  );
}

export async function startRunnerTui(options: RunnerTuiOptions) {
  const renderer = await createCliRenderer({ exitOnCtrlC: false });
  const root = createRoot(renderer);

  return await new Promise<void>((resolve) => {
    let cleanedUp = false;

    const cleanupTerminal = () => {
      if (cleanedUp) return;
      cleanedUp = true;

      try {
        root.unmount();
      } catch {
        // Best effort root teardown.
      }

      try {
        renderer.destroy();
      } catch {
        // Best effort renderer teardown.
      }

      try {
        process.stdout.write("\u001b[0m\u001b[?25h\u001b[?1000l\u001b[?1002l\u001b[?1003l\u001b[?1006l\u001b[?2004l\r\n");
      } catch {
        // Best effort ANSI state reset.
      }

      process.off("SIGINT", handleSignalExit);
      process.off("SIGTERM", handleSignalExit);
      resolve();
    };

    const handleSignalExit = () => {
      cleanupTerminal();
      process.exit(0);
    };

    const onExit = () => {
      cleanupTerminal();
      process.exit(0);
    };

    process.on("SIGINT", handleSignalExit);
    process.on("SIGTERM", handleSignalExit);

    root.render(<App {...options} onExit={onExit} />);
  });
}