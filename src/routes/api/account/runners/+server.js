import { json } from "@sveltejs/kit";
import {
  getRunnerTokens,
  createRunnerToken,
  getRunnerJobs,
  getRunnerInstances,
  getRunnerEvents,
} from "$lib/db/local-runners.js";

/** @type {import('./$types').RequestHandler} */
export async function GET({ cookies, platform, url }) {
  const userId = cookies.get("discord_user_id");
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  const db = platform?.env?.DB;
  if (!db) return json({ error: "Database unavailable" }, { status: 503 });

  const tokenId = Number(url.searchParams.get("tokenId") || "") || null;
  const instanceId = Number(url.searchParams.get("instanceId") || "") || null;
  const jobsLimit = Math.max(1, Math.min(200, Number(url.searchParams.get("jobsLimit") || "25") || 25));
  const jobsOffset = Math.max(0, Number(url.searchParams.get("jobsOffset") || "0") || 0);
  const jobsStatus = url.searchParams.get("status") || null;
  const eventsLimit = Math.max(1, Math.min(200, Number(url.searchParams.get("eventsLimit") || "50") || 50));
  const instancesLimit = Math.max(1, Math.min(200, Number(url.searchParams.get("instancesLimit") || "100") || 100));

  const [tokens, jobs, instances, events] = await Promise.all([
    getRunnerTokens(db, userId),
    getRunnerJobs(db, userId, tokenId, {
      limit: jobsLimit,
      offset: jobsOffset,
      status: jobsStatus,
      instanceId,
    }),
    getRunnerInstances(db, userId, { tokenId, limit: instancesLimit }),
    getRunnerEvents(db, userId, { tokenId, instanceId, limit: eventsLimit }),
  ]);

  return json({
    tokens,
    jobs,
    instances,
    events,
    filters: {
      tokenId,
      instanceId,
      jobsLimit,
      jobsOffset,
      jobsStatus,
      eventsLimit,
      instancesLimit,
    },
  });
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ request, cookies, platform }) {
  const userId = cookies.get("discord_user_id");
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  const db = platform?.env?.DB;
  if (!db) return json({ error: "Database unavailable" }, { status: 503 });

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name } = body || {};
  if (!name?.trim()) {
    return json({ error: "Name is required" }, { status: 400 });
  }

  const result = await createRunnerToken(db, userId, name);
  if (!result.success) {
    return json({ error: result.error }, { status: 400 });
  }

  // rawToken is returned exactly once here — the client must save it
  return json({ token: result.record, rawToken: result.rawToken }, { status: 201 });
}
