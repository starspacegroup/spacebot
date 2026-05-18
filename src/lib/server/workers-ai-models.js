import { getGlobalSetting, setGlobalSetting } from "$lib/db/global-settings.js";
import { log } from "$lib/log.js";

export const WORKERS_AI_CATALOG_KEY = "workers_ai_model_catalog_v1";
export const WORKERS_AI_CATALOG_SYNCED_AT_KEY = "workers_ai_model_catalog_synced_at";
export const WORKERS_AI_SELECTION_KEY = "workers_ai_model_selection_v1";

const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_MODELS_PER_PAGE = 100;

function getEnv(name, platform) {
  return platform?.env?.[name] ?? (typeof process !== "undefined" ? process.env?.[name] : undefined);
}

function parseJsonSafe(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

function toLowerTrimmedSet(values) {
  return new Set(
    toArray(values)
      .map((v) => String(v || "").trim().toLowerCase())
      .filter(Boolean),
  );
}

function normalizeModel(raw) {
  const id = String(raw?.id || raw?.name || raw?.model || "").trim();

  const taskNames = toArray(raw?.task || raw?.tasks)
    .map((task) => (typeof task === "string" ? task : task?.name || task?.label || ""))
    .map((task) => String(task || "").trim())
    .filter(Boolean);

  const tagValues = [
    ...toArray(raw?.tags),
    ...toArray(raw?.capabilities),
    ...taskNames,
  ]
    .map((tag) => (typeof tag === "string" ? tag : tag?.name || tag?.label || ""))
    .map((tag) => String(tag || "").trim())
    .filter(Boolean);

  const tagSet = toLowerTrimmedSet(tagValues);

  const isBeta =
    raw?.beta === true ||
    raw?.is_beta === true ||
    raw?.experimental === true ||
    raw?.is_experimental === true ||
    tagSet.has("beta") ||
    tagSet.has("experimental");

  const isDeprecated =
    raw?.deprecated === true ||
    raw?.is_deprecated === true ||
    raw?.planned_deprecation === true ||
    tagSet.has("planned deprecation") ||
    tagSet.has("deprecated") ||
    tagSet.has("deprecation");

  return {
    id,
    name: String(raw?.name || id || "Unknown model"),
    description: String(raw?.description || raw?.summary || "").trim(),
    author:
      typeof raw?.author === "string"
        ? raw.author
        : raw?.author?.name || raw?.provider || "Unknown",
    source:
      typeof raw?.source === "string"
        ? raw.source
        : raw?.source?.name || "Hosted",
    tasks: taskNames,
    tags: tagValues,
    isBeta,
    isExperimental: raw?.experimental === true || raw?.is_experimental === true,
    isDeprecated,
    contextWindow: raw?.context_window || raw?.contextWindow || null,
    pricing: raw?.pricing || raw?.price || raw?.cost || null,
    homepage: raw?.homepage || raw?.url || raw?.documentation_url || null,
    raw,
  };
}

function normalizeCatalog(rawModels) {
  const models = toArray(rawModels)
    .map(normalizeModel)
    .filter((m) => m.id);

  models.sort((a, b) => {
    if (a.isBeta !== b.isBeta) return a.isBeta ? 1 : -1;
    if (a.isDeprecated !== b.isDeprecated) return a.isDeprecated ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  return models;
}

export async function fetchWorkersAIModelsFromCloudflare(platform) {
  const accountId = getEnv("CLOUDFLARE_ACCOUNT_ID", platform);
  const apiToken =
    getEnv("CLOUDFLARE_API_TOKEN", platform) ||
    getEnv("CLOUDFLARE_AI_TOKEN", platform);

  if (!accountId || !apiToken) {
    throw new Error("Cloudflare account ID or API token is not configured");
  }

  let page = 1;
  const all = [];

  while (page < 50) {
    const params = new URLSearchParams({
      page: String(page),
      per_page: String(MAX_MODELS_PER_PAGE),
    });

    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search?${params}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Cloudflare model API error (${response.status}): ${errorText.slice(0, 200)}`,
      );
    }

    const payload = await response.json();
    const pageModels = toArray(payload?.result);
    all.push(...pageModels);

    if (pageModels.length < MAX_MODELS_PER_PAGE) break;
    page += 1;
  }

  return normalizeCatalog(all);
}

export async function getCachedWorkersAICatalog(db) {
  if (!db) return { models: [], syncedAt: null };

  const [catalogJson, syncedAt] = await Promise.all([
    getGlobalSetting(db, WORKERS_AI_CATALOG_KEY, "[]"),
    getGlobalSetting(db, WORKERS_AI_CATALOG_SYNCED_AT_KEY, null),
  ]);

  const models = parseJsonSafe(catalogJson || "[]", []);
  return {
    models: Array.isArray(models) ? models : [],
    syncedAt,
  };
}

export function isCatalogStale(syncedAt) {
  if (!syncedAt) return true;
  const last = new Date(syncedAt).getTime();
  if (!Number.isFinite(last)) return true;
  return Date.now() - last > CATALOG_TTL_MS;
}

export async function saveWorkersAICatalog(db, models) {
  if (!db) return { success: false, error: "Database unavailable" };

  const syncedAt = new Date().toISOString();
  const writes = await Promise.all([
    setGlobalSetting(db, WORKERS_AI_CATALOG_KEY, JSON.stringify(models || [])),
    setGlobalSetting(db, WORKERS_AI_CATALOG_SYNCED_AT_KEY, syncedAt),
  ]);

  const failed = writes.find((w) => !w.success);
  if (failed) return { success: false, error: failed.error || "Failed to persist catalog" };

  return { success: true, syncedAt };
}

export async function getModelSelection(db, fallbackModel) {
  const fallback = {
    selectedModelIds: fallbackModel ? [fallbackModel] : [],
    primaryModelId: fallbackModel || null,
    routingStrategy: "fallback",
  };

  if (!db) return fallback;

  const raw = await getGlobalSetting(db, WORKERS_AI_SELECTION_KEY, null);
  if (!raw) return fallback;

  const parsed = parseJsonSafe(raw, null);
  if (!parsed || typeof parsed !== "object") return fallback;

  const selectedModelIds = Array.from(
    new Set(
      toArray(parsed.selectedModelIds)
        .map((id) => String(id || "").trim())
        .filter(Boolean),
    ),
  );
  const primaryModelId =
    String(parsed.primaryModelId || selectedModelIds[0] || "").trim() || null;
  const routingStrategy =
    parsed.routingStrategy === "round_robin" ? "round_robin" : "fallback";

  return { selectedModelIds, primaryModelId, routingStrategy };
}

export async function saveModelSelection(db, selection) {
  if (!db) return { success: false, error: "Database unavailable" };

  const selectedModelIds = Array.from(
    new Set(
      toArray(selection?.selectedModelIds)
        .map((id) => String(id || "").trim())
        .filter(Boolean),
    ),
  );
  const primaryModelId =
    String(selection?.primaryModelId || selectedModelIds[0] || "").trim() || null;
  const routingStrategy =
    selection?.routingStrategy === "round_robin" ? "round_robin" : "fallback";

  const payload = {
    selectedModelIds,
    primaryModelId,
    routingStrategy,
    updatedAt: new Date().toISOString(),
  };

  return setGlobalSetting(db, WORKERS_AI_SELECTION_KEY, JSON.stringify(payload));
}

export async function resolveRuntimeModelConfig(db, fallbackModel) {
  const selection = await getModelSelection(db, fallbackModel);

  const ordered = [];
  if (selection.primaryModelId) ordered.push(selection.primaryModelId);
  for (const id of selection.selectedModelIds) {
    if (!ordered.includes(id)) ordered.push(id);
  }
  if (ordered.length === 0 && fallbackModel) ordered.push(fallbackModel);

  return {
    primaryModelId: ordered[0] || null,
    candidateModelIds: ordered,
    routingStrategy: selection.routingStrategy,
  };
}

export async function syncWorkersAICatalog(db, platform) {
  const models = await fetchWorkersAIModelsFromCloudflare(platform);
  const saved = await saveWorkersAICatalog(db, models);

  if (!saved.success) {
    throw new Error(saved.error || "Failed to save Workers AI catalog");
  }

  log.info(`[WorkersAI] Synced ${models.length} model(s)`);
  return { models, syncedAt: saved.syncedAt };
}
