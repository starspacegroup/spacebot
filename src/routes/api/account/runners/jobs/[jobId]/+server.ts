import { json } from "@sveltejs/kit";
import { cancelRunnerJob, retryRunnerJob } from "$lib/db/local-runners.js";

/** @type {import('./$types').RequestHandler} */
export async function PATCH({ params, request, cookies, platform }) {
  const userId = cookies.get("discord_user_id");
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  const db = (platform as any)?.env?.DB;
  if (!db) return json({ error: "Database unavailable" }, { status: 503 });

  const jobId = Number(params.jobId);
  if (!jobId) return json({ error: "Invalid job ID" }, { status: 400 });

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = typeof body?.action === "string" ? body.action.trim().toLowerCase() : "";
  if (!action) {
    return json({ error: "action is required" }, { status: 400 });
  }

  if (action === "cancel") {
    const reason = typeof body?.reason === "string" && body.reason.trim()
      ? body.reason.trim()
      : null;
    const result = await cancelRunnerJob(db, userId, jobId, reason);
    if (!result.success) return json({ error: result.error }, { status: 400 });
    return json({ success: true, action: "cancel" });
  }

  if (action === "retry") {
    const result = await retryRunnerJob(db, userId, jobId);
    if (!result.success) return json({ error: result.error }, { status: 400 });
    return json({ success: true, action: "retry" });
  }

  return json({ error: "Unsupported action" }, { status: 400 });
}
