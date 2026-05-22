import { json } from "@sveltejs/kit";
import { getRunnerInstances, createRunnerJob } from "$lib/db/local-runners.js";

function getEnv(platform, name) {
  return platform?.env?.[name] ?? (typeof process !== "undefined" ? process.env?.[name] : undefined);
}

function checkIsBotRequest(request, platform) {
  const authHeader = request.headers.get("Authorization");
  const botToken = getEnv(platform, "DISCORD_BOT_TOKEN");
  return Boolean(botToken) && authHeader === `Bot ${botToken}`;
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
  if (!userId || !content.trim()) {
    return json({ error: "userId and content are required" }, { status: 400 });
  }

  const instances = await getRunnerInstances(db, userId, { limit: 100 });
  if (!instances.length) {
    return json({ dispatched: false, reason: "no_runner" });
  }

  // Prefer an online instance; otherwise fall back to the most-recently-seen one.
  const online = instances.filter((i) => i.is_online);
  const target = online[0] || instances[0];
  if (!target) {
    return json({ dispatched: false, reason: "no_runner" });
  }

  const payload = {
    user_id: userId,
    user_name: typeof body?.userName === "string" ? body.userName : null,
    message: content,
    history: Array.isArray(body?.history) ? body.history.slice(-20) : [],
    provider_chain: Array.isArray(body?.providerChain) ? body.providerChain : undefined,
    response_target: {
      type: "discord_dm",
      user_id: userId,
      source: "gateway_dm",
    },
    received_at: new Date().toISOString(),
  };

  const result = await createRunnerJob(db, userId, target.runner_token_id, {
    job_type: "dm",
    label: `DM from ${payload.user_name || userId}`,
    target_instance_id: target.id,
    payload_json: payload,
    priority: 10,
    max_attempts: 1,
    timeout_seconds: 300,
  });

  if (!result.success) {
    return json({ dispatched: false, reason: "dispatch_failed", error: result.error }, { status: 500 });
  }

  return json({
    dispatched: true,
    jobId: result.jobId,
    runner: {
      id: target.id,
      display_name: target.display_name,
      hostname: target.hostname,
      is_online: Boolean(target.is_online),
    },
  });
}
