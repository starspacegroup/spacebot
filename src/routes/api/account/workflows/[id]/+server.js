import { json } from "@sveltejs/kit";
import { getUserWorkflow, updateUserWorkflow, deleteUserWorkflow } from "$lib/db/workflows.js";

/** @type {import('./$types').RequestHandler} */
export async function GET({ params, cookies, platform }) {
  const userId = cookies.get("discord_user_id");
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  const db = platform?.env?.DB;
  if (!db) return json({ error: "Database unavailable" }, { status: 503 });

  const workflowId = Number(params.id);
  if (!workflowId) return json({ error: "Invalid workflow ID" }, { status: 400 });

  const workflow = await getUserWorkflow(db, userId, workflowId);
  if (!workflow) return json({ error: "Workflow not found" }, { status: 404 });

  return json({ workflow });
}

/** @type {import('./$types').RequestHandler} */
export async function PATCH({ params, request, cookies, platform }) {
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
    return json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await updateUserWorkflow(db, userId, workflowId, body || {});
  if (!result.success) return json({ error: result.error }, { status: 400 });

  return json({ success: true, workflow: result.workflow });
}

/** @type {import('./$types').RequestHandler} */
export async function DELETE({ params, cookies, platform }) {
  const userId = cookies.get("discord_user_id");
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  const db = platform?.env?.DB;
  if (!db) return json({ error: "Database unavailable" }, { status: 503 });

  const workflowId = Number(params.id);
  if (!workflowId) return json({ error: "Invalid workflow ID" }, { status: 400 });

  const result = await deleteUserWorkflow(db, userId, workflowId);
  if (!result.success) return json({ error: result.error }, { status: 400 });

  return json({ success: true });
}
