import { log } from "./logger.js";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function safeParseJson(value) {
  if (!value || typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function clampPageSize(value) {
  const parsed = Number.parseInt(String(value || DEFAULT_PAGE_SIZE), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(parsed, MAX_PAGE_SIZE);
}

function normalizePage(value) {
  const parsed = Number.parseInt(String(value || 1), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return parsed;
}

function normalizeActivityType(value) {
  const type = (value || "").toLowerCase();
  if (["page_view", "api_action", "action"].includes(type)) {
    return type;
  }
  return "action";
}

export async function trackUserActivity(db, activity) {
  if (!db || !activity?.userId || !activity?.path) {
    return { success: false, skipped: true, reason: "missing_required_fields" };
  }

  const activityType = normalizeActivityType(activity.activityType);
  const method = String(activity.method || "GET").toUpperCase();

  try {
    await db
      .prepare(`
        INSERT INTO user_activity_logs (
          user_id, activity_type, method, path, query_string,
          status_code, referrer, ip_address, user_agent, details_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        activity.userId,
        activityType,
        method,
        activity.path,
        activity.queryString || null,
        Number.isFinite(activity.statusCode) ? activity.statusCode : null,
        activity.referrer || null,
        activity.ipAddress || null,
        activity.userAgent || null,
        activity.details ? JSON.stringify(activity.details) : null,
      )
      .run();

    return { success: true };
  } catch (error) {
    log.error("[UserActivity] Failed to track user activity:", error);
    return { success: false, error: error.message || String(error) };
  }
}

export async function listUserActivity(db, userId, options = {}) {
  if (!db || !userId) {
    return {
      entries: [],
      total: 0,
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      totalPages: 0,
      summary: { pageViews: 0, apiActions: 0, actions: 0, lastSeenAt: null },
    };
  }

  const page = normalizePage(options.page);
  const pageSize = clampPageSize(options.pageSize);
  const offset = (page - 1) * pageSize;

  const whereParts = ["user_id = ?"];
  const binds = [userId];

  if (options.type && options.type !== "all") {
    const type = normalizeActivityType(options.type);
    whereParts.push("activity_type = ?");
    binds.push(type);
  }

  if (options.method && options.method !== "all") {
    whereParts.push("method = ?");
    binds.push(String(options.method).toUpperCase());
  }

  if (options.pathPrefix) {
    whereParts.push("path LIKE ?");
    binds.push(`${options.pathPrefix}%`);
  }

  const whereClause = `WHERE ${whereParts.join(" AND ")}`;

  try {
    const totalRow = await db
      .prepare(`SELECT COUNT(*) AS total FROM user_activity_logs ${whereClause}`)
      .bind(...binds)
      .first();

    const rowsResult = await db
      .prepare(`
        SELECT id, user_id, activity_type, method, path, query_string, status_code,
               referrer, ip_address, user_agent, details_json, created_at
        FROM user_activity_logs
        ${whereClause}
        ORDER BY created_at DESC, id DESC
        LIMIT ? OFFSET ?
      `)
      .bind(...binds, pageSize, offset)
      .all();

    const summaryRows = await db
      .prepare(`
        SELECT
          activity_type,
          COUNT(*) AS count,
          MAX(created_at) AS last_seen_at
        FROM user_activity_logs
        WHERE user_id = ?
        GROUP BY activity_type
      `)
      .bind(userId)
      .all();

    let pageViews = 0;
    let apiActions = 0;
    let actions = 0;
    let lastSeenAt = null;

    for (const row of summaryRows?.results || []) {
      if (row.activity_type === "page_view") pageViews = row.count || 0;
      if (row.activity_type === "api_action") apiActions = row.count || 0;
      if (row.activity_type === "action") actions = row.count || 0;

      if (!lastSeenAt || (row.last_seen_at && row.last_seen_at > lastSeenAt)) {
        lastSeenAt = row.last_seen_at || lastSeenAt;
      }
    }

    const total = Number(totalRow?.total || 0);

    return {
      entries: (rowsResult?.results || []).map((row) => ({
        ...row,
        details: safeParseJson(row.details_json),
      })),
      total,
      page,
      pageSize,
      totalPages: total > 0 ? Math.ceil(total / pageSize) : 0,
      summary: {
        pageViews,
        apiActions,
        actions,
        lastSeenAt,
      },
    };
  } catch (error) {
    log.error("[UserActivity] Failed to list activity:", error);
    return {
      entries: [],
      total: 0,
      page,
      pageSize,
      totalPages: 0,
      summary: { pageViews: 0, apiActions: 0, actions: 0, lastSeenAt: null },
      error: error.message || String(error),
    };
  }
}
