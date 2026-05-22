import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn, spawnSync } from "node:child_process";

interface NegotiationOptions {
  apiUrl: string;
  displayName: string;
  timeoutMs?: number;
}

interface NegotiationResult {
  ok: boolean;
  token?: string;
  error?: string;
  browserUrl: string;
  manualOpenRecommended?: boolean;
}

interface ClipboardResult {
  ok: boolean;
  error?: string;
}

function parseIncomingPayload(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.type !== "runner-token") return null;
    if (typeof parsed?.token !== "string") return null;
    const token = parsed.token.trim();
    if (!token.startsWith("sbr_")) return null;
    return token;
  } catch {
    return null;
  }
}

function writeHtml(res: ServerResponse, status: number, html: string) {
  res.statusCode = status;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(html);
}

function openExternalUrl(url: string): boolean {
  try {
    if (process.platform === "win32") {
      const child = spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", windowsHide: true });
      child.unref();
      return true;
    }

    if (process.platform === "darwin") {
      const child = spawn("open", [url], { stdio: "ignore" });
      child.unref();
      return true;
    }

    const child = spawn("xdg-open", [url], { stdio: "ignore" });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function runClipboard(command: string, args: string[], text: string): ClipboardResult {
  try {
    const result = spawnSync(command, args, {
      input: text,
      encoding: "utf8",
      windowsHide: true,
    });

    if (result.status === 0) {
      return { ok: true };
    }

    return {
      ok: false,
      error: result.stderr?.trim() || `${command} exited with code ${result.status ?? 1}`,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function copyTextToClipboard(text: string): ClipboardResult {
  const value = text.trim();
  if (!value) {
    return { ok: false, error: "Nothing to copy." };
  }

  if (process.platform === "darwin") {
    return runClipboard("pbcopy", [], value);
  }

  if (process.platform === "win32") {
    return runClipboard("powershell", ["-NoProfile", "-Command", "Set-Clipboard"], value);
  }

  const wayland = runClipboard("wl-copy", [], value);
  if (wayland.ok) return wayland;

  const xclip = runClipboard("xclip", ["-selection", "clipboard"], value);
  if (xclip.ok) return xclip;

  const xsel = runClipboard("xsel", ["--clipboard", "--input"], value);
  if (xsel.ok) return xsel;

  return {
    ok: false,
    error: "No clipboard utility found (tried wl-copy, xclip, xsel).",
  };
}

export async function negotiateRunnerTokenViaBrowser(options: NegotiationOptions): Promise<NegotiationResult> {
  const timeoutMs = Math.max(20_000, options.timeoutMs ?? 180_000);

  return await new Promise<NegotiationResult>((resolve) => {
    let resolved = false;
    const finish = (result: NegotiationResult) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      try {
        server.close();
      } catch {
        // Ignore close errors.
      }
      resolve(result);
    };

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.setHeader("access-control-allow-origin", "*");
        res.setHeader("access-control-allow-methods", "POST, OPTIONS");
        res.setHeader("access-control-allow-headers", "content-type");
        res.end();
        return;
      }

      if (req.url !== "/callback" || req.method !== "POST") {
        writeHtml(res, 404, "<h1>Not found</h1>");
        return;
      }

      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      req.on("end", () => {
        const token = parseIncomingPayload(Buffer.concat(chunks).toString("utf8"));
        res.setHeader("access-control-allow-origin", "*");
        if (!token) {
          writeHtml(res, 400, "<h1>Invalid payload</h1><p>Token was not accepted.</p>");
          return;
        }
        writeHtml(res, 200, "<h1>Connected</h1><p>You can close this tab and return to the terminal.</p>");
        finish({ ok: true, token, browserUrl });
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        finish({ ok: false, error: "Failed to bind local callback server", browserUrl: options.apiUrl });
        return;
      }

      const callbackUrl = `http://127.0.0.1:${address.port}/callback`;
      const tokenName = `${options.displayName} (negotiated)`;
      const browserUrl = `${options.apiUrl.replace(/\/$/, "")}/api/account/runners/negotiate?callback=${encodeURIComponent(callbackUrl)}&name=${encodeURIComponent(tokenName)}`;
      const opened = openExternalUrl(browserUrl);

      if (!opened) {
        finish({
          ok: false,
          error: `Could not open the browser automatically. Open this URL manually: ${browserUrl}`,
          browserUrl,
          manualOpenRecommended: true,
        });
      }
    });

    const timeout = setTimeout(() => {
      finish({
        ok: false,
        error: "Timed out waiting for browser confirmation. Ensure you are logged in on the production site and retry.",
        browserUrl,
      });
    }, timeoutMs);

    let browserUrl = options.apiUrl;
  });
}