/**
 * Lightweight Discord REST Client
 *
 * Provides a Discord.js-compatible interface backed by the Discord REST API.
 * Used when the full Discord.js gateway client is unavailable (e.g., webhook
 * endpoints running on Cloudflare Workers).
 */

const API_BASE = "https://discord.com/api/v10";

async function discordFetch(botToken, path, options = {}) {
  const { method = "GET", body, reason } = options;
  const headers = {
    Authorization: `Bot ${botToken}`,
    "Content-Type": "application/json",
  };
  if (reason) headers["X-Audit-Log-Reason"] = reason;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || `Discord API ${res.status}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

// ---------------------------------------------------------------------------
// Channel wrapper  — returned by discord.channels.fetch(id)
// ---------------------------------------------------------------------------
function wrapChannel(token, data) {
  return {
    ...data,
    async send(payload) {
      const body =
        typeof payload === "string" ? { content: payload } : payload;
      return discordFetch(token, `/channels/${data.id}/messages`, {
        method: "POST",
        body,
      });
    },
    messages: {
      async fetch(idOrOpts) {
        if (typeof idOrOpts === "string") {
          return discordFetch(token, `/channels/${data.id}/messages/${idOrOpts}`);
        }
        const limit = idOrOpts?.limit ?? 50;
        const msgs = await discordFetch(
          token,
          `/channels/${data.id}/messages?limit=${limit}`,
        );
        // Return a Map-like collection matching Discord.js interface
        const map = new Map(msgs.map((m) => [m.id, {
          ...m,
          author: m.author,
          createdTimestamp: new Date(m.timestamp).getTime(),
          async delete() {
            return discordFetch(token, `/channels/${data.id}/messages/${m.id}`, { method: "DELETE" });
          },
          async react(emoji) {
            const encoded = encodeURIComponent(emoji);
            return discordFetch(token, `/channels/${data.id}/messages/${m.id}/reactions/${encoded}/@me`, { method: "PUT" });
          },
        }]));
        map.filter = (fn) => {
          const filtered = new Map();
          for (const [k, v] of map) if (fn(v)) filtered.set(k, v);
          filtered.values = () => filtered[Symbol.iterator]();
          return filtered;
        };
        return map;
      },
    },
    async bulkDelete(messages) {
      const ids = Array.isArray(messages)
        ? messages.map((m) => (typeof m === "string" ? m : m.id))
        : [...messages.values()].map((m) => m.id);
      if (ids.length < 2) {
        for (const id of ids) {
          await discordFetch(token, `/channels/${data.id}/messages/${id}`, { method: "DELETE" });
        }
        return;
      }
      return discordFetch(token, `/channels/${data.id}/messages/bulk-delete`, {
        method: "POST",
        body: { messages: ids },
      });
    },
    threads: {
      async create({ name, autoArchiveDuration }) {
        return discordFetch(token, `/channels/${data.id}/threads`, {
          method: "POST",
          body: {
            name,
            auto_archive_duration: autoArchiveDuration,
            type: 11, // PUBLIC_THREAD
          },
        });
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Member wrapper  — returned by guild.members.fetch(userId)
// ---------------------------------------------------------------------------
function wrapMember(token, guildId, data) {
  const userId = data.user?.id || data.id;
  return {
    ...data,
    user: data.user,
    roles: {
      async add(roleId) {
        return discordFetch(
          token,
          `/guilds/${guildId}/members/${userId}/roles/${roleId}`,
          { method: "PUT" },
        );
      },
      async remove(roleId) {
        return discordFetch(
          token,
          `/guilds/${guildId}/members/${userId}/roles/${roleId}`,
          { method: "DELETE" },
        );
      },
    },
    async kick(reason) {
      return discordFetch(token, `/guilds/${guildId}/members/${userId}`, {
        method: "DELETE",
        reason,
      });
    },
    async timeout(durationMs, reason) {
      const until = durationMs
        ? new Date(Date.now() + durationMs).toISOString()
        : null;
      return discordFetch(token, `/guilds/${guildId}/members/${userId}`, {
        method: "PATCH",
        body: { communication_disabled_until: until },
        reason,
      });
    },
    voice: {
      channelId: data.voice_state?.channel_id ?? null,
      async setMute(mute, reason) {
        return discordFetch(token, `/guilds/${guildId}/members/${userId}`, {
          method: "PATCH",
          body: { mute },
          reason,
        });
      },
      async setDeaf(deaf, reason) {
        return discordFetch(token, `/guilds/${guildId}/members/${userId}`, {
          method: "PATCH",
          body: { deaf },
          reason,
        });
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Public API: createDiscordRestClient(botToken)
// ---------------------------------------------------------------------------
export function createDiscordRestClient(botToken) {
  return {
    channels: {
      async fetch(channelId) {
        const data = await discordFetch(botToken, `/channels/${channelId}`);
        return wrapChannel(botToken, data);
      },
    },
    guilds: {
      async fetch(guildId) {
        const data = await discordFetch(botToken, `/guilds/${guildId}`);
        return {
          ...data,
          members: {
            async fetch(userId) {
              const mdata = await discordFetch(
                botToken,
                `/guilds/${guildId}/members/${userId}`,
              );
              return wrapMember(botToken, guildId, mdata);
            },
            async ban(userId, { reason, deleteMessageSeconds } = {}) {
              return discordFetch(
                botToken,
                `/guilds/${guildId}/bans/${userId}`,
                {
                  method: "PUT",
                  body: { delete_message_seconds: deleteMessageSeconds },
                  reason,
                },
              );
            },
          },
          channels: {
            async fetch() {
              const chs = await discordFetch(
                botToken,
                `/guilds/${guildId}/channels`,
              );
              return new Map(
                chs.map((c) => [c.id, wrapChannel(botToken, c)]),
              );
            },
            async create({ name, type, parent, topic }) {
              return discordFetch(botToken, `/guilds/${guildId}/channels`, {
                method: "POST",
                body: { name, type, parent_id: parent, topic },
              });
            },
          },
        };
      },
    },
    users: {
      async fetch(userId) {
        const data = await discordFetch(botToken, `/users/${userId}`);
        return {
          ...data,
          async send(payload) {
            // Create a DM channel first, then send
            const dm = await discordFetch(botToken, `/users/@me/channels`, {
              method: "POST",
              body: { recipient_id: userId },
            });
            const body =
              typeof payload === "string" ? { content: payload } : payload;
            return discordFetch(botToken, `/channels/${dm.id}/messages`, {
              method: "POST",
              body,
            });
          },
        };
      },
    },
  };
}
