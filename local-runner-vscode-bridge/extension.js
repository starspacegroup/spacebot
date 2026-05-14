const vscode = require("vscode");
const http = require("node:http");
const crypto = require("node:crypto");

let bridgeStarted = false;
let bridgeDisposable = null;

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

function buildDiscoveryPayload() {
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
    workspaceFolders,
    visibleEditors: editors,
    focused: Boolean(vscode.window.activeTextEditor),
    timestamp: new Date().toISOString(),
  };
}

function startBridge(context) {
  if (bridgeStarted) return;

  const output = vscode.window.createOutputChannel("SpaceBot Runner Bridge");
  const port = Number(process.env.SPACEBOT_VSCODE_BRIDGE_PORT || "49372");
  const token = process.env.SPACEBOT_VSCODE_BRIDGE_TOKEN || crypto.randomBytes(16).toString("hex");

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
      return writeJson(res, 200, { ok: true, discovery: buildDiscoveryPayload() });
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

      const sent = await bestEffortSendCopilotMessage(message);
      if (sent.ok) return writeJson(res, 200, { ok: true, command: sent.command });
      return writeJson(res, 501, { ok: false, reason: sent.reason });
    }

    return writeJson(res, 404, { error: "Not found" });
  });

  server.listen(port, "127.0.0.1", () => {
    output.appendLine(`[SpaceBot] Bridge listening on 127.0.0.1:${port}`);
    output.appendLine(`[SpaceBot] Bridge token: ${token}`);
    output.appendLine("[SpaceBot] Set RUNNER_VSCODE_BRIDGE_TOKEN in runner env to this token.");
  });

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
    },
  };

  bridgeStarted = true;
  bridgeDisposable = disposable;
  context.subscriptions.push(disposable);
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("spacebotLocalRunnerBridge.start", () => {
      startBridge(context);
      vscode.window.showInformationMessage("SpaceBot local runner bridge started.");
    })
  );

  startBridge(context);
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
