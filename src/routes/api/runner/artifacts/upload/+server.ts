/**
 * POST /api/runner/artifacts/upload
 *
 * Allows a local runner to pre-upload binary artifacts (e.g. screenshots) via
 * HTTP before reporting a job result over the WebSocket connection.  Uploading
 * artifacts out-of-band keeps the WS result message small and avoids hitting
 * Cloudflare's ~1 MB WebSocket message size limit when sending large PNGs.
 *
 * Auth: Authorization: Bearer sbr_<token>
 *
 * Request body (JSON):
 *   {
 *     jobId:    number,
 *     artifact: {
 *       artifactType:  string,           // e.g. "screenshot"
 *       mimeType:      string,           // e.g. "image/png"
 *       blobBase64:    string,           // base64-encoded bytes
 *       byteSize?:     number,
 *       width?:        number,
 *       height?:       number,
 *       captureSource?: string,
 *       captureIndex?:  number,
 *       storageMode?:  string,           // default "inline_base64"
 *     }
 *   }
 *
 * Response (200):  { success: true, artifactId: number }
 * Response (413):  { error: "..." }  — artifact too large (> 8 MB base64)
 */

import { json } from "@sveltejs/kit";

// 8 MB base64 ceiling (~6 MB binary).  Screenshots should be well under this.
const MAX_BLOB_BASE64_LEN = 8_000_000;

async function sha256hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function validateRunnerToken(db, rawToken, clientIp) {
  if (!rawToken?.startsWith("sbr_")) {
    return { valid: false, error: "Invalid token format" };
  }

  const tokenHash = await sha256hex(rawToken);
  const tokenPrefix = rawToken.slice(0, 12);

  let row;
  try {
    row = await db
      .prepare(
        "SELECT id, user_id, revoked FROM local_runner_tokens WHERE token_prefix = ? AND token_hash = ?",
      )
      .bind(tokenPrefix, tokenHash)
      .first();
  } catch {
    return { valid: false, error: "Database error" };
  }

  if (!row) return { valid: false, error: "Token not found" };
  if (row.revoked) return { valid: false, error: "Token revoked" };

  // Fire-and-forget heartbeat
  db.prepare(
    "UPDATE local_runner_tokens SET last_seen_at = datetime('now'), last_seen_ip = ?, updated_at = datetime('now') WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < datetime('now', '-15 seconds'))",
  )
    .bind(clientIp ?? null, row.id)
    .run()
    .catch(() => {});

  return { valid: true, tokenId: row.id, userId: row.user_id };
}

export async function POST({ request, platform }) {
  const db = (platform as any)?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 503 });
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  const rawToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const clientIp =
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
    null;

  const auth = await validateRunnerToken(db, rawToken, clientIp);
  if (!auth.valid) {
    return json({ error: auth.error ?? "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const jobId = typeof body?.jobId === "number" ? body.jobId : null;
  if (!jobId) {
    return json({ error: "jobId is required" }, { status: 400 });
  }

  // Verify the job belongs to this user's runner
  const job = await db
    .prepare(
      "SELECT id FROM local_runner_jobs WHERE id = ? AND user_id = ? AND runner_token_id = ?",
    )
    .bind(jobId, auth.userId, auth.tokenId)
    .first();

  if (!job) {
    return json({ error: "Job not found" }, { status: 404 });
  }

  const artifact = body?.artifact;
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    return json({ error: "artifact object is required" }, { status: 400 });
  }

  const blobBase64 = typeof artifact.blobBase64 === "string" ? artifact.blobBase64 : null;
  if (!blobBase64) {
    return json({ error: "artifact.blobBase64 is required" }, { status: 400 });
  }
  if (blobBase64.length > MAX_BLOB_BASE64_LEN) {
    return json({ error: `Artifact exceeds maximum size (8 MB)` }, { status: 413 });
  }

  const artifactType =
    typeof artifact.artifactType === "string" ? artifact.artifactType : "unknown";
  const mimeType = typeof artifact.mimeType === "string" ? artifact.mimeType : null;
  const byteSize =
    typeof artifact.byteSize === "number"
      ? artifact.byteSize
      : Math.floor((blobBase64.length * 3) / 4);
  const storageMode =
    typeof artifact.storageMode === "string" ? artifact.storageMode : "inline_base64";

  // Metadata excludes the blob itself to keep the column small
  const metadataJson = JSON.stringify({
    artifactType,
    mimeType,
    byteSize,
    width: artifact.width ?? null,
    height: artifact.height ?? null,
    captureSource: artifact.captureSource ?? null,
    captureIndex: artifact.captureIndex ?? null,
    storageMode,
  });

  try {
    const row = await db
      .prepare(
        `INSERT INTO local_runner_artifacts (
           user_id, runner_token_id, job_id,
           artifact_type, mime_type, byte_size, width, height,
           capture_source, capture_index, storage_mode, blob_base64, metadata_json
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id`,
      )
      .bind(
        auth.userId,
        auth.tokenId,
        jobId,
        artifactType,
        mimeType,
        byteSize,
        typeof artifact.width === "number" ? artifact.width : null,
        typeof artifact.height === "number" ? artifact.height : null,
        typeof artifact.captureSource === "string" ? artifact.captureSource : null,
        typeof artifact.captureIndex === "number" ? artifact.captureIndex : null,
        storageMode,
        blobBase64,
        metadataJson,
      )
      .first();

    return json({ success: true, artifactId: row.id });
  } catch (err) {
    console.error("[Runner Artifacts] Upload error:", err);
    return json({ error: "Failed to store artifact" }, { status: 500 });
  }
}
