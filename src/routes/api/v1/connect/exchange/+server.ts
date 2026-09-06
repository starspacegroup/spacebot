/**
 * Connect: exchange a one-time code for an API key.
 *
 * POST /api/v1/connect/exchange
 * { "client_id": "...", "client_secret": "...", "code": "...", "redirect_uri": "..." }
 *
 * Server-to-server only. This is the step that keeps the key out of the
 * browser: the consent redirect carries a code, which is worthless without the
 * client secret, and the key itself is only ever returned in this response
 * body — never in a URL, a referrer header, or an access log.
 *
 * The key is minted HERE, not at approval time. An approval nobody redeems
 * leaves no credential behind to leak, and there is never a window where a raw
 * key sits in the database waiting to be collected.
 *
 * Auth: the client secret in the body. Deliberately not the Bearer header —
 * this is the one endpoint a caller reaches before it has a key.
 */

import { json } from '@sveltejs/kit';
import { createApiKey } from '$lib/db/api-keys.js';
import {
	consumeAuthorizationCode,
	touchConnectClient,
	verifyClientSecret,
} from '$lib/db/connect-clients.js';
import { log } from '$lib/db/logger.js';

/**
 * One rejection message for every failure mode.
 *
 * A caller probing this endpoint should not be able to tell an unknown client
 * from a wrong secret from a spent code — each distinction is a rung on a
 * ladder.
 */
const REJECTED = { error: 'Invalid client credentials or authorization code' };

/** @type {import('./$types').RequestHandler} */
export async function POST({ request, platform }) {
	const db = (platform as any)?.env?.DB;
	if (!db) {
		return json({ error: 'Database not available' }, { status: 503 });
	}

	let body: Record<string, any>;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const clientId = String(body?.client_id || '').trim();
	const clientSecret = String(body?.client_secret || '');
	const code = String(body?.code || '');
	const redirectUri = String(body?.redirect_uri || '').trim();

	if (!clientId || !clientSecret || !code || !redirectUri) {
		return json(
			{ error: 'client_id, client_secret, code and redirect_uri are all required' },
			{ status: 400 }
		);
	}

	const client = await verifyClientSecret(db, clientId, clientSecret);
	if (!client) {
		log.warn(`[Connect] Exchange rejected: bad credentials for client ${clientId}`);
		return json(REJECTED, { status: 401 });
	}

	// Belt and braces: the code is already bound to a redirect_uri, but a
	// registration that changed since approval should not be redeemable either.
	if (!client.redirect_uris.includes(redirectUri)) {
		return json(REJECTED, { status: 400 });
	}

	// Single-use, and only after the secret checked out — a stolen code alone
	// cannot be burned by an attacker to deny the real exchange.
	const consumed = await consumeAuthorizationCode(db, { code, clientId, redirectUri });
	if (!consumed.success) {
		return json(REJECTED, { status: 400 });
	}

	const created = await createApiKey(db, consumed.guildId, {
		name: `${client.name} (Connect)`,
		description: `Issued by the Connect handshake to ${client.client_id}`,
		scopes: consumed.scopes,
		created_by: consumed.approvedBy,
		expires_at: null,
	});

	if (!created.success) {
		// The code is spent; say so plainly rather than implying a retry will
		// work. The admin has to approve again.
		log.error(`[Connect] Key creation failed after exchange for ${clientId}:`, created.error);
		return json(
			{
				error: 'Approval was accepted but the key could not be created. Please connect again.',
			},
			{ status: 500 }
		);
	}

	await touchConnectClient(db, clientId);
	log.info(`[Connect] Issued a key to ${clientId} for guild ${consumed.guildId}`);

	return json({
		api_key: created.rawKey,
		guild_id: consumed.guildId,
		scopes: consumed.scopes,
	});
}
