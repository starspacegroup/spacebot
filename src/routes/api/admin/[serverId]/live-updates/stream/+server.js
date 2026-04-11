import { error } from "@sveltejs/kit";
import { getLiveVoiceChannels } from "$lib/db/live-voice.js";
import { verifyLiveUpdateAccess } from "$lib/live-updates.js";

const POLL_INTERVAL_MS = 3000;

function getEnv(platform, name) {
  return platform?.env?.[name] ?? (typeof process !== "undefined" ? process.env?.[name] : undefined);
}

function normalizeStreamSnapshot(snapshot) {
  if (snapshot?.updatedAt) {
    return snapshot;
  }

  return {
    ...snapshot,
    updatedAt: new Date().toISOString(),
  };
}

function encodeSseEvent(eventName, payload) {
  return `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export async function GET({ params, url, platform }) {
  const { serverId } = params;

  if (!/^\d{17,20}$/.test(serverId || "")) {
    throw error(400, "Invalid server ID");
  }

  const userId = url.searchParams.get("user") || "";
  const expiresAt = url.searchParams.get("exp") || "";
  const signature = url.searchParams.get("sig") || "";
  const secret = getEnv(platform, "INTERNAL_API_KEY") || getEnv(platform, "DISCORD_BOT_TOKEN");

  const authorized = await verifyLiveUpdateAccess(serverId, userId, expiresAt, signature, secret);
  if (!authorized) {
    throw error(401, "Unauthorized");
  }

  const db = platform?.env?.DB;
  if (!db) {
    throw error(503, "Database not available");
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let previousPayload = "";

      const pushSnapshot = async () => {
        const snapshot = normalizeStreamSnapshot(await getLiveVoiceChannels(db, serverId));
        const payload = JSON.stringify(snapshot);

        if (payload === previousPayload) {
          return;
        }

        previousPayload = payload;
        controller.enqueue(encoder.encode(encodeSseEvent("voice_snapshot", {
          type: "voice_snapshot",
          guildId: serverId,
          reason: "db_stream",
          data: snapshot,
        })));
      };

      controller.enqueue(encoder.encode(": connected\n\n"));
      await pushSnapshot();

      const interval = setInterval(() => {
        pushSnapshot().catch((streamError) => {
          controller.error(streamError);
        });
      }, POLL_INTERVAL_MS);

      this._interval = interval;
    },
    cancel() {
      if (this._interval) {
        clearInterval(this._interval);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}