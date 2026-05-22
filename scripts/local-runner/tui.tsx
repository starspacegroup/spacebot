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
  formatBytes,
  type OllamaModel,
} from "./ollama-utils";

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

interface StyledLine {
  tone: keyof typeof THEME;
  text: string;
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

function App({ apiUrl, defaultWorkdir, displayName, hostname, allowedPaths, scriptPath, initialToken, onExit }: AppProps) {
  const initialStatus = useMemo(() => detectAutostartStatus(), []);
  const [autostartStatus, setAutostartStatus] = useState(initialStatus);
  const [promptSelection, setPromptSelection] = useState(0);
  const [mode, setMode] = useState<"prompt" | "dashboard">(
    shouldPromptForAutostart(initialStatus) ? "prompt" : "dashboard",
  );
  const [runnerState, setRunnerState] = useState("Preparing runner process...");
  const [serviceMessage, setServiceMessage] = useState(normalizeDisplayText(initialStatus.detail));
  const [logs, setLogs] = useState<string[]>([
    buildKeyValueLine("API", apiUrl),
    buildKeyValueLine("Runner", displayName),
    buildKeyValueLine("Host", hostname),
    buildKeyValueLine("Workdir", defaultWorkdir),
  ]);
  const [childRunning, setChildRunning] = useState(false);
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
  
  // Chat interface state
  interface ChatMessage {
    type: "user" | "system" | "error" | "success";
    text: string;
  }
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { type: "system", text: "Welcome to SpaceBot Runner. Type /help for available commands." },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatMode, setChatMode] = useState(false); // Toggle chat at bottom

  // Spinner animation loop
  useEffect(() => {
    const interval = setInterval(() => {
      setSpinnerTick((t) => t + 1);
    }, 100);
    return () => clearInterval(interval);
  }, []);

  // Detect Ollama on startup
  useEffect(() => {
    (async () => {
      try {
        const installed = await detectOllamaInstalled();
        setOllamaInstalled(installed);

        if (installed) {
          const running = await detectOllamaRunning();
          setOllamaRunning(running);

          if (running) {
            const models = await getOllamaModels();
            setOllamaModels(models);

            if (models.length > 0 && !getOllamaConfig()) {
              setChatMessages((prev) => [
                ...prev,
                {
                  type: "system",
                  text: `Ollama detected with ${models.length} model(s). Use /models to list or /connect to set up.`,
                },
              ]);
            }
          }
        }
      } catch {
        // Silently fail Ollama detection
      } finally {
        setOllamaDetecting(false);
      }
    })();
  }, []);

