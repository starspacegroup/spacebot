import { json } from "@sveltejs/kit";
import {
  getRunnerTokens,
  createRunnerToken,
  getRunnerJobs,
} from "$lib/db/local-runners.js";

/** @type {import('./$types').RequestHandler} */
export async function GET({ cookies, platform }) {
  const userId = cookies.get("discord_user_id");
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  const db = platform?.env?.DB;
  if (!db) return json({ error: "Database unavailable" }, { status: 503 });

  const [tokens, jobs] = await Promise.all([
    getRunnerTokens(db, userId),
    getRunnerJobs(db, userId, null, 25),
  ]);

  return json({ tokens, jobs });
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
