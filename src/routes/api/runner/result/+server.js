import { json } from "@sveltejs/kit";
import { validateRunnerToken, reportJobResult } from "$lib/db/local-runners.js";

/**
 * POST /api/runner/result
 *
 * Called by the local runner after completing (or failing) a job.
 * Body: {
 *   jobId: number,
 *   status: "completed"|"failed",
 *   output: string,
 *   exitCode: number,
 *   result?: object,
 *   artifactRefs?: object[]
 * }
 */
export async function POST({ request, platform }) {
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

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { jobId, status, output, exitCode, result: structuredResult, artifactRefs } = body || {};
  if (!jobId || typeof jobId !== "number") {
    return json({ error: "jobId (number) is required" }, { status: 400 });
  }
  if (status !== "completed" && status !== "failed") {
    return json({ error: "status must be 'completed' or 'failed'" }, { status: 400 });
  }

  const reportResult = await reportJobResult(db, auth.tokenId, jobId, {
    status,
    output: typeof output === "string" ? output : "",
    exitCode: typeof exitCode === "number" ? exitCode : null,
    result_json: structuredResult ?? null,
    artifact_refs_json: artifactRefs ?? null,
  });

  if (!reportResult.success) return json({ error: reportResult.error }, { status: 400 });
  return json({ success: true });
}
