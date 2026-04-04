import { json } from "@sveltejs/kit";
import { getGlobalSetting, setGlobalSetting } from "$lib/db/global-settings.js";
import { listGatewayLogs, recordGatewayLogs } from "$lib/db/gateway-logs.js";
import { log } from "$lib/log.js";

const GATEWAY_LOG_CAPTURE_KEY = "gateway_log_capture_enabled";
const DEFAULT_LOG_LIMIT = 150;

function checkIsSuperAdmin(userId, platform) {
  if (!userId) return false;
  const adminUserIds = platform?.env?.ADMIN_USER_IDS || process.env.ADMIN_USER_IDS || "";
  return adminUserIds
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .includes(userId);
}

function checkIsBotRequest(request, platform) {
  const authHeader = request.headers.get("Authorization");
  const botToken = platform?.env?.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;
  return Boolean(botToken) && authHeader === `Bot ${botToken}`;
}

async function getCaptureEnabled(db) {
  const value = await getGlobalSetting(db, GATEWAY_LOG_CAPTURE_KEY, "false");
  return value === "true";
}

export async function handleGatewayLogsApi({ request, cookies, platform, url }) {
  const db = platform?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 503 });
  }

  const method = request.method.toUpperCase();

  if (method === "GET") {
    const isBotRequest = checkIsBotRequest(request, platform);
    if (!isBotRequest) {
      const userId = cookies.get("discord_user_id");
      if (!checkIsSuperAdmin(userId, platform)) {
        return json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    try {
      const enabled = await getCaptureEnabled(db);

      if (isBotRequest) {
        return json({ success: true, enabled });
      }

      const requestedLimit = url.searchParams.get("limit") || String(DEFAULT_LOG_LIMIT);
      const logs = await listGatewayLogs(db, { limit: requestedLimit });
      return json({ success: true, enabled, logs });
    } catch (error) {
      log.error("[GatewayLogs API] GET error:", error);
      return json({ error: "Failed to fetch gateway logs" }, { status: 500 });
    }
  }

  if (method === "POST") {
    if (!checkIsBotRequest(request, platform)) {
      return json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      const enabled = await getCaptureEnabled(db);
      if (!enabled) {
        return json({ success: true, stored: 0, enabled: false });
      }

      const body = await request.json();
      const entries = Array.isArray(body?.entries) ? body.entries : [];
      const result = await recordGatewayLogs(db, entries);

      if (!result.success) {
        return json({ error: result.error || "Failed to store logs" }, { status: 500 });
      }

      return json({ success: true, stored: result.count, enabled: true });
    } catch (error) {
      log.error("[GatewayLogs API] POST error:", error);
      return json({ error: "Invalid request body" }, { status: 400 });
    }
  }

  if (method === "PATCH") {
    const userId = cookies.get("discord_user_id");
    if (!checkIsSuperAdmin(userId, platform)) {
      return json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      const body = await request.json();
      if (typeof body?.enabled !== "boolean") {
        return json({ error: "enabled must be a boolean" }, { status: 400 });
      }

      const result = await setGlobalSetting(
        db,
        GATEWAY_LOG_CAPTURE_KEY,
        body.enabled ? "true" : "false",
      );

      if (!result.success) {
        return json({ error: result.error || "Failed to update setting" }, { status: 500 });
      }

      return json({ success: true, enabled: body.enabled });
    } catch (error) {
      log.error("[GatewayLogs API] PATCH error:", error);
      return json({ error: "Invalid request body" }, { status: 400 });
    }
  }

  return json({ error: "Method not allowed" }, { status: 405 });
}