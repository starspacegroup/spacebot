import { json } from "@sveltejs/kit";
import { getRunnerInstances, createRunnerJob } from "$lib/db/local-runners.js";
import { getUserPreferences } from "$lib/db/users.js";
import { evaluateLocalRunnerAssistAccess } from "$lib/local-runner-assist-policy.js";

const SCREENSHOT_REQUEST_RE = /\b(screenshot|screen\s*shot|screen\s*capture|capture\s+(?:the\s+)?screen)\b/i;
const TARGET_HINT_RE = /\b(?:of|on|from|at|for)\s+([a-z0-9._-]{3,})\b/i;

function getEnv(platform, name) {
  return platform?.env?.[name] ?? (typeof process !== "undefined" ? process.env?.[name] : undefined);
}

function checkIsBotRequest(request, platform) {
  const authHeader = request.headers.get("Authorization");
  const botToken = getEnv(platform, "DISCORD_BOT_TOKEN");
  return Boolean(botToken) && authHeader === `Bot ${botToken}`;
}

function sanitizeForMatch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, " ")
    .trim();
}

function hasExplicitRunnerReference(instances, content) {
  if (!Array.isArray(instances) || instances.length === 0) return false;

  const contentLower = String(content || "").toLowerCase();
  const normalizedContent = sanitizeForMatch(content);
  const hint = TARGET_HINT_RE.exec(contentLower)?.[1]?.trim().toLowerCase() || null;

  for (const instance of instances) {
    const names = [instance.display_name, instance.hostname, instance.token_name]
      .filter((value) => typeof value === "string" && value.trim().length > 0)
      .map((value) => value.trim());

    for (const name of names) {
      const lowerName = name.toLowerCase();
      const normalizedName = sanitizeForMatch(name);
      if (!lowerName) continue;

      if (hint && (lowerName.includes(hint) || hint.includes(lowerName))) {
        return true;
      }

      if (contentLower.includes(lowerName)) {
        return true;
      }

      if (normalizedName && normalizedContent.includes(normalizedName)) {
        return true;
      }
    }
  }

  return false;
}

function chooseTargetRunner(instances, content) {
  if (!Array.isArray(instances) || instances.length === 0) return null;

  const contentLower = String(content || "").toLowerCase();
  const normalizedContent = sanitizeForMatch(content);
  const hint = TARGET_HINT_RE.exec(contentLower)?.[1]?.trim().toLowerCase() || null;

  const scored = instances
    .map((instance) => {
      const names = [instance.display_name, instance.hostname, instance.token_name]
        .filter((value) => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim());

      let score = instance.is_online ? 10 : 0;

      for (const name of names) {
        const lowerName = name.toLowerCase();
        const normalizedName = sanitizeForMatch(name);

        if (hint && (lowerName.includes(hint) || hint.includes(lowerName))) {
          score += 100;
        }

        if (contentLower.includes(lowerName)) {
          score += 60;
        }

        if (normalizedName && normalizedContent.includes(normalizedName)) {
          score += 30;
        }
      }

      return { instance, score };
    })
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return null;
  if (scored[0].score > 0) return scored[0].instance;

  const online = instances.find((instance) => instance.is_online);
  return online || instances[0];
}

function inferDmJob(content, userId, userName, history, targetInstance, context = {}) {
  const isScreenshotRequest = SCREENSHOT_REQUEST_RE.test(content || "");
  const managedGuilds = Array.isArray(context.managedGuilds) ? context.managedGuilds : [];
  const selectedGuild = context.selectedGuild && typeof context.selectedGuild === "object"
    ? context.selectedGuild
    : null;
  const selectedGuildId = typeof context.selectedGuildId === "string" && context.selectedGuildId.trim()
    ? context.selectedGuildId.trim()
    : (typeof selectedGuild?.id === "string" ? selectedGuild.id.trim() : null);

  if (isScreenshotRequest) {
    return {
      jobType: "screenshot_capture",
      label: `Screenshot request from ${userName || userId}`,
      priority: 20,
      timeoutSeconds: 120,
      payload: {
        mode: "all_displays",
        includeWorkspaceContext: false,
        response_target: {
          type: "discord_dm",
          user_id: userId,
          source: "gateway_dm",
        },
        requested_runner: {
          id: targetInstance?.id ?? null,
          display_name: targetInstance?.display_name ?? null,
          hostname: targetInstance?.hostname ?? null,
        },
        request_text: content,
        received_at: new Date().toISOString(),
      },
    };
  }

  return {
    jobType: "dm",
    label: `DM from ${userName || userId}`,
    priority: 10,
    timeoutSeconds: 300,
    payload: {
      user_id: userId,
      user_name: typeof userName === "string" ? userName : null,
      message: content,
      history,
      managedGuilds,
      selectedGuild,
      selectedGuildId,
      response_target: {
        type: "discord_dm",
        user_id: userId,
        source: "gateway_dm",
      },
      received_at: new Date().toISOString(),
    },
  };
}

