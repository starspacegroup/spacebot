import { json } from "@sveltejs/kit";
import { getUserPreferences, updateUserPreferences } from "$lib/db/users.js";

/** @type {import('./$types').RequestHandler} */
export async function GET({ cookies, platform }) {
  const userId = cookies.get("discord_user_id");
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

  const db = platform?.env?.DB;
  if (!db) return json({ error: "Database unavailable" }, { status: 503 });

  const preferences = await getUserPreferences(db, userId);
  return json({ preferences });
}

/** @type {import('./$types').RequestHandler} */
export async function PATCH({ request, cookies, platform }) {
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

  const runnerUi = body?.runnerUi;
  if (!runnerUi || typeof runnerUi !== "object" || Array.isArray(runnerUi)) {
    return json({ error: "runnerUi object is required" }, { status: 400 });
  }

  const payload = {};
  if (Object.prototype.hasOwnProperty.call(runnerUi, "showRevoked")) {
    payload.runnerUi = {
      showRevoked: Boolean(runnerUi.showRevoked),
    };
  }

  if (!Object.keys(payload).length) {
    return json({ error: "No supported preference keys provided" }, { status: 400 });
  }

  const result = await updateUserPreferences(db, userId, payload);
  if (!result.success) {
    return json({ error: result.error || "Failed to update preferences" }, { status: 400 });
  }

  return json({ success: true, preferences: result.preferences });
}
