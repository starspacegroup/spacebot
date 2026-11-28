/**
 * Incoming webhook receiver
 *
 * POST /api/hooks/<public_id>
 * Authorization: Bearer sbw_...   (the hook's secret; shown once when the hook is made)
 *
 * Fires the server's automations whose trigger is "Webhook received" (event WEBHOOK_RECEIVED).
 * The JSON body becomes {webhook.<path>} variables; non-JSON text is {webhook.body}.
 *
 * The accept/refuse rule is the proved core in dafny/WebhookGate.dfy. An unknown hook, a disabled
 * hook and a wrong secret get the same answer. Hooks belong to one server and never reach another.
 */

import { json } from '@sveltejs/kit';
import { log, logEvent } from '$lib/db/logger.js';
import {
	getInboundWebhookForReceive,
	recordInboundWebhookCall,
	safeEqual,
	sha256Hex,
} from '$lib/db/inbound-webhooks.js';
import { decideWebhook, nextWebhookWindow, MAX_BODY_BYTES } from '$lib/server/webhook-gate.js';
import { buildWebhookVariables } from '$lib/server/webhook-payload.js';
import { processAutomations } from '$lib/automation/engine.js';
import { createDiscordRestClient } from '$lib/discord/rest-client.js';
import { getLatestServerStats } from '$lib/db/server-stats.js';
import { getGuildMetadata } from '$lib/db/guild-metadata.js';

function getEnv(platform: any, name: string) {
	return (
		platform?.env?.[name] ?? (typeof process !== 'undefined' ? process.env?.[name] : undefined)
	);
}

const UNAUTHORIZED = () => json({ error: 'Unauthorized' }, { status: 401 });

/** Read the body but stop once it passes the cap. */
async function readCapped(request: Request): Promise<string | null> {
	const declared = Number(request.headers.get('content-length'));
	if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
	const reader = request.body?.getReader();
	if (!reader) return '';
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > MAX_BODY_BYTES) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}
	const all = new Uint8Array(total);
	let off = 0;
	for (const c of chunks) {
		all.set(c, off);
		off += c.byteLength;
	}
	return new TextDecoder().decode(all);
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ request, params, platform }) {
	const db = (platform as any)?.env?.DB;
	if (!db) return json({ error: 'Database not available' }, { status: 500 });

	const hook = await getInboundWebhookForReceive(db, params.publicId);

	const auth = request.headers.get('authorization') || '';
	const presented = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
	// Hash even when the hook is missing, so timing does not tell the two apart.
	const presentedHash = await sha256Hex(presented);
	const secretMatches = !!hook && !!presented && safeEqual(presentedHash, hook.secret_hash);

	const body = await readCapped(request);
	const nowSec = Math.floor(Date.now() / 1000);
	const verdict = decideWebhook({
		found: !!hook,
		enabled: !!hook?.enabled,
		secretMatches,
		bodyBytes: body === null ? MAX_BODY_BYTES + 1 : new TextEncoder().encode(body).byteLength,
		windowStart: hook?.rate_window_start ?? 0,
		windowCount: hook?.rate_window_count ?? 0,
		nowSec,
	});

	if (verdict === 'unauthorized') {
		log.warn(`[InboundWebhook] refused (hook ${params.publicId.slice(0, 8)})`);
		return UNAUTHORIZED();
	}
	if (verdict === 'too_large') {
		await recordInboundWebhookCall(db, hook.id, 'too_large');
		return json({ error: `Body too large (max ${MAX_BODY_BYTES} bytes)` }, { status: 413 });
	}
	if (verdict === 'rate_limited') {
		await recordInboundWebhookCall(db, hook.id, 'rate_limited');
		return json(
			{ error: 'Rate limit exceeded' },
			{ status: 429, headers: { 'Retry-After': String(60 - (nowSec % 60)) } }
		);
	}

	const text = body ?? '';
	let parsed: unknown;
	try {
		parsed = text.trim() ? JSON.parse(text) : undefined;
	} catch {
		parsed = undefined;
	}

	const guildId: string = hook.guild_id;
	const event: any = {
		event_type: 'WEBHOOK_RECEIVED',
		event_category: 'webhook',
		guild_id: guildId,
		actor_id: null,
		actor_name: hook.name,
		details: {
			webhook_id: hook.id,
			webhook_name: hook.name,
			bytes: text.length,
			json: parsed !== undefined,
			keys:
				parsed && typeof parsed === 'object' && !Array.isArray(parsed)
					? Object.keys(parsed as object).slice(0, 20)
					: [],
		},
		summary: `Webhook "${hook.name}" received`,
		_webhook_vars: buildWebhookVariables(hook.name, text, parsed),
	};

	try {
		await logEvent(db, event);
	} catch (err: any) {
		log.warn(`[InboundWebhook] Failed to log event: ${err.message}`);
	}

	let executed = 0;
	try {
		const botToken = getEnv(platform, 'DISCORD_BOT_TOKEN');
		event._widget_signing_secret = getEnv(platform, 'DISCORD_PUBLIC_KEY');
		event._widget_origin =
			getEnv(platform, 'APP_URL') || getEnv(platform, 'API_BASE') || 'http://localhost:4269';
		const discord = botToken ? createDiscordRestClient(botToken) : null;
		const [guildMeta, guildStats] = await Promise.all([
			getGuildMetadata(db, guildId).catch(() => null),
			getLatestServerStats(db, guildId).catch(() => null),
		]);
		const guildInfo = {
			name: guildMeta?.name || 'Unknown Server',
			member_count: guildStats?.member_count ?? guildMeta?.approximate_member_count ?? null,
			human_count: guildStats?.human_count ?? null,
			bot_count: guildStats?.bot_count ?? null,
			boost_count: guildStats?.boost_count ?? guildMeta?.premium_subscription_count ?? null,
			boost_level: guildStats?.boost_level ?? guildMeta?.premium_tier ?? null,
		};
		const result = await processAutomations(event, db, discord, guildInfo, {});
		executed = result?.executed ?? 0;
	} catch (err: any) {
		log.error(`[InboundWebhook] Automation processing error: ${err.message}`);
	}

	await recordInboundWebhookCall(
		db,
		hook.id,
		'accepted',
		nextWebhookWindow(hook.rate_window_start, hook.rate_window_count, nowSec)
	);
	return json({ success: true, automations_triggered: executed }, { status: 202 });
}
