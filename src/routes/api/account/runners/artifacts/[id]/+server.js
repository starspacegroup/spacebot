import { json } from "@sveltejs/kit";
import { getRunnerArtifact } from "$lib/db/local-runners.js";

/**
 * GET /api/account/runners/artifacts/[id]
 *
 * Query params:
 * - raw=1 : return binary response for inline_base64 artifacts
 */
export async function GET({ params, url, cookies, platform }) {
  const userId = cookies.get("discord_user_id");
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  const db = platform?.env?.DB;
  if (!db) return json({ error: "Database unavailable" }, { status: 503 });

  const artifactId = Number(params.id);
  if (!artifactId) return json({ error: "Invalid artifact ID" }, { status: 400 });

  const raw = url.searchParams.get("raw") === "1";
  const artifact = await getRunnerArtifact(db, userId, artifactId, raw);
  if (!artifact) return json({ error: "Artifact not found" }, { status: 404 });

  if (raw) {
    if (artifact.storage_mode === "inline_base64" && artifact.blob_base64) {
      const mime = artifact.mime_type || "application/octet-stream";
      const binary = Uint8Array.from(atob(artifact.blob_base64), (c) => c.charCodeAt(0));
      return new Response(binary, {
        status: 200,
        headers: {
          "Content-Type": mime,
          "Cache-Control": "private, max-age=60",
        },
      });
    }

    if (artifact.external_url) {
      return Response.redirect(artifact.external_url, 302);
    }

    return json({ error: "Artifact has no retrievable payload" }, { status: 404 });
  }

  return json({ artifact });
}
