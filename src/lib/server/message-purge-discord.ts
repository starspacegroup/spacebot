/**
 * Real Discord REST implementation of {@link DiscordApi} for the purge state
 * machine. Kept separate from message-purge.ts so the batch logic stays
 * network-free and unit-testable.
 */

import type {
	DiscordApi,
	DeleteResult,
	FetchMessagesResult,
	PurgeMessage,
} from './message-purge.js';

const API = 'https://discord.com/api/v10';

/** Parse a Discord 429 body / header into a retry-after in seconds. */
async function retryAfterSeconds(res: Response): Promise<number> {
	const header = res.headers.get('retry-after');
	if (header) {
		const n = Number(header);
		if (Number.isFinite(n)) return n;
	}
	try {
		const body = (await res.clone().json()) as { retry_after?: number };
		if (typeof body.retry_after === 'number') return body.retry_after;
	} catch {
		/* fall through */
	}
	return 1;
}

export function createDiscordApi(botToken: string, fetchImpl: typeof fetch = fetch): DiscordApi {
	const headers = {
		Authorization: `Bot ${botToken}`,
		'Content-Type': 'application/json',
	};

	return {
		async listGuildChannels(guildId) {
			const res = await fetchImpl(`${API}/guilds/${guildId}/channels`, { headers });
			if (!res.ok) throw new Error(`listGuildChannels failed (${res.status})`);
			const channels = (await res.json()) as Array<{ id: string; type: number }>;
			return channels.map((c) => ({ id: c.id, type: c.type }));
		},

		async fetchMessages(channelId, opts): Promise<FetchMessagesResult> {
			const params = new URLSearchParams();
			params.set('limit', String(opts.limit));
			if (opts.before) params.set('before', opts.before);
			const res = await fetchImpl(`${API}/channels/${channelId}/messages?${params}`, {
				headers,
			});

			if (res.status === 429) return { rateLimited: await retryAfterSeconds(res) };
			// 403 (no access), 404 (gone), 50001 (missing access) → skip the channel.
			if (res.status === 403 || res.status === 404) return { skip: true };
			if (!res.ok) return { skip: true };

			const raw = (await res.json()) as Array<{
				id: string;
				author?: { id?: string };
				timestamp: string;
				pinned?: boolean;
				mentions?: Array<{ id: string }>;
			}>;
			const messages: PurgeMessage[] = raw.map((m) => ({
				id: m.id,
				authorId: m.author?.id ?? '',
				timestamp: new Date(m.timestamp).getTime(),
				pinned: Boolean(m.pinned),
				mentionIds: Array.isArray(m.mentions) ? m.mentions.map((u) => u.id) : [],
			}));
			return { messages };
		},

		async bulkDelete(channelId, ids): Promise<DeleteResult> {
			const res = await fetchImpl(`${API}/channels/${channelId}/messages/bulk-delete`, {
				method: 'POST',
				headers,
				body: JSON.stringify({ messages: ids }),
			});
			if (res.status === 429) return { rateLimited: await retryAfterSeconds(res) };
			// Treat non-retryable failures as handled so the sweep advances rather
			// than looping forever on a permanently un-deletable message.
			return { ok: true };
		},

		async deleteMessage(channelId, id): Promise<DeleteResult> {
			const res = await fetchImpl(`${API}/channels/${channelId}/messages/${id}`, {
				method: 'DELETE',
				headers,
			});
			if (res.status === 429) return { rateLimited: await retryAfterSeconds(res) };
			return { ok: true };
		},
	};
}
