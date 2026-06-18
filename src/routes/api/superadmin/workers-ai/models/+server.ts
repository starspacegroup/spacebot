import {
  getCachedWorkersAICatalog,
  getModelSelection,
  isCatalogStale,
  saveModelSelection,
  syncWorkersAICatalog,
} from "$lib/server/workers-ai-models.js";
import { DEFAULT_MODEL } from "$lib/ai/chat.js";

function getAdminUserIds(platform) {
  const raw =
    (platform as any)?.env?.ADMIN_USER_IDS ??
    (typeof process !== "undefined" ? process.env?.ADMIN_USER_IDS : undefined) ??
    "";
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

function checkIsSuperAdmin(userId, platform) {
  const adminIds = getAdminUserIds(platform);
  return userId && adminIds.includes(userId);
}

export async function GET({ cookies, platform, url }) {
  const userId = cookies.get("discord_user_id");
  if (!checkIsSuperAdmin(userId, platform)) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
  }

  const db = (platform as any)?.env?.DB;
  const force = url.searchParams.get("force") === "1";

  try {
    let { models, syncedAt } = await getCachedWorkersAICatalog(db);
    let stale = isCatalogStale(syncedAt);
    let source = "database";
    let warning =
      models.length === 0
        ? "No cached model catalog found. Run a Workers AI catalog sync job or use force sync."
        : null;

    if (force) {
      try {
        const synced = await syncWorkersAICatalog(db, platform);
        models = synced.models;
        syncedAt = synced.syncedAt;
        stale = isCatalogStale(syncedAt);
        source = "cloudflare";
        warning = null;
      } catch (err) {
        warning = `Could not sync from Cloudflare: ${err.message}`;
        if (models.length === 0) {
          return new Response(
            JSON.stringify({ success: false, error: warning }),
            { status: 502 },
          );
        }
      }
    }

    const fallbackModel =
      (platform as any)?.env?.CLOUDFLARE_AI_MODEL ||
      (typeof process !== "undefined" ? process.env?.CLOUDFLARE_AI_MODEL : undefined) ||
      DEFAULT_MODEL;
    const selection = await getModelSelection(db, fallbackModel);

    return new Response(
      JSON.stringify({ success: true, source, syncedAt, stale, warning, selection, models }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500 });
  }
}

export async function PATCH({ request, cookies, platform }) {
  const userId = cookies.get("discord_user_id");
  if (!checkIsSuperAdmin(userId, platform)) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
  }

  const db = (platform as any)?.env?.DB;
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }

  const { selectedModelIds, primaryModelId, routingStrategy } = body;

  if (!Array.isArray(selectedModelIds)) {
    return new Response(JSON.stringify({ error: "selectedModelIds must be an array" }), {
      status: 400,
    });
  }
  if (selectedModelIds.length > 50) {
    return new Response(JSON.stringify({ error: "Too many models selected (max 50)" }), {
      status: 400,
    });
  }

  try {
    const result = await saveModelSelection(db, { selectedModelIds, primaryModelId, routingStrategy });
    if (!result?.success) {
      return new Response(JSON.stringify({ error: result?.error || "Failed to save" }), { status: 500 });
    }

    const fallbackModel =
      (platform as any)?.env?.CLOUDFLARE_AI_MODEL ||
      (typeof process !== "undefined" ? process.env?.CLOUDFLARE_AI_MODEL : undefined) ||
      DEFAULT_MODEL;
    const selection = await getModelSelection(db, fallbackModel);

    return new Response(JSON.stringify({ success: true, selection }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500 });
  }
}
