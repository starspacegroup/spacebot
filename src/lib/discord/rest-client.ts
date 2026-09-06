/**
 * Lightweight Discord REST Client
 *
 * Provides a Discord.js-compatible interface backed by the Discord REST API.
 * Used when the full Discord.js gateway client is unavailable (e.g., webhook
 * endpoints running on Cloudflare Workers).
 */

const API_BASE = 'https://discord.com/api/v10';

/**
 * Rate limiting.
 *
 * This client used to throw on any non-OK response, which meant a 429 became
 * `Error("You are being rate limited.")` and the message was simply lost — an
 * automation firing on a burst of GitHub webhooks would post most of its
 * messages and silently drop the rest. discord.js handles this for the gateway
 * path; nothing did on the Workers path, which is where integration events land.
 *
 * Two mechanisms, in order of preference:
 *
 * 1. **Don't get limited.** Discord returns the state of the bucket on every
 *    response (`X-RateLimit-Remaining`, `-Reset-After`, `-Bucket`). We remember
 *    it and wait out the window *before* spending the request that would have
 *    429'd. A burst then paces itself instead of failing.
 * 2. **Survive it anyway.** Buckets are shared across isolates and processes, so
 *    pacing can only ever be best-effort. A 429 that slips through is retried
 *    after exactly the delay Discord asked for.
 *
 * Waiting is bounded: this runs inside a request, so a long global limit is
 * reported to the caller rather than slept through.
 */
const MAX_ATTEMPTS = 4;
const MAX_TOTAL_WAIT_MS = 10_000;

/** Bucket state, keyed by Discord's bucket hash. Per-isolate, best effort. */
const buckets = new Map<string, { remaining: number; resetAt: number }>();
/** Global limits apply across every bucket, so they get their own gate. */
let globalResetAt = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Discord reports seconds (often fractional) in several places. */
function readRetryAfterMs(res: Response, body: any): number {
	const candidates = [
		typeof body?.retry_after === 'number' ? body.retry_after : null,
		Number(res.headers.get('retry-after')),
		Number(res.headers.get('x-ratelimit-reset-after')),
	];
	for (const seconds of candidates) {
		if (seconds != null && Number.isFinite(seconds) && seconds >= 0) {
			return Math.ceil(seconds * 1000);
		}
	}
	return 1000;
}

/** Remember what the response told us about the bucket we just spent from. */
function rememberBucket(res: Response, key: string) {
	const remaining = Number(res.headers.get('x-ratelimit-remaining'));
	const resetAfter = Number(res.headers.get('x-ratelimit-reset-after'));
	if (!Number.isFinite(remaining) || !Number.isFinite(resetAfter)) return;

	const bucket = res.headers.get('x-ratelimit-bucket') || key;
	buckets.set(bucket, { remaining, resetAt: Date.now() + resetAfter * 1000 });
}

/** How long to hold off before spending from this bucket, if at all. */
function pauseBeforeRequest(key: string): number {
	const now = Date.now();
	const waits = [globalResetAt - now];

	const bucket = buckets.get(key);
	if (bucket) {
		// Expired windows tell us nothing; drop them so the map cannot grow stale.
		if (bucket.resetAt <= now) buckets.delete(key);
		else if (bucket.remaining <= 0) waits.push(bucket.resetAt - now);
	}

	return Math.max(0, ...waits);
}

/**
 * The bucket a request belongs to, as Discord defines it: the route shape plus
 * its "major parameter" (channel, guild or webhook id). Two different channels
 * are limited independently, so they must not share a key.
 */
function bucketKey(method: string, path: string): string {
	const major = path.match(/^\/(channels|guilds|webhooks)\/(\d+)/);
	const route = path.replace(/\d{15,}/g, ':id');
	return `${method}:${route}${major ? `:${major[2]}` : ''}`;
}

