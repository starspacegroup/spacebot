import { json } from "@sveltejs/kit";
import { reconcileVoiceSessions } from "$lib/db/stats-aggregation.js";
import { log } from "$lib/log.js";

function checkIsBotRequest(request, platform) {
  const authHeader = request.headers.get("Authorization");
  const botToken = platform?.env?.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;
  return Boolean(botToken) && authHeader === `Bot ${botToken}`;
}

export async function POST({ request, platform }) {
  if (!checkIsBotRequest(request, platform)) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = platform?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 503 });
  }

  try {
    const body = await request.json();
    const guildId = body?.guild_id;
    const reason = body?.reason || "unspecified";
    const activeSessions = Array.isArray(body?.active_sessions)
      ? body.active_sessions
        .filter((session) => session?.user_id && session?.channel_id)
        .map((session) => ({
          user_id: String(session.user_id),
          channel_id: String(session.channel_id),
          channel_name: session.channel_name ? String(session.channel_name) : null,
        }))
      : [];

    if (!guildId) {
      return json({ error: "guild_id is required" }, { status: 400 });
    }

    const result = await reconcileVoiceSessions(db, String(guildId), activeSessions);

    if (result.closedSessions > 0 || result.createdSessions > 0 || result.duplicateSessionsClosed > 0) {
      log.info(
        `[VoiceSessions API] Reconciled guild ${guildId} (${reason}): closed=${result.closedSessions}, created=${result.createdSessions}, duplicates_closed=${result.duplicateSessionsClosed}`
      );
    }

    return json({ success: true, ...result });
  } catch (error) {
    log.error("[VoiceSessions API] Reconciliation failed:", error);
    return json({ error: "Invalid request body" }, { status: 400 });
  }
}