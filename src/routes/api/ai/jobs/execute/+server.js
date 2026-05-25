import { json } from "@sveltejs/kit";
import { generateChatResponse } from "$lib/ai/chat.js";
import {
  appendAIJobEvent,
  claimAIJobForExecution,
  completeAIJob,
  failAIJobTerminal,
  getAIJobById,
  scheduleAIJobRetry,
} from "$lib/db/ai-orchestration.js";
import { chooseRetryDecision } from "$lib/ai/retry-policy.js";
import { createRunnerJob, getRunnerInstances } from "$lib/db/local-runners.js";

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

async function sendDiscordDm(env, userId, content) {
  const botToken = env.DISCORD_BOT_TOKEN;
  if (!botToken) {
    throw new Error("DISCORD_BOT_TOKEN not configured");
  }

  const channelResponse = await fetch("https://discord.com/api/v10/users/@me/channels", {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ recipient_id: userId }),
  });

  if (!channelResponse.ok) {
    throw new Error(`Failed to open DM channel (${channelResponse.status})`);
  }

  const channel = await channelResponse.json();
  const chunks = String(content || "").match(/[\s\S]{1,1990}/g) || [];

  for (const chunk of chunks) {
    const messageResponse = await fetch(`https://discord.com/api/v10/channels/${channel.id}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: chunk }),
    });

    if (!messageResponse.ok) {
      throw new Error(`Failed to send DM chunk (${messageResponse.status})`);
    }
  }
}

async function dispatchToLocalRunnerFallback(db, job) {
  const instances = await getRunnerInstances(db, job.user_id, { limit: 100 });
  if (!instances.length) {
    return { dispatched: false, reason: "no_runner" };
  }

  const target = instances.find((instance) => instance.is_online) || instances[0];
  if (!target) {
    return { dispatched: false, reason: "no_target" };
  }

  const result = await createRunnerJob(db, job.user_id, target.runner_token_id, {
    job_type: "dm",
    label: `Autopilot fallback DM for ${job.user_name || job.user_id}`,
    target_instance_id: target.id,
    payload_json: {
      user_id: job.user_id,
      user_name: job.user_name || null,
      message: job.request_text,
      history: Array.isArray(job.history_json) ? job.history_json : [],
      response_target: {
        type: "discord_dm",
        user_id: job.user_id,
        source: "autopilot_runner_fallback",
      },
      received_at: new Date().toISOString(),
      autopilot: {
        correlation_id: job.correlation_id,
        source_job_id: job.id,
      },
    },
    priority: 20,
    max_attempts: 1,
    timeout_seconds: 300,
  });

  if (!result.success) {
    return { dispatched: false, reason: "dispatch_failed", error: result.error || "Failed to create runner job" };
  }

  return {
    dispatched: true,
    runnerJobId: result.jobId,
    runner: {
      id: target.id,
      display_name: target.display_name,
      hostname: target.hostname,
      is_online: Boolean(target.is_online),
    },
  };
}

export async function POST({ request, platform }) {
  if (!checkIsAutopilotRequest(request, platform)) {
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

  const jobId = Number(body?.jobId);
  if (!Number.isFinite(jobId) || jobId <= 0) {
    return json({ error: "jobId is required" }, { status: 400 });
  }

  const claimResult = await claimAIJobForExecution(db, jobId);
  if (!claimResult.success || !claimResult.job) {
    return json({ ok: true, skipped: true, reason: claimResult.error || "not_claimable" });
  }

  const job = claimResult.job;

  const env = {
    CLOUDFLARE_ACCOUNT_ID: getEnv(platform, "CLOUDFLARE_ACCOUNT_ID"),
    CLOUDFLARE_AI_TOKEN: getEnv(platform, "CLOUDFLARE_AI_TOKEN"),
    CLOUDFLARE_API_TOKEN: getEnv(platform, "CLOUDFLARE_API_TOKEN"),
    CLOUDFLARE_AI_GATEWAY_ID: getEnv(platform, "CLOUDFLARE_AI_GATEWAY_ID"),
    CLOUDFLARE_AI_MODEL: getEnv(platform, "CLOUDFLARE_AI_MODEL"),
    CLOUDFLARE_AI_MODELS: getEnv(platform, "CLOUDFLARE_AI_MODELS"),
    CLOUDFLARE_AI_MODEL_ROUTING: getEnv(platform, "CLOUDFLARE_AI_MODEL_ROUTING"),
    DISCORD_BOT_TOKEN: getEnv(platform, "DISCORD_BOT_TOKEN"),
    DISCORD_CLIENT_ID: getEnv(platform, "DISCORD_CLIENT_ID"),
    DB: db,
  };

  try {
    await appendAIJobEvent(db, job.id, {
      eventType: "job.executing",
      source: "autopilot_executor",
      step: "generate_response",
      message: "Generating AI response",
    });

    const aiResult = await generateChatResponse({
      message: job.request_text,
      userName: job.user_name || "User",
      userId: job.user_id,
      history: Array.isArray(job.history_json) ? job.history_json : [],
      managedGuilds: Array.isArray(job.managed_guilds_json) ? job.managed_guilds_json : [],
      selectedGuild: job.selected_guild_json || null,
      selectedGuildId: job.selected_guild_json?.id || null,
      selectedGuildName: job.selected_guild_json?.name || null,
      maxToolIterations: Number(job.metadata_json?.maxToolIterations) || 5,
      isSuperAdmin: Boolean(job.metadata_json?.isSuperAdmin),
    }, env);

    if (!aiResult.success) {
      throw new Error(aiResult.error || "AI response generation failed");
    }

    await appendAIJobEvent(db, job.id, {
      eventType: "job.delivering",
      source: "autopilot_executor",
      step: "deliver_dm",
      message: "Delivering DM response",
      metadata: {
        responseLength: aiResult.response?.length || 0,
        toolsUsed: aiResult.toolsUsed || [],
      },
    });

    await sendDiscordDm(env, job.user_id, aiResult.response || "I completed your request.");

    await completeAIJob(db, job.id, {
      toolsUsed: aiResult.toolsUsed || [],
      responseLength: aiResult.response?.length || 0,
    });

    return json({ ok: true, status: "completed", jobId: job.id });
  } catch (error) {
    const latest = await getAIJobById(db, job.id);
    const decision = chooseRetryDecision({
      error,
      attemptCount: Number(latest?.attempt_count) || Number(job.attempt_count) || 1,
      maxAttempts: Number(latest?.max_attempts) || Number(job.max_attempts) || 1,
      firstAttemptAt: latest?.created_at ? Date.parse(latest.created_at) : Date.now(),
      providerChain: Array.isArray(latest?.provider_chain_json) ? latest.provider_chain_json : [],
      mode: getEnv(platform, "AI_RETRY_ASSESSOR_MODE") || "bounded",
    });

    const shouldTryRunnerFallback = Boolean(decision.retry) && (
      decision?.providerSwitchHint?.to === "runner" ||
      (Array.isArray(latest?.provider_chain_json) && latest.provider_chain_json.includes("runner"))
    );

    if (shouldTryRunnerFallback) {
      const fallback = await dispatchToLocalRunnerFallback(db, latest || job);
      if (fallback.dispatched) {
        await appendAIJobEvent(db, job.id, {
          eventType: "job.runner_fallback_dispatched",
          source: "autopilot_executor",
          step: "runner_fallback",
          message: "Dispatched to local runner as provider fallback",
          metadata: {
            runnerJobId: fallback.runnerJobId,
            runner: fallback.runner,
            decision,
          },
        });

        await completeAIJob(db, job.id, {
          runnerFallback: true,
          runnerJobId: fallback.runnerJobId,
          runner: fallback.runner,
          decision,
        });

        try {
          const runnerName = fallback.runner?.display_name || fallback.runner?.hostname || "your local runner";
          await sendDiscordDm(
            env,
            job.user_id,
            `I switched execution to ${runnerName} for reliability. Your request is queued there now. (job ${job.correlation_id}, runner job #${fallback.runnerJobId})`,
          );
        } catch {
          // Best effort: fallback dispatch and completion are already persisted.
        }

        return json({
          ok: true,
          status: "completed",
          jobId: job.id,
          runnerFallback: true,
          runnerJobId: fallback.runnerJobId,
          decision,
        });
      }

      await appendAIJobEvent(db, job.id, {
        eventType: "job.runner_fallback_failed",
        source: "autopilot_executor",
        step: "runner_fallback",
        message: "Runner fallback failed; continuing retry flow",
        metadata: {
          reason: fallback.reason,
          error: fallback.error || null,
          decision,
        },
      });
    }

    if (decision.retry) {
      await scheduleAIJobRetry(db, job.id, error?.message || String(error), decision);
      return json({ ok: true, status: "retry_scheduled", jobId: job.id, decision });
    }

    await failAIJobTerminal(db, job.id, error?.message || String(error), decision);

    try {
      await sendDiscordDm(
        env,
        job.user_id,
        `I couldn't complete your request after retries. (job ${job.correlation_id})\nReason: ${String(error?.message || error).slice(0, 300)}`,
      );
    } catch {
      // Best effort: terminal status is already persisted.
    }

    return json({ ok: true, status: "failed_terminal", jobId: job.id, decision });
  }
}
