async function postJson(url, body, env) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.AI_AUTOPILOT_INTERNAL_KEY || ""}`,
    },
    body: JSON.stringify(body || {}),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Request failed (${response.status}): ${text.slice(0, 300)}`);
  }

  return response.json().catch(() => ({}));
}

async function executeJob(jobId, env) {
  const base = String(env.SPACEBOT_API_BASE || "").replace(/\/$/, "");
  if (!base) {
    throw new Error("SPACEBOT_API_BASE is not configured");
  }

  return postJson(`${base}/api/ai/jobs/execute`, { jobId }, env);
}

async function runWatchdogSweep(env) {
  const base = String(env.SPACEBOT_API_BASE || "").replace(/\/$/, "");
  if (!base) {
    throw new Error("SPACEBOT_API_BASE is not configured");
  }

  return postJson(`${base}/api/ai/jobs/sweep`, {}, env);
}

export default {
  async queue(batch, env, _ctx) {
    for (const message of batch.messages) {
      const payload = message.body || {};
      const type = payload.type;

      try {
        if (type === "ai_job_created" || type === "ai_job_due") {
          await executeJob(payload.jobId, env);
          message.ack();
          continue;
        }

        if (type === "ai_watchdog_sweep") {
          await runWatchdogSweep(env);
          message.ack();
          continue;
        }

        // Unknown messages are acknowledged to avoid poison-looping.
        message.ack();
      } catch (error) {
        // Let Queue retry according to its configured retry policy.
        console.error("[AI Orchestrator] Message failed:", error?.message || error, payload);
        message.retry();
      }
    }
  },
};
