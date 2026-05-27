import { json } from "@sveltejs/kit";
import { dispatchWorkflowJob } from "$lib/db/workflows.js";

/** @type {import('./$types').RequestHandler} */
export async function POST({ params, request, cookies, platform }) {
  const userId = cookies.get("discord_user_id");
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  const db = platform?.env?.DB;
  if (!db) return json({ error: "Database unavailable" }, { status: 503 });

  const workflowId = Number(params.id);
  if (!workflowId) return json({ error: "Invalid workflow ID" }, { status: 400 });

  let body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const result = await dispatchWorkflowJob(db, userId, workflowId, body || {});
  if (!result.success) return json({ error: result.error }, { status: 400 });

  return json({
    success: true,
    workflowId,
    jobId: result.jobId,
    jobIds: result.jobIds || [result.jobId],
    createdJobs: result.createdJobs || [],
    runnerStrategy: result.runnerStrategy,
    modelMode: result.modelMode,
    workflow: result.workflow,
  }, { status: 201 });
}
