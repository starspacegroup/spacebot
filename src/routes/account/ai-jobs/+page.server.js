import { redirect } from "@sveltejs/kit";
import { listAIJobsForUser } from "$lib/db/ai-orchestration.js";

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

  const jobs = await listAIJobsForUser(db, userId, { limit, offset, status });

  return {
    jobs: jobs.map((job) => ({
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
    },
  };
}
