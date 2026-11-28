/**
 * Incoming-webhook actions for API keys (REST v1 and MCP). Both doors call these, so the plan
 * limit, the secret handling and the audit log are written once. Reads never include a secret.
 * Delete is deliberately not offered: it breaks live senders, so it stays on the dashboard.
 */
import {
	createInboundWebhook,
	getInboundWebhook,
	listInboundWebhooks,
	rotateInboundWebhookSecret,
	setInboundWebhookEnabled,
	webhookUrl,
	type InboundWebhook,
} from '$lib/db/inbound-webhooks.js';
import { logApiKeyWrite, type ControlResult } from './control-actions.js';

type Auth = { guildId?: string; keyId?: number };

export function webhookView(h: InboundWebhook, origin: string) {
	return {
		id: h.id,
		name: h.name,
		description: h.description,
		url: webhookUrl(origin, h.public_id),
		enabled: h.enabled,
		secret_prefix: h.secret_prefix,
		last_received_at: h.last_received_at,
		receive_count: h.receive_count,
		last_status: h.last_status,
		created_at: h.created_at,
	};
}

export async function apiListWebhooks(db, auth: Auth, origin: string) {
	const hooks = await listInboundWebhooks(db, auth.guildId!);
	return { webhooks: hooks.map((h) => webhookView(h, origin)) };
}

export async function apiGetWebhook(
	db,
	auth: Auth,
	origin: string,
	id: string | number
): Promise<ControlResult> {
	const h = await getInboundWebhook(db, auth.guildId!, id);
	if (!h) return { ok: false, status: 404, error: 'Webhook not found' };
	return { ok: true, webhook: webhookView(h, origin) };
}

export async function apiCreateWebhook(
	db,
	auth: Auth,
	origin: string,
	input: { name?: unknown; description?: unknown },
	via: 'api' | 'mcp'
): Promise<ControlResult> {
	const r = await createInboundWebhook(db, auth.guildId!, {
		name: input.name,
		description: input.description,
		created_by: `api_key:${auth.keyId}`,
	});
	if (!r.ok) return r;
	await logApiKeyWrite(
		db,
		auth,
		'API_WEBHOOK_CREATED',
		{ id: r.webhook.id, name: r.webhook.name },
		{ via }
	);
	return {
		ok: true,
		webhook: webhookView(r.webhook, origin),
		secret: r.secret,
		note: 'This is the only time the secret is shown. Send it as "Authorization: Bearer <secret>".',
	};
}

export async function apiRotateWebhookSecret(
	db,
	auth: Auth,
	origin: string,
	id: string | number,
	via: 'api' | 'mcp'
): Promise<ControlResult> {
	const r = await rotateInboundWebhookSecret(db, auth.guildId!, id);
	if (!r.ok) return r;
	await logApiKeyWrite(
		db,
		auth,
		'API_WEBHOOK_ROTATED',
		{ id: r.webhook.id, name: r.webhook.name },
		{ via }
	);
	return {
		ok: true,
		webhook: webhookView(r.webhook, origin),
		secret: r.secret,
		note: 'The old secret no longer works. This is the only time the new one is shown.',
	};
}

export async function apiSetWebhookEnabled(
	db,
	auth: Auth,
	origin: string,
	id: string | number,
	enabled: unknown,
	via: 'api' | 'mcp'
): Promise<ControlResult> {
	if (typeof enabled !== 'boolean')
		return { ok: false, status: 400, error: 'enabled must be a boolean' };
	const r = await setInboundWebhookEnabled(db, auth.guildId!, id, enabled);
	if (!r.ok) return r;
	await logApiKeyWrite(
		db,
		auth,
		'API_WEBHOOK_TOGGLED',
		{ id: r.webhook.id, name: r.webhook.name },
		{ enabled, via }
	);
	return { ok: true, webhook: webhookView(r.webhook, origin) };
}
