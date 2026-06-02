const BRIDGE_URL = (process.env.RUNNER_VSCODE_BRIDGE_URL ?? "http://127.0.0.1:49372").replace(/\/$/, "");
const BRIDGE_TOKEN = process.env.RUNNER_VSCODE_BRIDGE_TOKEN ?? "";

interface BridgeCallOptions {
  url?: string;
  token?: string;
}

export interface BridgeCopilotMessageOptions {
  conversationKey?: string;
  includeResponse?: boolean;
  timeoutMs?: number;
  mirrorToChat?: boolean;
}

interface BridgeCallResult {
  ok: boolean;
  status?: number;
  body?: any;
  error?: string;
}

async function callBridge(
  path: string,
  payload: Record<string, unknown> = {},
  options: BridgeCallOptions = {},
): Promise<BridgeCallResult> {
  const bridgeUrl = (options.url ?? BRIDGE_URL).replace(/\/$/, "");
  const bridgeToken = options.token ?? BRIDGE_TOKEN;

  if (!bridgeToken) {
    return { ok: false, error: "RUNNER_VSCODE_BRIDGE_TOKEN is not set" };
  }

  try {
    const res = await fetch(`${bridgeUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${bridgeToken}`,
      },
      body: JSON.stringify(payload),
    });

    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }

    return {
      ok: res.ok,
      status: res.status,
      body,
      error: res.ok ? undefined : (body?.error || `Bridge request failed (${res.status})`),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function bridgeDiscover() {
  return callBridge("/v1/discover");
}

export async function bridgeDiscoverAt(url: string, token?: string) {
  return callBridge("/v1/discover", {}, { url, token });
}

export async function bridgeOpenWorkspace(path: string, newWindow = false, options: BridgeCallOptions = {}) {
  return callBridge("/v1/open-workspace", { path, newWindow }, options);
}

export async function bridgeSendCopilotMessage(
  message: string,
  messageOptions: BridgeCopilotMessageOptions = {},
  options: BridgeCallOptions = {},
) {
  return callBridge("/v1/copilot-message", { message, ...messageOptions }, options);
}
