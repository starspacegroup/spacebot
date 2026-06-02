const vscode = require("vscode");
const http = require("node:http");
const crypto = require("node:crypto");

let bridgeStarted = false;
let bridgeDisposable = null;
let bridgeInfo = null;
const conversationHistory = new Map();

function parsePortRange(input) {
  const raw = String(input || "").trim();
  if (!raw) return [49372, 49420];
  const [aRaw, bRaw] = raw.split("-").map((x) => Number(x));
  const a = Number.isFinite(aRaw) ? Math.max(1024, Math.min(65535, Math.trunc(aRaw))) : 49372;
  const b = Number.isFinite(bRaw) ? Math.max(1024, Math.min(65535, Math.trunc(bRaw))) : a;
  return a <= b ? [a, b] : [b, a];
}

function buildPortCandidates() {
  const preferredRaw = Number(process.env.SPACEBOT_VSCODE_BRIDGE_PORT || "49372");
  const preferredPort = Number.isFinite(preferredRaw) ? Math.max(1024, Math.min(65535, Math.trunc(preferredRaw))) : 49372;
  const [start, end] = parsePortRange(process.env.SPACEBOT_VSCODE_BRIDGE_PORT_RANGE);

  const set = new Set([preferredPort]);
  for (let p = start; p <= end; p += 1) set.add(p);
  return Array.from(set);
}

function parseBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        raw = "";
        resolve({});
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

async function bestEffortSendCopilotMessage(message) {
  const candidates = [
    ["github.copilot.chat.open", message],
    ["workbench.action.chat.open", message],
    ["workbench.action.chat.open", { query: message }],
  ];

  for (const [command, arg] of candidates) {
    try {
      await vscode.commands.executeCommand(command, arg);
      return { ok: true, command };
    } catch {
      // Try next command.
    }
  }

  try {
    await vscode.env.clipboard.writeText(message);
  } catch {
    // Ignore clipboard failures.
  }

  return { ok: false, reason: "chat_command_not_available" };
}

async function runCopilotModelRequest(conversationKey, message, timeoutMs) {
  const key = String(conversationKey || "default").trim().slice(0, 120) || "default";
  const prior = Array.isArray(conversationHistory.get(key)) ? conversationHistory.get(key) : [];
  const messages = [];

  for (const item of prior.slice(-18)) {
    if (item.role === "assistant") {
      messages.push(vscode.LanguageModelChatMessage.Assistant(item.content));
    } else {
      messages.push(vscode.LanguageModelChatMessage.User(item.content));
    }
  }
  messages.push(vscode.LanguageModelChatMessage.User(message));

  const [model] = await vscode.lm.selectChatModels({ vendor: "copilot" });
  if (!model) {
    return { ok: false, reason: "copilot_model_not_available" };
  }

  const cts = new vscode.CancellationTokenSource();
  const safeTimeoutMs = Number.isFinite(timeoutMs) ? Math.max(1000, Math.min(120000, Math.trunc(timeoutMs))) : 45000;
  const timer = setTimeout(() => cts.cancel(), safeTimeoutMs);

  let fullText = "";
  try {
    const response = await model.sendRequest(messages, {}, cts.token);
    for await (const chunk of response.stream) {
      if (chunk instanceof vscode.LanguageModelTextPart && chunk.value) {
        fullText += chunk.value;
      }
    }
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: "model_request_failed", error: messageText };
  } finally {
    clearTimeout(timer);
    cts.dispose();
  }

  const cleaned = String(fullText || "").trim();
  if (!cleaned) {
    return { ok: false, reason: "empty_model_response" };
  }

  const nextHistory = [
    ...prior.slice(-18),
    { role: "user", content: message },
    { role: "assistant", content: cleaned },
  ];
  conversationHistory.set(key, nextHistory);

  return { ok: true, response: cleaned, model: model.id, conversationKey: key };
}

function buildDiscoveryPayload(instanceId, port) {
  const workspaceFolders = (vscode.workspace.workspaceFolders || []).map((folder) => ({
    name: folder.name,
    path: folder.uri.fsPath,
  }));

  const editors = vscode.window.visibleTextEditors.map((ed) => ({
    file: ed.document.uri.scheme === "file" ? ed.document.uri.fsPath : ed.document.uri.toString(),
    languageId: ed.document.languageId,
    dirty: ed.document.isDirty,
  }));

  return {
    instanceId,
    bridgeUrl: `http://127.0.0.1:${port}`,
    pid: typeof process.pid === "number" ? process.pid : null,
    appName: vscode.env.appName,
    workspaceFolders,
    visibleEditors: editors,
    focused: Boolean(vscode.window.activeTextEditor),
    timestamp: new Date().toISOString(),
  };
}

