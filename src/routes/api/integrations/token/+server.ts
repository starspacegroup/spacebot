/**
 * Superadmin Integration Token Management
 *
 * POST /api/integrations/token  — Generate a new token for an integration
 * DELETE /api/integrations/token — Revoke an integration's token
 *
 * Superadmin only (checked via ADMIN_USER_IDS).
 */

import { json } from "@sveltejs/kit";
import { log } from "$lib/db/logger.js";
import { createIntegrationToken, revokeIntegrationToken } from "$lib/db/integrations.js";

/**
 * Check if user is a superadmin
 */
function isSuperAdmin(cookies, platform) {
  const userId = cookies.get("discord_user_id");
  if (!userId) return false;

  const adminUserIds =
    (platform as any)?.env?.ADMIN_USER_IDS ||
    (typeof process !== "undefined" ? process.env?.ADMIN_USER_IDS : "") ||
    "";

  return adminUserIds
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .includes(userId);
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ request, cookies, platform }) {
  if (!isSuperAdmin(cookies, platform)) {
    return json({ error: "Unauthorized" }, { status: 403 });
  }

  const db = (platform as any)?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 500 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { integrationId, slug } = body;
  if (!integrationId || !slug) {
    return json({ error: "integrationId and slug are required" }, { status: 400 });
  }

  const result = await createIntegrationToken(db, integrationId, slug);

  if (!result.success) {
    return json({ error: result.error }, { status: 500 });
  }

  log.info(`[Superadmin] Generated integration token for ${slug}`);

  return json({ success: true, token: result.token });
}

/** @type {import('./$types').RequestHandler} */
export async function DELETE({ request, cookies, platform }) {
  if (!isSuperAdmin(cookies, platform)) {
    return json({ error: "Unauthorized" }, { status: 403 });
  }

  const db = (platform as any)?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 500 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { integrationId } = body;
  if (!integrationId) {
    return json({ error: "integrationId is required" }, { status: 400 });
  }

  const result = await revokeIntegrationToken(db, integrationId);

  if (!result.success) {
    return json({ error: result.error }, { status: 500 });
  }

  log.info(`[Superadmin] Revoked integration token for ${integrationId}`);

  return json({ success: true });
}
