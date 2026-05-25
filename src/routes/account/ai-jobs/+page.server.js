import { redirect } from "@sveltejs/kit";
import { listAIJobsForUser } from "$lib/db/ai-orchestration.js";
import { getRunnerJobs } from "$lib/db/local-runners.js";

export async function load({ cookies, platform, url }) {
  const userId = cookies.get("discord_user_id");
  if (!userId) {
    throw redirect(302, "/login");
  }

  const db = platform?.env?.DB;
  if (!db) {
    return { jobs: [] };
  }

  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") || "50") || 50));
  const offset = Math.max(0, Number(url.searchParams.get("offset") || "0") || 0);
  const status = url.searchParams.get("status") || null;
  const runnerJobType = url.searchParams.get("runnerJobType") || null;
  const q = (url.searchParams.get("q") || "").trim();

  const jobs = await listAIJobsForUser(db, userId, { limit, offset, status });
  const runnerJobs = await getRunnerJobs(db, userId, null, {
    limit: 50,
    ...(runnerJobType ? { jobType: runnerJobType } : {}),
  });
  const runnerRecentJobs = runnerJobs
    .slice(0, 50)
    .map((job) => ({
      id: job.id,
      jobType: job.job_type,
      status: job.status,
      label: job.label,
      command: job.command,
      targetInstanceName: job.target_instance_name,
      claimedByInstanceName: job.claimed_by_instance_name,
      attemptCount: job.attempt_count,
      maxAttempts: job.max_attempts,
      timeoutSeconds: job.timeout_seconds,
      terminalError: job.terminal_error,
      createdAt: job.created_at,
      startedAt: job.started_at,
      completedAt: job.completed_at,
      updatedAt: job.updated_at,
    }));

  const filteredJobs = q
    ? jobs.filter((job) => {
        const haystack = [
          job.correlation_id,
          job.request_text,
          job.last_error,
          job.status,
          job.source,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(q.toLowerCase());
      })
    : jobs;

  return {
    jobs: filteredJobs.map((job) => ({
      id: job.id,
      correlationId: job.correlation_id,
      source: job.source,
      status: job.status,
      requestText: job.request_text,
      maxAttempts: job.max_attempts,
      attemptCount: job.attempt_count,
      nextRetryAt: job.next_retry_at,
      lastError: job.last_error,
      createdAt: job.created_at,
      startedAt: job.started_at,
      completedAt: job.completed_at,
      updatedAt: job.updated_at,
    })),
    filters: {
      limit,
      offset,
      status,
      runnerJobType,
      q,
    },
    pagination: {
      limit,
      offset,
      hasPrev: offset > 0,
      hasNext: jobs.length >= limit,
      returned: filteredJobs.length,
      loaded: jobs.length,
    },
    runnerRecentJobs,
  };
}
