import { json } from "@sveltejs/kit";
import { revokeRunnerToken, createRunnerJob } from "$lib/db/local-runners.js";

/** DELETE /api/account/runners/[id] — revoke a token */
export async function DELETE({ params, cookies, platform }) {
  const userId = cookies.get("discord_user_id");
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  const db = platform?.env?.DB;
  if (!db) return json({ error: "Database unavailable" }, { status: 503 });

  const tokenId = Number(params.id);
  if (!tokenId) return json({ error: "Invalid ID" }, { status: 400 });

  const result = await revokeRunnerToken(db, userId, tokenId);
  if (!result.success) return json({ error: result.error }, { status: 400 });

  return json({ success: true });
}

/** POST /api/account/runners/[id] — queue a job for a specific runner */
export async function POST({ params, request, cookies, platform }) {
  const userId = cookies.get("discord_user_id");
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  const db = platform?.env?.DB;
  if (!db) return json({ error: "Database unavailable" }, { status: 503 });

  const tokenId = Number(params.id);
  if (!tokenId) return json({ error: "Invalid ID" }, { status: 400 });

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await createRunnerJob(db, userId, tokenId, {
    command: body?.command,
    job_type: body?.job_type,
    payload_json: body?.payload_json,
    capability_requirements_json: body?.capability_requirements_json,
    working_dir: body?.working_dir,
    label: body?.label,
    target_instance_id: body?.target_instance_id,
    priority: body?.priority,
    max_attempts: body?.max_attempts,
    timeout_seconds: body?.timeout_seconds,
  });

  if (!result.success) return json({ error: result.error }, { status: 400 });
  return json({ success: true, jobId: result.jobId }, { status: 201 });
}
