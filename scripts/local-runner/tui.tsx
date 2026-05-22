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

function formatInstallKind(kind: RunnerAutostartStatus["installKind"]): string {
  if (kind === "systemd-user") return "systemd user service";
  if (kind === "launch-agent") return "LaunchAgent";
  return "Startup folder entry";
}

function summarizeRunnerLine(line: string): string | null {
  if (line.includes("WebSocket connected")) return "Connected to SpaceBot. Waiting for jobs.";
  if (line.includes("Authenticated — runner ready")) return "Runner authenticated and ready.";
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
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildKeyValueLine(label: string, value: string): string {
  return `${label}: ${normalizeDisplayText(value)}`;
}

function clipForUi(value: string, max = 120): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
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

  const promptOptions: PromptOption[] = [
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
    runnerToken.startsWith("sbr_") ? `${runnerToken.slice(0, 8)}… configured` : "missing",
  );

  return (
    <box flexDirection="column" padding={1} style={{ width: "100%", height: "100%", backgroundColor: "#08111b" }}>
      <box border title="SpaceBot Local Runner" padding={1} flexDirection="column" style={{ marginBottom: 1 }}>
        <text content={clipForUi(buildKeyValueLine("State", runnerState))} fg="#9fd0ff" />
        <text content={clipForUi(buildKeyValueLine("Server", apiUrl))} />
        <text content={clipForUi(buildKeyValueLine("Runner", displayName))} />
        <text content={clipForUi(buildKeyValueLine("Host", hostname))} />
        <text content={clipForUi(buildKeyValueLine("Default workdir", defaultWorkdir))} />
        <text content={clipForUi(tokenStateLine)} />
        <text content={clipForUi(buildKeyValueLine("Allowed paths", allowedPathText))} />
        <text content={clipForUi(autostartLine)} />
      </box>

      {mode === "prompt" ? (
        <box border title="Autostart Setup" padding={1} flexDirection="column" style={{ marginBottom: 1 }}>
          <text content={clipForUi(noServiceLine)} fg="#ffd17a" />
          <text content={clipForUi(serviceMessage, 160)} />
          <text content="Use Up/Down to choose, Enter to continue." />
          {promptOptions.map((option, index) => {
            const active = index === promptSelection;
            return (
              <box
                key={option.id}
                border
                padding={1}
                flexDirection="column"
                style={{
                  marginTop: 1,
                  backgroundColor: active ? "#14324d" : "#0f1f30",
                }}
              >
                <text content={`${active ? ">" : " "} ${option.title}`} fg={active ? "#ffffff" : "#9fd0ff"} />
                <text content={clipForUi(option.description, 140)} />
              </box>
            );
          })}
        </box>
      ) : (
        <box border title="Dashboard" padding={1} flexDirection="column" style={{ marginBottom: 1 }}>
          <text content={clipForUi(serviceMessage, 160)} />
          <text content="Controls: q quit, r restart runner, k get token, i install autostart" />
          <text content={childRunning ? "Runner child is active." : "Runner child is stopped."} />
          {tokenNegotiating ? <text content="Negotiation in progress. Complete the browser step to continue." /> : null}
          {manualOpenUrl ? (
            <box border title="Manual Browser Fallback" padding={1} flexDirection="column" style={{ marginTop: 1 }}>
              <text content="Could not launch your browser automatically." fg="#ffd17a" />
              <text content="Open this URL manually, then complete login/consent." />
              <text content={clipForUi(manualOpenUrl, 170)} fg="#9fd0ff" />
              <text content="Press c to copy this URL to your clipboard." />
            </box>
          ) : null}
        </box>
      )}

      <box border title="Recent Output" padding={1} flexDirection="column" style={{ flexGrow: 1 }}>
        {logs.map((line, index) => (
          <text key={`${index}-${line.slice(0, 12)}`} content={clipForUi(line, 180)} />
        ))}
      </box>
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