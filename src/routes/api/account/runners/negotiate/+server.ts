import { redirect } from "@sveltejs/kit";
import { createRunnerToken } from "$lib/db/local-runners.js";

const CALLBACK_ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost"]);

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildHtml(status, title, message, callbackUrl, payload = null) {
  const payloadJson = payload ? JSON.stringify(payload) : "null";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; padding: 2rem; background: #09131f; color: #dbe9ff; }
    .card { max-width: 680px; margin: 0 auto; padding: 1.25rem 1.5rem; border: 1px solid #274368; border-radius: 12px; background: #0f1d30; }
    h1 { margin: 0 0 0.75rem; font-size: 1.25rem; }
    p { margin: 0.5rem 0; line-height: 1.4; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    ${callbackUrl ? `<p>Local callback: <code>${escapeHtml(callbackUrl)}</code></p>` : ""}
    <p id="result">${status === "pending" ? "Sending token to local runner..." : ""}</p>
  </div>
  <script>
    (async () => {
      const payload = ${payloadJson};
      if (!payload) return;
      const callbackUrl = ${JSON.stringify(callbackUrl || "")};
      const resultEl = document.getElementById("result");
      try {
        const res = await fetch(callbackUrl, {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          resultEl.textContent = "Token created, but local runner callback rejected it. Keep this tab open and retry in the runner UI.";
          return;
        }

        resultEl.textContent = "Token sent. Return to your terminal; the local runner should continue automatically.";
      } catch {
        resultEl.textContent = "Token created, but the local callback was unreachable. Ensure the runner is waiting, then retry.";
      }
    })();
  </script>
</body>
</html>`;
}

function getOrigin(request, url) {
  const forwardedHost = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const forwardedProto = request.headers.get("x-forwarded-proto") || "https";
  if (forwardedHost && !forwardedHost.startsWith("localhost") && !forwardedHost.startsWith("127.")) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  return url.origin;
}

function validateCallback(callbackUrlRaw) {
  if (!callbackUrlRaw) return { ok: false, error: "Missing callback URL." };
  let parsed;
  try {
    parsed = new URL(callbackUrlRaw);
  } catch {
    return { ok: false, error: "Callback URL is invalid." };
  }

  if (parsed.protocol !== "http:") {
    return { ok: false, error: "Callback URL must use http://" };
  }

  if (!CALLBACK_ALLOWED_HOSTS.has(parsed.hostname)) {
    return { ok: false, error: "Callback host must be localhost or 127.0.0.1." };
  }

  if (!parsed.port) {
    return { ok: false, error: "Callback URL must include an explicit port." };
  }

  return { ok: true, parsed };
}

export async function GET({ request, url, cookies, platform }) {
  const userId = cookies.get("discord_user_id");
  const callback = url.searchParams.get("callback") || "";
  const callbackCheck = validateCallback(callback);
  const returnTo = `${getOrigin(request, url)}${url.pathname}${url.search}`;

  if (!userId) {
    throw redirect(302, `/api/auth/discord?flow=login&return_to=${encodeURIComponent(returnTo)}`);
  }

  if (!callbackCheck.ok) {
    return new Response(
      buildHtml("error", "Runner Token Negotiation Failed", callbackCheck.error, callback),
      { status: 400, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }

  const db = (platform as any)?.env?.DB;
  if (!db) {
    return new Response(
      buildHtml("error", "Runner Token Negotiation Failed", "Database unavailable. Please retry shortly.", callback),
      { status: 503, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }

  const requestedName = (url.searchParams.get("name") || "").trim();
  const tokenName = requestedName || `Negotiated Runner ${new Date().toISOString().slice(0, 19).replace("T", " ")}`;
  const created = await createRunnerToken(db, userId, tokenName.slice(0, 120));

  if (!created.success || !created.rawToken) {
    return new Response(
      buildHtml("error", "Runner Token Negotiation Failed", created.error || "Unable to create runner token.", callback),
      { status: 400, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }

  return new Response(
    buildHtml(
      "pending",
      "Runner Token Ready",
      "A fresh runner token was created for this account. Sending it to your local runner now.",
      callback,
      {
        type: "runner-token",
        token: created.rawToken,
        tokenId: created.record?.id ?? null,
        tokenName,
      },
    ),
    { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}