function startServerOnPort(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

async function bestEffortStartServer(server, output, candidates) {
  for (const port of candidates) {
    try {
      await startServerOnPort(server, port);
      return port;
    } catch (error) {
      const code = error && typeof error === "object" ? error.code : null;
      if (code !== "EADDRINUSE") {
        output.appendLine(`[SpaceBot] Failed to bind bridge on ${port}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  throw new Error("No available port for SpaceBot bridge in configured range");
}

async function startBridge(context) {
  if (bridgeStarted) return;

  const output = vscode.window.createOutputChannel("SpaceBot Runner Bridge");
  const persistedToken = context.globalState.get("spacebot.bridge.token");
  const token = process.env.SPACEBOT_VSCODE_BRIDGE_TOKEN
    || (typeof persistedToken === "string" && persistedToken.trim() ? persistedToken.trim() : "")
    || crypto.randomBytes(16).toString("hex");
  if (!persistedToken) {
    await context.globalState.update("spacebot.bridge.token", token);
  }

  const instanceId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;

  const server = http.createServer(async (req, res) => {
    if (req.socket.remoteAddress && !req.socket.remoteAddress.includes("127.0.0.1") && !req.socket.remoteAddress.includes("::1")) {
      return writeJson(res, 403, { error: "Forbidden" });
    }

    const auth = String(req.headers.authorization || "");
    if (auth !== `Bearer ${token}`) {
      return writeJson(res, 401, { error: "Unauthorized" });
    }

    if (req.method !== "POST") {
      return writeJson(res, 405, { error: "Method not allowed" });
    }

    if (req.url === "/v1/discover") {
      return writeJson(res, 200, { ok: true, discovery: buildDiscoveryPayload(instanceId, bridgeInfo?.port || 0) });
    }

    if (req.url === "/v1/open-workspace") {
      const body = await parseBody(req);
      const target = typeof body.path === "string" ? body.path : "";
      if (!target) return writeJson(res, 400, { error: "path is required" });

      try {
        const uri = vscode.Uri.file(target);
        await vscode.commands.executeCommand("vscode.openFolder", uri, Boolean(body.newWindow));
        return writeJson(res, 200, { ok: true });
      } catch (error) {
        return writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
      }
    }

    if (req.url === "/v1/copilot-message") {
      const body = await parseBody(req);
      const message = typeof body.message === "string" ? body.message.trim() : "";
      if (!message) return writeJson(res, 400, { error: "message is required" });

      const mirrorToChat = body.mirrorToChat !== false;
      const includeResponse = body.includeResponse === true;
      const conversationKey = typeof body.conversationKey === "string" ? body.conversationKey : "default";
      const timeoutMs = Number(body.timeoutMs);

      let command = null;
      if (mirrorToChat) {
        const sent = await bestEffortSendCopilotMessage(message);
        if (!sent.ok && !includeResponse) {
          return writeJson(res, 501, { ok: false, reason: sent.reason });
        }
        command = sent.ok ? sent.command : null;
      }

      if (!includeResponse) {
        return writeJson(res, 200, { ok: true, command, mirroredToChat: mirrorToChat });
      }

      const modelResult = await runCopilotModelRequest(conversationKey, message, timeoutMs);
      if (!modelResult.ok) {
        return writeJson(res, 502, {
          ok: false,
          reason: modelResult.reason,
          error: modelResult.error || null,
          command,
          mirroredToChat: mirrorToChat,
        });
      }

      return writeJson(res, 200, {
        ok: true,
        command,
        mirroredToChat: mirrorToChat,
        response: modelResult.response,
        model: modelResult.model,
        conversationKey: modelResult.conversationKey,
      });
    }

    return writeJson(res, 404, { error: "Not found" });
  });

  const port = await bestEffortStartServer(server, output, buildPortCandidates());
  bridgeInfo = { token, port, instanceId };
  output.appendLine(`[SpaceBot] Bridge listening on 127.0.0.1:${port}`);
  output.appendLine(`[SpaceBot] Bridge instance: ${instanceId}`);
  output.appendLine(`[SpaceBot] Bridge token: ${token}`);
  output.appendLine("[SpaceBot] Set RUNNER_VSCODE_BRIDGE_TOKEN in runner env to this token.");

  server.on("error", (error) => {
    output.appendLine(`[SpaceBot] Bridge error: ${error instanceof Error ? error.message : String(error)}`);
  });

  const disposable = {
    dispose: () => {
      try {
        server.close();
      } catch {
        // Ignore close errors.
      }
      output.dispose();
      bridgeStarted = false;
      bridgeDisposable = null;
      bridgeInfo = null;
    },
  };

  bridgeStarted = true;
  bridgeDisposable = disposable;
  context.subscriptions.push(disposable);
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("spacebotLocalRunnerBridge.start", async () => {
      await startBridge(context);
      vscode.window.showInformationMessage("SpaceBot local runner bridge started.");
    })
  );

  startBridge(context).catch((error) => {
    const msg = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`SpaceBot bridge failed to start: ${msg}`);
  });
}

function deactivate() {
  if (bridgeDisposable) {
    bridgeDisposable.dispose();
  }
}

module.exports = {
  activate,
  deactivate,
};