  const autostartOptions: PromptOption[] = [
    {
      id: "install",
      title: `Install ${formatInstallKind(autostartStatus.installKind)}`,
      description: "Persist the current SPACEBOT_/RUNNER_ environment so the runner starts automatically.",
    },
    {
      id: "skip",
      title: "Skip for now",
      description: "Start this session without changing startup behavior.",
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
    child.kill("SIGTERM");
  }

  function startRunnerChild(tokenOverride?: string) {
    if (childRef.current) return;
    const effectiveToken = (tokenOverride || runnerToken).trim();

    if (!effectiveToken || !effectiveToken.startsWith("sbr_")) {
      setRunnerState("No runner token configured. Press k to fetch one from the production site.");
      return;
    }

    setRunnerState("Starting headless runner process...");
    const child = spawn(process.execPath, ["run", scriptPath, "--headless"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        SPACEBOT_RUNNER_TOKEN: effectiveToken,
        RUNNER_TUI_CHILD: "1",
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
      setRunnerState(signal
        ? `Runner exited after ${signal}.`
        : `Runner exited with code ${code ?? 0}. Press r to restart.`);
    });
  }

  function handleChatCommand(input: string) {
    const text = input.trim();
    
    // Add user message
    setChatMessages((prev) => [...prev, { type: "user", text }]);
    setChatInput("");

    // Parse command
    if (text === "/help") {
      setChatMessages((prev) => [
        ...prev,
        {
          type: "system",
          text: "/help - Show this message\n/models - List Ollama models\n/connect <model> - Connect to a model\n/config - Show current setup\n/clear - Clear chat",
        },
      ]);
    } else if (text === "/models") {
      if (!ollamaRunning) {
        setChatMessages((prev) => [...prev, { type: "error", text: "Ollama is not running" }]);
      } else if (ollamaModels.length === 0) {
        setChatMessages((prev) => [...prev, { type: "error", text: "No models found in Ollama" }]);
      } else {
        const modelList = ollamaModels
          .map((m) => `  • ${m.name} (${formatBytes(m.size)})`)
          .join("\n");
        setChatMessages((prev) => [...prev, { type: "system", text: `Available models:\n${modelList}` }]);
      }
    } else if (text.startsWith("/connect ")) {
      const model = text.slice(9).trim();
      if (!model) {
        setChatMessages((prev) => [...prev, { type: "error", text: "Usage: /connect <model>" }]);
      } else if (!ollamaRunning) {
        setChatMessages((prev) => [...prev, { type: "error", text: "Ollama is not running" }]);
      } else {
        storeOllamaConfig({ host: "localhost", port: 11434, model });
        setChatMessages((prev) => [...prev, { type: "success", text: `Connected to model: ${model}` }]);
      }
    } else if (text === "/config") {
      const config = getOllamaConfig();
      if (config) {
        setChatMessages((prev) => [
          ...prev,
          {
            type: "system",
            text: `Ollama Config:\nHost: ${config.host}\nPort: ${config.port}\nModel: ${config.model}`,
          },
        ]);
      } else {
        setChatMessages((prev) => [...prev, { type: "error", text: "No Ollama config set up yet" }]);
      }
    } else if (text === "/clear") {
      setChatMessages([]);
    } else if (text.startsWith("/")) {
      setChatMessages((prev) => [...prev, { type: "error", text: `Unknown command: ${text}. Type /help for help.` }]);
    } else {
      setChatMessages((prev) => [...prev, { type: "system", text: "Commands start with /. Type /help for available commands." }]);
    }
  }

  function applyPromptChoice(choice: PromptChoice) {
    if (choice === "install") {
      if (!runnerToken || !runnerToken.startsWith("sbr_")) {
        setServiceMessage(normalizeDisplayText("A runner token is required before installing auto-start. Press k first."));
        setMode("dashboard");
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

    setMode("dashboard");
  }

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

    return () => {
      stopRunnerChild();
    };
  }, [mode]);

  useKeyboard((key) => {
    if (key.repeated) return;

    // Chat mode input handling
    if (chatMode) {
      if (key.ctrl && key.name === "c") {
        setChatMode(false);
        return;
      }

      if (key.name === "escape") {
        setChatMode(false);
        return;
      }

      if (key.name === "return") {
        if (chatInput.trim()) {
          handleChatCommand(chatInput);
        }
        return;
      }

      if (key.name === "backspace") {
        setChatInput((prev) => prev.slice(0, -1));
        return;
      }

      // Basic text input (limited to printable characters)
      if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
        setChatInput((prev) => (prev.length < 80 ? prev + key.sequence : prev));
      }
      return;
    }

    // Normal mode input handling
    if (key.ctrl && key.name === "c") {
      stopRunnerChild();
      onExit();
      return;
    }

    if (mode === "prompt") {
      if (key.name === "up") {
        setPromptSelection((current) => (current + promptOptions.length - 1) % promptOptions.length);
        return;
      }

      if (key.name === "down") {
        setPromptSelection((current) => (current + 1) % promptOptions.length);
        return;
      }

      if (key.name === "return") {
        applyPromptChoice(promptOptions[promptSelection]?.id ?? "skip");
        return;
      }
    }

    if (key.name === "q") {
      stopRunnerChild();
      onExit();
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

    // Chat toggle
    if (key.name === "t" && ollamaRunning) {
      setChatMode(true);
      return;
    }
  });

  const autostartLine = buildKeyValueLine(
    formatInstallKind(autostartStatus.installKind),
    autostartStatus.installed ? "installed" : "not installed",
  );
  const allowedPathText = allowedPaths.length > 0 ? allowedPaths.join(", ") : "Any path accepted";
  const noServiceLine = `No ${formatInstallKind(autostartStatus.installKind)} detected at ${autostartStatus.serviceFile}`;
  const tokenStateLine = buildKeyValueLine(
    "Runner token",
    runnerToken.startsWith("sbr_") ? `${runnerToken.slice(0, 8)}... configured` : "missing",
  );
  const statusLabel = childRunning ? "Runner online" : "Runner stopped";
  
  // Status icons for better visual feedback
  const statusIcon = childRunning ? "✓" : "○";
  const tokenIcon = runnerToken.startsWith("sbr_") ? "✓" : "✗";
  const autostartIcon = autostartStatus.installed ? "✓" : "○";

  const topLines = [
    `State: ${runnerState}`,
    `Session: ${statusLabel}`,
    buildKeyValueLine("Server", apiUrl),
    buildKeyValueLine("Runner", displayName),
    buildKeyValueLine("Host", hostname),
    buildKeyValueLine("Default workdir", defaultWorkdir),
    tokenStateLine,
    buildKeyValueLine("Allowed paths", allowedPathText),
    autostartLine,
  ];

  const middleLines = mode === "prompt"
    ? [
      noServiceLine,
      serviceMessage,
      "Use Up/Down to choose, Enter to continue.",
      ...promptOptions.flatMap((option, index) => {
        const active = index === promptSelection;
        return [
          `${active ? ">" : " "} ${option.title}`,
          `   ${option.description}`,
        ];
      }),
    ]
    : [
      serviceMessage,
      "Controls: q quit  r restart  k get token  i install autostart",
      childRunning ? "Runner child is active." : "Runner child is stopped.",
      ...(tokenNegotiating ? ["Negotiation in progress. Complete the browser step to continue."] : []),
      ...(manualOpenUrl
        ? [
          "Manual Browser Fallback:",
          "Could not launch your browser automatically.",
          "Open this URL manually, then complete login/consent.",
          manualOpenUrl,
          "Press c to copy this URL to your clipboard.",
        ]
        : []),
    ];

  const recentLines = logs.map((line) => line);

  // Mobile-responsive design
  const buildScreenLines = (): StyledLine[] => {
    // Chat mode takes over the whole screen
    if (chatMode) {
      return [
        { tone: "primary", text: "╔════════════════════════════════════════════════════════════════╗" },
        { tone: "title", text: "║            💬 OLLAMA ASSISTANT CHAT                             ║" },
        { tone: "primary", text: "╠════════════════════════════════════════════════════════════════╣" },
        ...chatMessages.slice(-15).map((msg) => {
          const prefix = msg.type === "user" ? "You: " : `${msg.type}: `;
          return {
            tone: (msg.type === "error" ? "error" : msg.type === "success" ? "success" : "value") as keyof typeof THEME,
            text: `║  ${clipForUi(`${prefix}${msg.text}`, 60).padEnd(60)}  ║`,
          };
        }),
        { tone: "primary", text: "╠════════════════════════════════════════════════════════════════╣" },
        { tone: "info", text: `║  Input: ${clipForUi(chatInput, 50).padEnd(50)}  ║` },
        { tone: "muted", text: "║  (ESC to close, type /help for commands)                        ║" },
        { tone: "primary", text: "╚════════════════════════════════════════════════════════════════╝" },
      ];
    }

    // When in prompt mode, show a big modal-like autostart setup
    if (mode === "prompt") {
      return [
        { tone: "muted", text: "" },
        { tone: "muted", text: "" },
        { tone: "primary", text: "╔════════════════════════════════════════════════════════════════╗" },
        { tone: "primary", text: "║                                                                ║" },
        { tone: "title", text: "║              ⚙️  AUTOSTART CONFIGURATION REQUIRED              ║" },
        { tone: "primary", text: "║                                                                ║" },
        { tone: "primary", text: "╠════════════════════════════════════════════════════════════════╣" },
        { tone: "muted", text: "║                                                                ║" },
        { tone: "info", text: `║  ${clipForUi(serviceMessage, 60).padEnd(60)}  ║` },
        { tone: "muted", text: "║                                                                ║" },
        { tone: "warning", text: "║  Would you like to enable automatic startup on this machine?  ║" },
        { tone: "muted", text: "║                                                                ║" },
        { tone: "primary", text: "╠════════════════════════════════════════════════════════════════╣" },
        { tone: "muted", text: "║                                                                ║" },
        ...promptOptions.map((option, idx) => {
          const isActive = idx === promptSelection;
          const marker = isActive ? "❯❯" : "  ";
          const bg = isActive ? "█" : " ";
          const title = `${marker} ${clipForUi(option.title, 56)}`.padEnd(60);
          return {
            tone: (isActive ? "secondary" : "value") as keyof typeof THEME,
            text: `║${bg}${title}${bg}║`,
            highlight: isActive,
          };
        }),
        ...promptOptions.flatMap((option, idx) => {
          const isActive = idx === promptSelection;
          if (!isActive) return [];
          const lines: StyledLine[] = [
            { tone: "muted", text: "║                                                                ║" },
            { tone: "muted", text: `║  ▪ ${clipForUi(option.description, 54).padEnd(54)}  ║` },
            { tone: "muted", text: "║                                                                ║" },
          ];
          return lines;
        }),
        { tone: "primary", text: "╠════════════════════════════════════════════════════════════════╣" },
        { tone: "muted", text: "║                                                                ║" },
        { tone: "info", text: "║  Use  ↑  ↓  arrow keys to navigate  •  Press  ENTER  to select ║" },
        { tone: "muted", text: "║                                                                ║" },
        { tone: "primary", text: "╚════════════════════════════════════════════════════════════════╝" },
        { tone: "muted", text: "" },
        { tone: "muted", text: "" },
      ];
    }

    // Dashboard mode - compact responsive design
    return [
      { tone: "primary", text: "" },
      { tone: "primary", text: "╔════════════════════════════════════════════════════════════════╗" },
      { tone: "title", text: "║          ⚡  STARSPACE LOCAL RUNNER  •  Status Monitor         ║" },
      { tone: "primary", text: "╚════════════════════════════════════════════════════════════════╝" },
      { tone: "muted", text: "" },
      
      // Status
      { tone: "primary", text: "┌─ SESSION STATUS ─────────────────────────────────────────────────┐" },
      { tone: "value", text: `│  ${clipForUi(formatStatus(childRunning ? "running" : "stopped", spinnerTick), 62).padEnd(62)}  │` },
      { tone: "value", text: `│  State:  ${clipForUi(runnerState, 52).padEnd(52)}  │` },
      { tone: "primary", text: "└──────────────────────────────────────────────────────────────────┘" },
      { tone: "muted", text: "" },
      
      // Configuration (compact)
      { tone: "primary", text: "┌─ CONFIGURATION ──────────────────────────────────────────────────┐" },
      { tone: "value", text: `│  Server:  ${clipForUi(apiUrl, 50).padEnd(50)}  │` },
      { tone: "value", text: `│  Runner:  ${clipForUi(displayName, 50).padEnd(50)}  │` },
      { tone: "value", text: `│  Host:    ${clipForUi(hostname, 50).padEnd(50)}  │` },
      {
        tone: runnerToken.startsWith("sbr_") ? "success" : "warning",
        text: `│  Token:   ${clipForUi(runnerToken.startsWith("sbr_") ? `${runnerToken.slice(0, 8)}... ✓` : "Missing (Press k to get)", 50).padEnd(50)}  │`
      },
      { tone: "primary", text: "└──────────────────────────────────────────────────────────────────┘" },
      { tone: "muted", text: "" },
      
      // Controls
      { tone: "primary", text: "┌─ KEYBOARD CONTROLS ──────────────────────────────────────────────┐" },
      { tone: "info", text: "│  [q] Quit  •  [r] Restart  •  [k] Get Token  •  [i] Autostart  │" },
      ...(ollamaRunning ? [{ tone: "info" as keyof typeof THEME, text: "│  [t] Chat with Ollama (AI Assistant)                            │" }] : []),
      { tone: "primary", text: "└──────────────────────────────────────────────────────────────────┘" },
      { tone: "muted", text: "" },
      
      // Token negotiation
      ...(tokenNegotiating
        ? [{ tone: "info" as keyof typeof THEME, text: `│  ${clipForUi(`${getSpinner(spinnerTick)} Negotiating token via browser...`, 60).padEnd(60)}  │` }]
        : []
      ),
      
      // Manual fallback
      ...(manualOpenUrl
        ? [
          { tone: "primary", text: "┌─ MANUAL TOKEN SETUP ─────────────────────────────────────────────┐" },
          { tone: "warning", text: "│  Browser did not open automatically. Visit this URL manually:     │" },
          { tone: "muted", text: `│  ${clipForUi(manualOpenUrl, 60).padEnd(60)}  │` },
          { tone: "info", text: "│  Press [c] to copy URL to clipboard                              │" },
          { tone: "primary", text: "└──────────────────────────────────────────────────────────────────┘" },
          { tone: "muted", text: "" },
        ]
        : []
      ),
      
      // Recent logs (compact, only show 5 on dashboard)
      { tone: "primary", text: "┌─ RECENT OUTPUT ──────────────────────────────────────────────────┐" },
      ...recentLines.slice(-5).map((line) => {
        let tone: keyof typeof THEME = "value";
        const lower = line.toLowerCase();
        if (lower.includes("error") || lower.includes("failed")) tone = "error";
        else if (lower.includes("success") || lower.includes("connected") || lower.includes("authenticated")) tone = "success";
        else if (lower.includes("warn")) tone = "warning";
        return { tone, text: `│  ${clipForUi(line, 60).padEnd(60)}  │` };
      }),
      { tone: "primary", text: "└──────────────────────────────────────────────────────────────────┘" },
      { tone: "muted", text: "" },
    ];
  };

  const screenLines = buildScreenLines();

  const toneForLine = (line: string, baseTone: keyof typeof THEME): keyof typeof THEME => {
    const lower = line.toLowerCase();
    if (lower.includes("│")) return baseTone; // Box drawing - use as-is
    if (lower.includes("┌") || lower.includes("├") || lower.includes("└") || lower.includes("─") || lower.includes("┘")) return baseTone; // Box drawing
    if (lower.includes("installed") || lower.includes("active") || lower.includes("ready") || lower.includes("online") || lower.includes("✓")) return "success";
    if (lower.includes("not installed") || lower.includes("could not") || lower.includes("failed") || lower.includes("missing") || lower.includes("stopped") || lower.includes("✗")) return "warning";
    if (lower.includes("press") || lower.includes("▪") || lower.includes("↑") || lower.includes("↓")) return "info";
    if (lower.includes("error") || lower.includes("err ")) return "error";
    return baseTone;
  };

  return (
    <box border title={isDarkMode ? "SpaceBot" : "SpaceBot (Light)"} padding={1} style={{ width: "100%", height: "100%" }}>
      <text wrapMode="char" truncate>
        {screenLines.map((line, index) => {
          const normalized = line.text; // Don't clip - we're building fixed-width lines
          const tone = toneForLine(normalized, line.tone);
          return (
            <React.Fragment key={`${index}-${normalized.slice(0, 18)}`}>
              <span fg={THEME[tone]}>{normalized}</span>
              {index < screenLines.length - 1 ? <br /> : null}
            </React.Fragment>
          );
        })}
      </text>
    </box>
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