/**
 * POST /api/gateway/dm-runner
 *
 * Called by the Discord gateway when a DM arrives. If the user has at least
 * one registered local runner, dispatch the DM as a job to that runner and
 * return { dispatched: true, ... }. Otherwise return { dispatched: false }
 * so the gateway can fall back to Workers AI.
 *
 * Body: { userId, userName?, content, history? }
 */
export async function POST({ request, platform }) {
  if (!checkIsBotRequest(request, platform)) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = platform?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 503 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, { status: 400 });
  }

  const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
  const content = typeof body?.content === "string" ? body.content : "";
  const managedGuilds = Array.isArray(body?.managedGuilds) ? body.managedGuilds : [];
  const selectedGuild = body?.selectedGuild && typeof body.selectedGuild === "object"
    ? body.selectedGuild
    : null;
  const selectedGuildId = typeof body?.selectedGuild?.id === "string"
    ? body.selectedGuild.id.trim()
    : (typeof body?.selectedGuildId === "string" ? body.selectedGuildId.trim() : "");
  if (!userId || !content.trim()) {
    return json({ error: "userId and content are required" }, { status: 400 });
  }

  const access = await evaluateLocalRunnerAssistAccess(db, { guildId: selectedGuildId, userId });
  if (!access.allowed) {
    return json({ dispatched: false, reason: access.reason });
  }

  const isScreenshotRequest = SCREENSHOT_REQUEST_RE.test(content || "");
  const preferences = await getUserPreferences(db, userId);
  const preferLocalRunnerForDM = Boolean(preferences?.runnerUi?.preferLocalRunnerForDM);

  const instances = await getRunnerInstances(db, userId, { limit: 100 });
  if (!instances.length) {
    return json({ dispatched: false, reason: "no_runner" });
  }

  const explicitRunnerReference = hasExplicitRunnerReference(instances, content);

  // DM chat takeover is opt-in at the account level.
  // Screenshot requests and explicit runner-targeted messages bypass this toggle.
  if (!isScreenshotRequest && !preferLocalRunnerForDM && !explicitRunnerReference) {
    return json({ dispatched: false, reason: "preference_disabled" });
  }

  const candidateInstances = !isScreenshotRequest
    ? instances.filter((instance) => Boolean(instance?.is_online))
    : instances;

  if (!candidateInstances.length) {
    return json({ dispatched: false, reason: "no_active_runner" });
  }

  const target = chooseTargetRunner(candidateInstances, content);
  if (!target) {
    return json({ dispatched: false, reason: "no_runner" });
  }

  const history = Array.isArray(body?.history) ? body.history.slice(-20) : [];
  const inferredJob = inferDmJob(content, userId, body?.userName, history, target, {
    managedGuilds,
    selectedGuild,
    selectedGuildId,
  });
  const payload = {
    ...inferredJob.payload,
    guild_id: access.guildId,
    provider_chain: Array.isArray(body?.providerChain) ? body.providerChain : undefined,
  };

  const result = await createRunnerJob(db, userId, target.runner_token_id, {
    job_type: inferredJob.jobType,
    label: inferredJob.label,
    target_instance_id: target.id,
    payload_json: payload,
    priority: inferredJob.priority,
    max_attempts: 1,
    timeout_seconds: inferredJob.timeoutSeconds,
  });

  if (!result.success) {
    return json({ dispatched: false, reason: "dispatch_failed", error: result.error }, { status: 500 });
  }

  return json({
    dispatched: true,
    jobId: result.jobId,
    jobType: inferredJob.jobType,
    runner: {
      id: target.id,
      display_name: target.display_name,
      hostname: target.hostname,
      is_online: Boolean(target.is_online),
    },
  });
}
