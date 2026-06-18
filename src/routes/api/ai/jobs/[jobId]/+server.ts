import { json } from "@sveltejs/kit";
import { getAIJobById, getAIJobEvents } from "$lib/db/ai-orchestration.js";

function getEnv(platform, name) {
  return platform?.env?.[name] ?? (typeof process !== "undefined" ? process.env?.[name] : undefined);
}

function isBotOrInternalRequest(request, platform) {
  const authHeader = request.headers.get("Authorization") || "";
  const internalKey = getEnv(platform, "AI_AUTOPILOT_INTERNAL_KEY");
  if (internalKey && authHeader === `Bearer ${internalKey}`) return true;

  const botToken = getEnv(platform, "DISCORD_BOT_TOKEN");
  return Boolean(botToken) && authHeader === `Bot ${botToken}`;
}

export async function GET({ params, platform, cookies, request }) {
  const db = (platform as any)?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 503 });
  }

  const jobKey = String(params.jobId || "").trim();
  if (!jobKey) {
    return json({ error: "jobId is required" }, { status: 400 });
  }

  let job;
  if (/^\d+$/.test(jobKey)) {
    job = await getAIJobById(db, Number(jobKey));
  } else {
    job = await db
      .prepare("SELECT * FROM ai_jobs WHERE correlation_id = ?")
      .bind(jobKey)
      .first();
  }

  if (!job) {
    return json({ error: "Job not found" }, { status: 404 });
  }

  const requesterUserId = cookies.get("discord_user_id");
  const serviceCaller = isBotOrInternalRequest(request, platform);
  if (!serviceCaller && (!requesterUserId || requesterUserId !== job.user_id)) {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  const events = await getAIJobEvents(db, job.id, 500);

  return json({
    job: {
      id: job.id,
      correlationId: job.correlation_id,
      status: job.status,
      source: job.source,
      userId: job.user_id,
      userName: job.user_name,
      guildId: job.guild_id,
      requestText: job.request_text,
      maxAttempts: job.max_attempts,
      attemptCount: job.attempt_count,
      nextRetryAt: job.next_retry_at,
      lastError: job.last_error,
      createdAt: job.created_at,
      startedAt: job.started_at,
      completedAt: job.completed_at,
      updatedAt: job.updated_at,
    },
    events,
  });
}
