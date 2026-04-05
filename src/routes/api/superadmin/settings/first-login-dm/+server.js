import { json } from "@sveltejs/kit";
import {
  getFirstLoginDmEnabled,
  setFirstLoginDmEnabled,
} from "$lib/server/superadmin-notifications.js";

function checkIsSuperAdmin(userId, platform) {
  if (!userId) return false;
  const adminUserIds = platform?.env?.ADMIN_USER_IDS || process.env.ADMIN_USER_IDS || "";
  return adminUserIds.split(",").map((id) => id.trim()).filter(Boolean).includes(userId);
}

export async function GET({ cookies, platform }) {
  const userId = cookies.get("discord_user_id");
  if (!checkIsSuperAdmin(userId, platform)) {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  const db = platform?.env?.DB;
  if (!db) {
    return json({ error: "Database unavailable" }, { status: 503 });
  }

  const enabled = await getFirstLoginDmEnabled(db);
  return json({ enabled });
}

export async function PATCH({ cookies, platform, request }) {
  const userId = cookies.get("discord_user_id");
  if (!checkIsSuperAdmin(userId, platform)) {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  const db = platform?.env?.DB;
  if (!db) {
    return json({ error: "Database unavailable" }, { status: 503 });
  }

  try {
    const body = await request.json();
    if (typeof body.enabled !== "boolean") {
      return json({ error: "enabled must be a boolean" }, { status: 400 });
    }

    const result = await setFirstLoginDmEnabled(db, body.enabled);
    if (!result.success) {
      return json({ error: result.error || "Failed to update setting" }, { status: 500 });
    }

    return json({ success: true, enabled: body.enabled });
  } catch {
    return json({ error: "Invalid request body" }, { status: 400 });
  }
}