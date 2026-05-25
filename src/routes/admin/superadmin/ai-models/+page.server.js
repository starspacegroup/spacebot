import { redirect } from "@sveltejs/kit";
import {
  getCachedWorkersAICatalog,
  getModelSelection,
  isCatalogStale,
  syncWorkersAICatalog,
} from "$lib/server/workers-ai-models.js";
import { DEFAULT_MODEL } from "$lib/ai/chat.js";

function checkIsSuperAdmin(userId, platform) {
  if (!userId) return false;
  const adminUserIds =
    platform?.env?.ADMIN_USER_IDS ||
    (typeof process !== "undefined" ? process.env?.ADMIN_USER_IDS : undefined) ||
    "";
  return adminUserIds
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .includes(userId);
}

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform }) {
  const userId = cookies.get("discord_user_id");
  if (!checkIsSuperAdmin(userId, platform)) {
    throw redirect(302, "/admin");
  }

  const db = platform?.env?.DB;

  const [cached, envModel] = await Promise.all([
    getCachedWorkersAICatalog(db),
    Promise.resolve(
      platform?.env?.CLOUDFLARE_AI_MODEL ||
        (typeof process !== "undefined" ? process.env?.CLOUDFLARE_AI_MODEL : undefined) ||
        DEFAULT_MODEL,
    ),
  ]);

  let { models, syncedAt } = cached;
  const stale = isCatalogStale(syncedAt);
  let source = "cache";
  let warning = null;

  if (stale || models.length === 0) {
    try {
      const synced = await syncWorkersAICatalog(db, platform);
      models = synced.models;
      syncedAt = synced.syncedAt;
      source = "cloudflare";
    } catch (err) {
      warning = `Could not sync from Cloudflare: ${err.message}`;
    }
  }

  const selection = await getModelSelection(db, envModel);

  return {
    catalog: models,
    syncedAt,
    stale: isCatalogStale(syncedAt),
    source,
    warning,
    selection,
    defaults: { envModel },
  };
}
