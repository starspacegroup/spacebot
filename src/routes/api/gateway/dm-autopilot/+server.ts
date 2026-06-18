import { json } from "@sveltejs/kit";
import { createAIJob, appendAIJobEvent } from "$lib/db/ai-orchestration.js";

function getEnv(platform, name) {
  return platform?.env?.[name] ?? (typeof process !== "undefined" ? process.env?.[name] : undefined);
}

function checkIsBotRequest(request, platform) {
  const authHeader = request.headers.get("Authorization");
  const botToken = getEnv(platform, "DISCORD_BOT_TOKEN");
  return Boolean(botToken) && authHeader === `Bot ${botToken}`;
}

export async function POST({ request, platform }) {
  if (!checkIsBotRequest(request, platform)) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = (platform as any)?.env?.DB;
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
  const userName = typeof body?.userName === "string" ? body.userName.trim() : null;
  const message = typeof body?.content === "string" ? body.content.trim() : "";
  const history = Array.isArray(body?.history) ? body.history.slice(-20) : [];
  const managedGuilds = Array.isArray(body?.managedGuilds) ? body.managedGuilds : [];
  const selectedGuild = body?.selectedGuild && typeof body.selectedGuild === "object"
    ? body.selectedGuild
    : null;

  if (!userId || !message) {
    return json({ error: "userId and content are required" }, { status: 400 });
  }

  const createResult = await createAIJob(db, {
    source: "gateway_dm",
    userId,
    userName,
    guildId: selectedGuild?.id || null,
    requestText: message,
    history,
    managedGuilds,
    selectedGuild,
    responseTarget: {
      type: "discord_dm",
      user_id: userId,
      source: "gateway_dm",
    },
    providerChain: Array.isArray(body?.providerChain) ? body.providerChain : [],
    metadata: {
      requestedAt: new Date().toISOString(),
      maxToolIterations: body?.maxToolIterations ?? null,
      isSuperAdmin: Boolean(body?.isSuperAdmin),
    },
    timeoutSeconds: 330,
    maxAttempts: 6,
  });

  if (!createResult.success) {
    return json({ queued: false, error: createResult.error || "Failed to queue AI job" }, { status: 500 });
  }

  const queue = (platform as any)?.env?.AI_AUTOPILOT_QUEUE;
  let queueAccepted = false;
  let queueError = null;

  if (queue && typeof queue.send === "function") {
    try {
      await queue.send({
        type: "ai_job_created",
        jobId: createResult.jobId,
        correlationId: createResult.correlationId,
      });
      queueAccepted = true;
      await appendAIJobEvent(db, createResult.jobId, {
        eventType: "job.enqueued",
        source: "gateway_dm",
        step: "queue_submit",
        message: "Job pushed to Cloudflare Queue",
      });
    } catch (err) {
      queueError = err?.message || "Queue send failed";
      await appendAIJobEvent(db, createResult.jobId, {
        eventType: "job.queue_submit_failed",
        source: "gateway_dm",
        step: "queue_submit",
        message: "Queue push failed; watchdog can recover this pending job",
        metadata: { error: queueError },
      });
    }
  }

  return json({
    queued: true,
    jobId: createResult.jobId,
    correlationId: createResult.correlationId,
    queueAccepted,
    queueError,
  });
}
