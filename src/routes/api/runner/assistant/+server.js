import { json } from "@sveltejs/kit";
import { validateRunnerToken } from "$lib/db/local-runners.js";
import { getLatestAIContextSnapshotForUser } from "$lib/db/ai-orchestration.js";
import { generateChatResponse, isAIEnabled } from "$lib/ai/chat.js";
import { resolveRuntimeModelConfig } from "$lib/server/workers-ai-models.js";

function getEnv(platform, name) {
  return platform?.env?.[name] ?? (typeof process !== "undefined" ? process.env?.[name] : undefined);
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .slice(-20)
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      role: typeof entry.role === "string" ? entry.role : "user",
      content: typeof entry.content === "string" ? entry.content : "",
    }))
    .filter((entry) => entry.content.trim());
}

function normalizeSelectedGuild(selectedGuild, selectedGuildId, selectedGuildName, managedGuilds) {
  if (selectedGuild && typeof selectedGuild === "object") {
    return selectedGuild;
  }

  const normalizedId = typeof selectedGuildId === "string" ? selectedGuildId.trim() : "";
  if (!normalizedId) return null;

  const fromManaged = Array.isArray(managedGuilds)
    ? managedGuilds.find((guild) => guild?.id === normalizedId)
    : null;
  if (fromManaged) return fromManaged;

  return {
    id: normalizedId,
    name: typeof selectedGuildName === "string" && selectedGuildName.trim() ? selectedGuildName.trim() : normalizedId,
  };
}

export async function POST({ request, platform }) {
  const db = platform?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 503 });
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  const rawToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const clientIp =
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
    null;

  const auth = await validateRunnerToken(db, rawToken, clientIp);
  if (!auth.valid) {
    return json({ error: auth.error ?? "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, { status: 400 });
  }

  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) {
    return json({ error: "message is required" }, { status: 400 });
  }

  const envModel = getEnv(platform, "CLOUDFLARE_AI_MODEL");
  const runtimeModelConfig = await resolveRuntimeModelConfig(db, envModel);
  const env = {
    CLOUDFLARE_ACCOUNT_ID: getEnv(platform, "CLOUDFLARE_ACCOUNT_ID"),
    CLOUDFLARE_AI_TOKEN: getEnv(platform, "CLOUDFLARE_AI_TOKEN"),
    CLOUDFLARE_API_TOKEN: getEnv(platform, "CLOUDFLARE_API_TOKEN"),
    CLOUDFLARE_AI_GATEWAY_ID: getEnv(platform, "CLOUDFLARE_AI_GATEWAY_ID"),
    CLOUDFLARE_AI_MODEL: runtimeModelConfig.primaryModelId || envModel,
    CLOUDFLARE_AI_MODELS: runtimeModelConfig.candidateModelIds,
    CLOUDFLARE_AI_MODEL_ROUTING: runtimeModelConfig.routingStrategy,
    DISCORD_BOT_TOKEN: getEnv(platform, "DISCORD_BOT_TOKEN"),
    DISCORD_CLIENT_ID: getEnv(platform, "DISCORD_CLIENT_ID"),
    DB: db,
  };

  if (!isAIEnabled(env)) {
    return json({ error: "AI features are not enabled" }, { status: 503 });
  }

  const snapshot = await getLatestAIContextSnapshotForUser(db, auth.userId);
  const managedGuilds = Array.isArray(body?.managedGuilds)
    ? body.managedGuilds
    : (Array.isArray(snapshot?.managedGuilds) ? snapshot.managedGuilds : []);
  const selectedGuild = normalizeSelectedGuild(
    body?.selectedGuild,
    body?.selectedGuildId ?? snapshot?.selectedGuild?.id ?? null,
    body?.selectedGuildName ?? snapshot?.selectedGuild?.name ?? null,
    managedGuilds,
  );
  const userName = typeof body?.userName === "string" && body.userName.trim()
    ? body.userName.trim()
    : (snapshot?.userName || "User");
  const isSuperAdmin = typeof body?.isSuperAdmin === "boolean"
    ? body.isSuperAdmin
    : Boolean(snapshot?.metadata?.isSuperAdmin);

  const result = await generateChatResponse({
    message,
    userName,
    userId: auth.userId,
    history: normalizeHistory(body?.history),
    managedGuilds,
    selectedGuild,
    selectedGuildId: selectedGuild?.id || null,
    selectedGuildName: selectedGuild?.name || null,
    maxToolIterations: Number(body?.maxToolIterations) || 5,
    isSuperAdmin,
  }, env);

  if (!result.success) {
    return json({ error: result.error || "Failed to generate response" }, { status: 500 });
  }

  return json({
    success: true,
    response: result.response,
    toolsUsed: result.toolsUsed || [],
    contextSource: Array.isArray(body?.managedGuilds) || body?.selectedGuild ? "payload" : (snapshot ? "snapshot" : "none"),
    managedGuildCount: managedGuilds.length,
    selectedGuildId: selectedGuild?.id || null,
  });
}