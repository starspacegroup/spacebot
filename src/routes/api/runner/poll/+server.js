import { json } from "@sveltejs/kit";
import { validateRunnerToken, claimPendingJobs } from "$lib/db/local-runners.js";

/**
 * GET /api/runner/poll
 *
 * The local runner calls this endpoint on a short interval.
 * It authenticates via `Authorization: Bearer sbr_<token>`, updates the
 * runner's last_seen_at heartbeat, and returns any pending jobs (which are
 * immediately marked as 'running' to prevent double-claiming).
 *
 * Response: { jobs: [...] }
 */
export async function GET({ request, platform }) {
  const db = platform?.env?.DB;
  if (!db) return json({ error: "Database unavailable" }, { status: 503 });

  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer sbr_")) {
    return json({ error: "Missing or invalid Authorization header" }, { status: 401 });
  }

  const rawToken = authHeader.slice("Bearer ".length);
  const clientIp = request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
    null;

  const auth = await validateRunnerToken(db, rawToken, clientIp);
  if (!auth.valid) {
    return json({ error: auth.error }, { status: 401 });
  }

  const jobs = await claimPendingJobs(db, auth.tokenId);
  return json({ jobs });
}
