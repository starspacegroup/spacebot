/**
 * Incoming webhooks: URLs an outside service POSTs to, to fire a server's automations.
 * (The `webhooks` table is OUTGOING; see webhooks.ts.) The secret is stored as a SHA-256
 * hash. The raw value exists only in the return of create/rotate.
 */
import { log } from './logger.js';
import { getServerPlan, inboundWebhookLimit } from './server-plans.js';

export interface InboundWebhook {
	id: number;
	guild_id: string;
	public_id: string;
	name: string;
	description: string;
	secret_prefix: string | null;
	enabled: boolean;
	created_by: string;
	created_at: string;
	updated_at: string;
	last_received_at: string | null;
	receive_count: number;
	last_status: string | null;
}

export type InboundResult<T = {}> =
	({ ok: true } & T) | { ok: false; status: number; error: string };

const hex = (bytes: Uint8Array) =>
	Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(s: string): Promise<string> {
	return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
}

/** Constant-time string compare (both inputs are hex digests of equal length). */
export function safeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

export function generateWebhookSecret(): string {
	const b = new Uint8Array(32);
	crypto.getRandomValues(b);
	return `sbw_${hex(b)}`;
}

function generatePublicId(): string {
	const b = new Uint8Array(16);
	crypto.getRandomValues(b);
	return hex(b);
}

export function webhookUrl(origin: string, publicId: string): string {
	return `${origin.replace(/\/$/, '')}/api/hooks/${publicId}`;
}

const COLUMNS =
	'id, guild_id, public_id, name, description, secret_prefix, enabled, created_by, created_at, updated_at, last_received_at, receive_count, last_status';

/** Pick the public fields by name, so a secret hash or counter can never ride along. */
function toHook(row: any): InboundWebhook {
	return {
		id: row.id,
		guild_id: row.guild_id,
		public_id: row.public_id,
		name: row.name,
		description: row.description || '',
		secret_prefix: row.secret_prefix ?? null,
		enabled: Boolean(row.enabled),
		created_by: row.created_by,
		created_at: row.created_at,
		updated_at: row.updated_at,
		last_received_at: row.last_received_at ?? null,
		receive_count: row.receive_count ?? 0,
		last_status: row.last_status ?? null,
	};
}

export async function listInboundWebhooks(db: any, guildId: string): Promise<InboundWebhook[]> {
	if (!db || !guildId) return [];
	try {
		const r = await db
			.prepare(`SELECT ${COLUMNS} FROM inbound_webhooks WHERE guild_id = ? ORDER BY name ASC`)
			.bind(guildId)
			.all();
		return (r.results || []).map(toHook);
	} catch (err) {
		log.error('[InboundWebhooks] list failed:', err);
		return [];
	}
}

/** One hook by numeric id or public id, inside one guild. */
export async function getInboundWebhook(
	db: any,
	guildId: string,
	idOrPublicId: string | number
): Promise<InboundWebhook | null> {
	if (!db || !guildId) return null;
	const key = String(idOrPublicId);
	const row = await db
		.prepare(
			`SELECT ${COLUMNS} FROM inbound_webhooks WHERE guild_id = ? AND (public_id = ? OR id = ?)`
		)
		.bind(guildId, key, /^\d+$/.test(key) ? Number(key) : -1)
		.first();
	return row ? toHook(row) : null;
}

