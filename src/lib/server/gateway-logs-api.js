import { json } from "@sveltejs/kit";
import { getGlobalSetting, setGlobalSetting } from "$lib/db/global-settings.js";
import { listGatewayLogs, recordGatewayLogs } from "$lib/db/gateway-logs.js";
import { log } from "$lib/log.js";

const GATEWAY_LOG_CAPTURE_KEY = "gateway_log_capture_enabled";
const GATEWAY_LOG_LAST_SEEN_AT_KEY = "gateway_log_capture_last_seen_at";
const GATEWAY_LOG_LAST_POST_AT_KEY = "gateway_log_capture_last_post_at";
const GATEWAY_LOG_LAST_STORED_COUNT_KEY = "gateway_log_capture_last_stored_count";
const GATEWAY_UPDATE_REQUIRED_VERSION_KEY = "gateway_update_required_version";
const GATEWAY_UPDATE_LAST_ATTEMPT_KEY = "gateway_update_last_attempt";
const DEFAULT_LOG_LIMIT = 150;
export const GATEWAY_LOG_CONNECTED_WINDOW_MS = 20_000;

function getEnv(name, platform) {
  return platform?.env?.[name] ?? (typeof process !== "undefined" ? process.env?.[name] : undefined);
}

function parseJsonSafe(value) {
  if (!value || typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeVersion(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getFrontendVersion(platform) {
  return (
    normalizeVersion(getEnv("SPACEBOT_FRONTEND_VERSION", platform))
    ?? normalizeVersion(getEnv("npm_package_version", platform))
    ?? "0.0.0"
  );
}

async function getGatewayUpdateState(db, platform) {
  const frontendVersion = getFrontendVersion(platform);
  const [requiredVersionRaw, lastAttemptRaw] = await Promise.all([
    getGlobalSetting(db, GATEWAY_UPDATE_REQUIRED_VERSION_KEY, null),
    getGlobalSetting(db, GATEWAY_UPDATE_LAST_ATTEMPT_KEY, null),
  ]);

  const requiredVersion = normalizeVersion(requiredVersionRaw) ?? frontendVersion;
  const lastAttempt = parseJsonSafe(lastAttemptRaw);

  return {
    frontendVersion,
    requiredVersion,
    lastAttempt: lastAttempt && typeof lastAttempt === "object" ? lastAttempt : null,
    suggestedCommand: "git pull && bun run gateway",
  };
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

async function recordGatewayUpdateAttempt(db, body = {}) {
  const targetVersion = normalizeVersion(body?.targetVersion);
  const gatewayVersion = normalizeVersion(body?.gatewayVersion);
  const status = normalizeVersion(body?.status) ?? "started";
  const command = normalizeVersion(body?.command) ?? "git pull && bun run gateway";
  const error = normalizeVersion(body?.error) ?? null;

  if (!targetVersion) {
    return { success: false, error: "targetVersion is required" };
  }

  const payload = {
    targetVersion,
    gatewayVersion,
    status,
    command,
    error,
    attemptedAt: new Date().toISOString(),
  };

  const result = await setGlobalSetting(db, GATEWAY_UPDATE_LAST_ATTEMPT_KEY, JSON.stringify(payload));
  if (!result.success) {
    return { success: false, error: result.error || "Failed to persist update attempt" };
  }

  return { success: true, attempt: payload };
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

      const [status, gatewayUpdate] = await Promise.all([
        getGatewayLogStatus(db, { enabled }),
        getGatewayUpdateState(db, platform),
      ]);

      if (isBotRequest) {
        return json({ success: true, enabled, status, gatewayUpdate });
      }

      const requestedLimit = url.searchParams.get("limit") || String(DEFAULT_LOG_LIMIT);
      const logs = await listGatewayLogs(db, { limit: requestedLimit });
      return json({ success: true, enabled, logs, status, gatewayUpdate });
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

  if (method === "PUT") {
    if (!checkIsBotRequest(request, platform)) {
      return json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      const body = await request.json();
      if (body?.type !== "gateway_update_attempt") {
        return json({ error: "Unsupported update payload type" }, { status: 400 });
      }

      const result = await recordGatewayUpdateAttempt(db, body);
      if (!result.success) {
        return json({ error: result.error || "Failed to record update attempt" }, { status: 400 });
      }

      return json({ success: true, attempt: result.attempt });
    } catch (error) {
      log.error("[GatewayLogs API] PUT error:", error);
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