async function discordFetch(botToken, path, options: Record<string, any> = {}) {
	const { method = 'GET', body, reason, formData } = options;
	const headers = {
		Authorization: `Bot ${botToken}`,
	};
	if (!formData) {
		headers['Content-Type'] = 'application/json';
	}
	if (reason) headers['X-Audit-Log-Reason'] = reason;

	const key = bucketKey(method, path);
	let waited = 0;

	for (let attempt = 1; ; attempt++) {
		const pause = Math.min(pauseBeforeRequest(key), MAX_TOTAL_WAIT_MS - waited);
		if (pause > 0) {
			waited += pause;
			await sleep(pause);
		}

		const res = await fetch(`${API_BASE}${path}`, {
			method,
			headers,
			body: formData || (body != null ? JSON.stringify(body) : undefined),
		});

		rememberBucket(res, key);

		if (res.status === 429) {
			const data = await res.json().catch(() => ({}));
			const retryAfterMs = readRetryAfterMs(res, data);

			// A global limit stalls every bucket, not just this one.
			if (data?.global || res.headers.get('x-ratelimit-scope') === 'global') {
				globalResetAt = Date.now() + retryAfterMs;
			}

			const canRetry = attempt < MAX_ATTEMPTS && waited + retryAfterMs <= MAX_TOTAL_WAIT_MS;
			if (canRetry) {
				waited += retryAfterMs;
				await sleep(retryAfterMs);
				continue;
			}

			// Out of budget. Say so precisely, and carry the numbers so the caller can
			// decide to reschedule rather than just recording "rate limited".
			const error: any = new Error(
				`Discord rate limited: retry after ${(retryAfterMs / 1000).toFixed(1)}s ` +
					`(gave up after ${attempt} attempt${attempt === 1 ? '' : 's'})`
			);
			error.status = 429;
			error.retryAfterMs = retryAfterMs;
			error.rateLimited = true;
			throw error;
		}

		if (!res.ok) {
			const data = await res.json().catch(() => ({}));
			const error: any = new Error(data.message || `Discord API ${res.status}`);
			error.status = res.status;
			throw error;
		}

		if (res.status === 204) return null;
		return res.json();
	}
}

/** Permission overwrite target types. */
export const OVERWRITE_TYPE_ROLE = 0;
export const OVERWRITE_TYPE_MEMBER = 1;

/**
 * Channel permission overwrite operations for one channel id.
 *
 * Discord's overwrite endpoint is a full replace, not a merge: whatever `allow`
 * and `deny` are sent become the overwrite. Callers that want to change one bit
 * must read the current overwrite and send the whole pair back.
 *
 * A bot can only grant permissions it holds itself; granting more comes back as
 * 403 Missing Permissions.
 */
function buildPermissionOverwrites(token, channelId) {
	return {
		/**
		 * Create or replace one overwrite.
		 * @param {string} overwriteId Role or member id.
		 * @param {{allow?: string|bigint, deny?: string|bigint, type?: number}} perms
		 */
		async set(
			overwriteId,
			{ allow = '0', deny = '0', type = OVERWRITE_TYPE_MEMBER } = {},
			reason?
		) {
			return discordFetch(token, `/channels/${channelId}/permissions/${overwriteId}`, {
				method: 'PUT',
				body: { allow: String(allow), deny: String(deny), type },
				reason,
			});
		},
		/** Remove one overwrite entirely. */
		async delete(overwriteId, reason?) {
			return discordFetch(token, `/channels/${channelId}/permissions/${overwriteId}`, {
				method: 'DELETE',
				reason,
			});
		},
	};
}