export async function createInboundWebhook(
	db: any,
	guildId: string,
	input: { name: unknown; description?: unknown; created_by: string }
): Promise<InboundResult<{ webhook: InboundWebhook; secret: string }>> {
	const name = typeof input.name === 'string' ? input.name.trim() : '';
	if (!name || name.length > 64) {
		return { ok: false, status: 400, error: 'Name is required (1-64 characters)' };
	}
	const description =
		typeof input.description === 'string' ? input.description.trim().slice(0, 300) : '';

	const existing = await listInboundWebhooks(db, guildId);
	const plan = await getServerPlan(db, guildId);
	const limit = inboundWebhookLimit(plan);
	if (limit !== null && existing.length >= limit) {
		return {
			ok: false,
			status: 403,
			error: `Incoming webhook limit reached (${existing.length}/${limit}). Upgrade your plan or delete one first.`,
		};
	}
	if (existing.some((h) => h.name.toLowerCase() === name.toLowerCase())) {
		return { ok: false, status: 409, error: 'A webhook with that name already exists' };
	}

	const secret = generateWebhookSecret();
	const publicId = generatePublicId();
	try {
		await db
			.prepare(
				`INSERT INTO inbound_webhooks (guild_id, public_id, name, description, secret_hash, secret_prefix, created_by)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(
				guildId,
				publicId,
				name,
				description,
				await sha256Hex(secret),
				secret.slice(0, 8),
				input.created_by
			)
			.run();
	} catch (err: any) {
		if (String(err?.message).includes('UNIQUE')) {
			return { ok: false, status: 409, error: 'A webhook with that name already exists' };
		}
		log.error('[InboundWebhooks] create failed:', err);
		return { ok: false, status: 500, error: 'Failed to create webhook' };
	}
	const webhook = (await getInboundWebhook(db, guildId, publicId))!;
	return { ok: true, webhook, secret };
}

export async function rotateInboundWebhookSecret(
	db: any,
	guildId: string,
	idOrPublicId: string | number
): Promise<InboundResult<{ webhook: InboundWebhook; secret: string }>> {
	const hook = await getInboundWebhook(db, guildId, idOrPublicId);
	if (!hook) return { ok: false, status: 404, error: 'Webhook not found' };
	const secret = generateWebhookSecret();
	await db
		.prepare(
			`UPDATE inbound_webhooks SET secret_hash = ?, secret_prefix = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND guild_id = ?`
		)
		.bind(await sha256Hex(secret), secret.slice(0, 8), hook.id, guildId)
		.run();
	return { ok: true, webhook: (await getInboundWebhook(db, guildId, hook.id))!, secret };
}

export async function setInboundWebhookEnabled(
	db: any,
	guildId: string,
	idOrPublicId: string | number,
	enabled: boolean
): Promise<InboundResult<{ webhook: InboundWebhook }>> {
	const hook = await getInboundWebhook(db, guildId, idOrPublicId);
	if (!hook) return { ok: false, status: 404, error: 'Webhook not found' };
	await db
		.prepare(
			`UPDATE inbound_webhooks SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND guild_id = ?`
		)
		.bind(enabled ? 1 : 0, hook.id, guildId)
		.run();
	return { ok: true, webhook: { ...hook, enabled } };
}

export async function deleteInboundWebhook(
	db: any,
	guildId: string,
	idOrPublicId: string | number
): Promise<InboundResult> {
	const hook = await getInboundWebhook(db, guildId, idOrPublicId);
	if (!hook) return { ok: false, status: 404, error: 'Webhook not found' };
	await db
		.prepare('DELETE FROM inbound_webhooks WHERE id = ? AND guild_id = ?')
		.bind(hook.id, guildId)
		.run();
	return { ok: true };
}

/** The row the receiving route needs, by public id. Includes the secret hash and counter. */
export async function getInboundWebhookForReceive(db: any, publicId: string) {
	if (!/^[0-9a-f]{32}$/.test(publicId)) return null;
	return db
		.prepare(
			'SELECT id, guild_id, name, enabled, secret_hash, rate_window_start, rate_window_count FROM inbound_webhooks WHERE public_id = ?'
		)
		.bind(publicId)
		.first();
}

export async function recordInboundWebhookCall(
	db: any,
	id: number,
	status: string,
	window?: { start: number; count: number }
) {
	try {
		if (window) {
			await db
				.prepare(
					`UPDATE inbound_webhooks SET last_received_at = CURRENT_TIMESTAMP, receive_count = receive_count + 1,
					 last_status = ?, rate_window_start = ?, rate_window_count = ? WHERE id = ?`
				)
				.bind(status, window.start, window.count, id)
				.run();
		} else {
			await db
				.prepare('UPDATE inbound_webhooks SET last_status = ? WHERE id = ?')
				.bind(status, id)
				.run();
		}
	} catch (err) {
		log.warn('[InboundWebhooks] record failed:', err);
	}
}
