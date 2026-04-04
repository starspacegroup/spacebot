import { json } from "@sveltejs/kit";
import { getGlobalSetting, setGlobalSetting } from "$lib/db/global-settings.js";
import { listGatewayLogs, recordGatewayLogs } from "$lib/db/gateway-logs.js";
import { log } from "$lib/log.js";

const GATEWAY_LOG_CAPTURE_KEY = "gateway_log_capture_enabled";
const GATEWAY_LOG_LAST_SEEN_AT_KEY = "gateway_log_capture_last_seen_at";
const GATEWAY_LOG_LAST_POST_AT_KEY = "gateway_log_capture_last_post_at";
const GATEWAY_LOG_LAST_STORED_COUNT_KEY = "gateway_log_capture_last_stored_count";
const DEFAULT_LOG_LIMIT = 150;
export const GATEWAY_LOG_CONNECTED_WINDOW_MS = 20_000;

function getEnv(name, platform) {
  return platform?.env?.[name] ?? (typeof process !== "undefined" ? process.env?.[name] : undefined);
}

export function checkIsSuperAdmin(userId, platform) {
  if (!userId) return false;
  const adminUserIds = getEnv("ADMIN_USER_IDS", platform) || "";
  return adminUserIds
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .includes(userId);
}

function checkIsBotRequest(request, platform) {
  const authHeader = request.headers.get("Authorization");
  const botToken = getEnv("DISCORD_BOT_TOKEN", platform);
  return Boolean(botToken) && authHeader === `Bot ${botToken}`;
}

async function getCaptureEnabled(db) {
  const value = await getGlobalSetting(db, GATEWAY_LOG_CAPTURE_KEY, "false");
  return value === "true";
}

function isRecentTimestamp(timestamp, windowMs = GATEWAY_LOG_CONNECTED_WINDOW_MS) {
  if (!timestamp) {
    return false;
  }

  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  return Date.now() - parsed.getTime() <= windowMs;
}

async function updateGatewayLogStatus(db, updates = {}) {
  const writes = [];

  if (updates.lastSeenAt) {
    writes.push(setGlobalSetting(db, GATEWAY_LOG_LAST_SEEN_AT_KEY, updates.lastSeenAt));
  }

  if (updates.lastPostAt) {
    writes.push(setGlobalSetting(db, GATEWAY_LOG_LAST_POST_AT_KEY, updates.lastPostAt));
  }

  if (updates.lastStoredCount !== undefined) {
    writes.push(
      setGlobalSetting(db, GATEWAY_LOG_LAST_STORED_COUNT_KEY, String(updates.lastStoredCount)),
    );
  }

  if (writes.length > 0) {
    await Promise.all(writes);
  }
}

export async function getGatewayLogStatus(db, options = {}) {
  const [storedEnabled, lastGatewaySeenAt, lastGatewayPostedAt, lastStoredCount] = await Promise.all([
    options.enabled === undefined
      ? getGlobalSetting(db, GATEWAY_LOG_CAPTURE_KEY, "false")
      : Promise.resolve(options.enabled ? "true" : "false"),
    getGlobalSetting(db, GATEWAY_LOG_LAST_SEEN_AT_KEY, null),
    getGlobalSetting(db, GATEWAY_LOG_LAST_POST_AT_KEY, null),
    getGlobalSetting(db, GATEWAY_LOG_LAST_STORED_COUNT_KEY, "0"),
  ]);

  const parsedStoredCount = Number.parseInt(String(lastStoredCount), 10);

  return {
    enabled: storedEnabled === "true",
    lastGatewaySeenAt,
    lastGatewayPostedAt,
    lastStoredCount: Number.isFinite(parsedStoredCount) ? parsedStoredCount : 0,
    lastGatewayConnected: isRecentTimestamp(lastGatewaySeenAt),
    serverTime: new Date().toISOString(),
  };
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
        await updateGatewayLogStatus(db, { lastSeenAt: new Date().toISOString() });
      }

      const status = await getGatewayLogStatus(db, { enabled });

      if (isBotRequest) {
        return json({ success: true, enabled, status });
      }

      const requestedLimit = url.searchParams.get("limit") || String(DEFAULT_LOG_LIMIT);
      const logs = await listGatewayLogs(db, { limit: requestedLimit });
      return json({ success: true, enabled, logs, status });
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

      await updateGatewayLogStatus(db, {
        lastSeenAt: new Date().toISOString(),
        lastPostAt: new Date().toISOString(),
        lastStoredCount: result.count,
      });

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