// ---------------------------------------------------------------------------
// Channel wrapper  — returned by discord.channels.fetch(id)
// ---------------------------------------------------------------------------
function wrapChannel(token, data) {
	return {
		...data,
		/** PATCH the channel (name, user_limit, topic, parent_id, …). */
		async edit(patch, reason) {
			return discordFetch(token, `/channels/${data.id}`, {
				method: 'PATCH',
				body: patch,
				reason,
			});
		},
		/** Delete the channel. Returns the deleted channel object. */
		async delete(reason) {
			return discordFetch(token, `/channels/${data.id}`, {
				method: 'DELETE',
				reason,
			});
		},
		permissionOverwrites: buildPermissionOverwrites(token, data.id),
		async send(payload) {
			const body = typeof payload === 'string' ? { content: payload } : payload;

			if (body?.files && Array.isArray(body.files) && body.files.length > 0) {
				const { files, ...payloadBody } = body;
				const formData = new FormData();
				formData.append('payload_json', JSON.stringify(payloadBody));

				files.forEach((file, index) => {
					const attachment = file?.attachment;
					const name = file?.name || `file-${index}.png`;
					const blob =
						attachment instanceof Blob
							? attachment
							: new Blob([attachment], { type: 'image/png' });
					formData.append(`files[${index}]`, blob, name);
				});

				return discordFetch(token, `/channels/${data.id}/messages`, {
					method: 'POST',
					formData,
				});
			}

			return discordFetch(token, `/channels/${data.id}/messages`, {
				method: 'POST',
				body,
			});
		},
		messages: {
			async fetch(idOrOpts) {
				if (typeof idOrOpts === 'string') {
					return discordFetch(token, `/channels/${data.id}/messages/${idOrOpts}`);
				}
				const limit = idOrOpts?.limit ?? 50;
				const msgs = await discordFetch(
					token,
					`/channels/${data.id}/messages?limit=${limit}`
				);
				// Return a Map-like collection matching Discord.js interface
				const map: any = new Map(
					msgs.map((m) => [
						m.id,
						{
							...m,
							author: m.author,
							createdTimestamp: new Date(m.timestamp).getTime(),
							async delete() {
								return discordFetch(
									token,
									`/channels/${data.id}/messages/${m.id}`,
									{ method: 'DELETE' }
								);
							},
							async react(emoji) {
								const encoded = encodeURIComponent(emoji);
								return discordFetch(
									token,
									`/channels/${data.id}/messages/${m.id}/reactions/${encoded}/@me`,
									{ method: 'PUT' }
								);
							},
						},
					])
				);
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
				? messages.map((m) => (typeof m === 'string' ? m : m.id))
				: [...messages.values()].map((m) => m.id);
			if (ids.length < 2) {
				for (const id of ids) {
					await discordFetch(token, `/channels/${data.id}/messages/${id}`, {
						method: 'DELETE',
					});
				}
				return;
			}
			return discordFetch(token, `/channels/${data.id}/messages/bulk-delete`, {
				method: 'POST',
				body: { messages: ids },
			});
		},
		threads: {
			async create({ name, autoArchiveDuration }) {
				return discordFetch(token, `/channels/${data.id}/threads`, {
					method: 'POST',
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
				return discordFetch(token, `/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
					method: 'PUT',
				});
			},
			async remove(roleId) {
				return discordFetch(token, `/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
					method: 'DELETE',
				});
			},
		},
		async kick(reason) {
			return discordFetch(token, `/guilds/${guildId}/members/${userId}`, {
				method: 'DELETE',
				reason,
			});
		},
		async timeout(durationMs, reason) {
			const until = durationMs ? new Date(Date.now() + durationMs).toISOString() : null;
			return discordFetch(token, `/guilds/${guildId}/members/${userId}`, {
				method: 'PATCH',
				body: { communication_disabled_until: until },
				reason,
			});
		},
		voice: {
			channelId: data.voice_state?.channel_id ?? null,
			async setMute(mute, reason) {
				return discordFetch(token, `/guilds/${guildId}/members/${userId}`, {
					method: 'PATCH',
					body: { mute },
					reason,
				});
			},
			async setDeaf(deaf, reason) {
				return discordFetch(token, `/guilds/${guildId}/members/${userId}`, {
					method: 'PATCH',
					body: { deaf },
					reason,
				});
			},
			/**
			 * Move the member into a voice channel, or disconnect them when
			 * `channelId` is null. Requires MOVE_MEMBERS.
			 */
			async setChannel(channelId, reason) {
				return discordFetch(token, `/guilds/${guildId}/members/${userId}`, {
					method: 'PATCH',
					body: { channel_id: channelId ?? null },
					reason,
				});
			},
			async disconnect(reason) {
				return discordFetch(token, `/guilds/${guildId}/members/${userId}`, {
					method: 'PATCH',
					body: { channel_id: null },
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
			/**
			 * Edit a channel by id, without the GET that `fetch().edit()` costs.
			 */
			async edit(channelId, patch, reason?) {
				return discordFetch(botToken, `/channels/${channelId}`, {
					method: 'PATCH',
					body: patch,
					reason,
				});
			},
			/**
			 * Delete a channel by id. Callers reaping a channel that may already
			 * be gone should treat a 404 (`error.status === 404`) as success.
			 */
			async delete(channelId, reason?) {
				return discordFetch(botToken, `/channels/${channelId}`, {
					method: 'DELETE',
					reason,
				});
			},
			permissions(channelId) {
				return buildPermissionOverwrites(botToken, channelId);
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
								`/guilds/${guildId}/members/${userId}`
							);
							return wrapMember(botToken, guildId, mdata);
						},
						async ban(
							userId,
							{ reason, deleteMessageSeconds }: Record<string, any> = {}
						) {
							return discordFetch(botToken, `/guilds/${guildId}/bans/${userId}`, {
								method: 'PUT',
								body: { delete_message_seconds: deleteMessageSeconds },
								reason,
							});
						},
					},
					channels: {
						async fetch() {
							const chs = await discordFetch(botToken, `/guilds/${guildId}/channels`);
							return new Map(chs.map((c) => [c.id, wrapChannel(botToken, c)]));
						},
						/**
						 * Create a guild channel.
						 *
						 * `permissionOverwrites` is the array Discord expects
						 * ({ id, type, allow, deny }); passing it at creation is
						 * what makes a private room private from the first frame
						 * instead of briefly visible to @everyone.
						 */
						async create({
							name,
							type,
							parent,
							topic,
							permissionOverwrites,
							userLimit,
							rateLimitPerUser,
							position,
							bitrate,
							nsfw,
							reason,
						}: Record<string, any>) {
							const body: Record<string, any> = { name, type };
							if (parent !== undefined) body.parent_id = parent;
							if (topic !== undefined) body.topic = topic;
							if (permissionOverwrites !== undefined)
								body.permission_overwrites = permissionOverwrites;
							if (userLimit !== undefined) body.user_limit = userLimit;
							if (rateLimitPerUser !== undefined)
								body.rate_limit_per_user = rateLimitPerUser;
							if (position !== undefined) body.position = position;
							if (bitrate !== undefined) body.bitrate = bitrate;
							if (nsfw !== undefined) body.nsfw = nsfw;

							return discordFetch(botToken, `/guilds/${guildId}/channels`, {
								method: 'POST',
								body,
								reason,
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
							method: 'POST',
							body: { recipient_id: userId },
						});
						const body = typeof payload === 'string' ? { content: payload } : payload;

						if (body?.files && Array.isArray(body.files) && body.files.length > 0) {
							const { files, ...payloadBody } = body;
							const formData = new FormData();
							formData.append('payload_json', JSON.stringify(payloadBody));

							files.forEach((file, index) => {
								const attachment = file?.attachment;
								const name = file?.name || `file-${index}.png`;
								const blob =
									attachment instanceof Blob
										? attachment
										: new Blob([attachment], { type: 'image/png' });
								formData.append(`files[${index}]`, blob, name);
							});

							return discordFetch(botToken, `/channels/${dm.id}/messages`, {
								method: 'POST',
								formData,
							});
						}

						return discordFetch(botToken, `/channels/${dm.id}/messages`, {
							method: 'POST',
							body,
						});
					},
				};
			},
		},
	};
}
