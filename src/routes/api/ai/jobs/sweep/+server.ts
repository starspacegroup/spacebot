import { json } from "@sveltejs/kit";
import {
  appendAIJobEvent,
  getDuePendingAIJobs,
  recoverStaleRunningAIJobs,
} from "$lib/db/ai-orchestration.js";

function getEnv(platform, name) {
  return platform?.env?.[name] ?? (typeof process !== "undefined" ? process.env?.[name] : undefined);
}

function checkIsAutopilotRequest(request, platform) {
  const authHeader = request.headers.get("Authorization") || "";
  const internalKey = getEnv(platform, "AI_AUTOPILOT_INTERNAL_KEY");
  if (internalKey && authHeader === `Bearer ${internalKey}`) {
    return true;
  }

  const botToken = getEnv(platform, "DISCORD_BOT_TOKEN");
  return Boolean(botToken) && authHeader === `Bot ${botToken}`;
}

export async function POST({ request, platform }) {
  if (!checkIsAutopilotRequest(request, platform)) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = (platform as any)?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 503 });
  }

  const queue = (platform as any)?.env?.AI_AUTOPILOT_QUEUE;
  const recovered = await recoverStaleRunningAIJobs(db);
  const pending = await getDuePendingAIJobs(db, 50);

  let queuedCount = 0;
  let queueErrors = 0;

  for (const job of pending) {
    if (!queue || typeof queue.send !== "function") {
      break;
    }

    try {
      await queue.send({ type: "ai_job_due", jobId: job.id, correlationId: job.correlation_id });
      queuedCount += 1;
      await appendAIJobEvent(db, job.id, {
        eventType: "job.requeued",
        source: "autopilot_watchdog",
        step: "sweep_requeue",
        message: "Pending job was requeued by watchdog",
      });
    } catch (err) {
      queueErrors += 1;
      await appendAIJobEvent(db, job.id, {
        eventType: "job.requeue_failed",
        source: "autopilot_watchdog",
        step: "sweep_requeue",
        message: "Watchdog failed to enqueue pending job",
        metadata: { error: err?.message || "unknown" },
      });
    }
  }

  return json({
    ok: true,
    recovered,
    pendingDue: pending.length,
    queuedCount,
    queueErrors,
  });
}
