/**
 * Connect: SpaceBot as an authorization server.
 *
 * A registered site sends a server admin to `/connect`; they approve a scope
 * grant for one of their guilds; the site exchanges a one-time code for an API
 * key over a server-to-server call. The admin never copies a key, and the key
 * never passes through a browser, a URL, a referrer header or an access log.
 *
 * The security properties this module is responsible for:
 *
 * - **Redirect URIs are an exact-match allowlist.** Prefix matching is not
 *   good enough — one open redirect or path quirk on the client's own domain
 *   would turn into key theft.
 * - **A client can never request more than it was registered for**, and the
 *   admin's approval only ever narrows that further.
 * - **Codes are single-use, short-lived, and stored only as a hash**, so a
 *   database read cannot replay one.
 * - **No key exists until the code is redeemed.** An approval nobody exchanges
 *   leaves no credential behind to leak.
 * - **The client secret is compared in constant time**, against a hash.
 */

import { log } from '../log.js';
import { API_KEY_SCOPES } from './api-keys.js';

/** How long an authorization code stays redeemable. */
export const CODE_TTL_SECONDS = 120;

/** Bytes of entropy in a code and in a client secret. */
const SECRET_BYTES = 32;

function toHex(bytes: Uint8Array): string {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A URL-safe, 256-bit random token. */
function randomToken(): string {
	const bytes = new Uint8Array(SECRET_BYTES);
	crypto.getRandomValues(bytes);
	return toHex(bytes);
}

export function generateAuthorizationCode(): string {
	return `sbc_${randomToken()}`;
}

export function generateClientSecret(): string {
	return `sbcs_${randomToken()}`;
}

/** SHA-256, hex encoded. The same shape API keys use. */
export async function hashToken(token: string): Promise<string> {
	const data = new TextEncoder().encode(token);
	const digest = await crypto.subtle.digest('SHA-256', data);
	return toHex(new Uint8Array(digest));
}

/**
 * Constant-time comparison of two hex digests.
 *
 * A plain `===` leaks how many leading characters matched through its timing,
 * which is enough to walk a secret out one nibble at a time given enough
 * attempts.
 */
export function timingSafeEqual(a: string, b: string): boolean {
	if (typeof a !== 'string' || typeof b !== 'string') return false;
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}

/**
 * Read a timestamp written by SQLite (`CURRENT_TIMESTAMP`, zone-less UTC) or an
 * ISO string. Returns null for anything unparseable, which callers must treat
 * as expired.
 */
export function parseSqliteTime(value: unknown): Date | null {
	if (!value) return null;
	const str = String(value).trim();
	if (!str) return null;
	const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(str)
		? `${str.replace(' ', 'T')}Z`
		: str;
	const parsed = new Date(normalized);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseJsonArray(value: unknown): string[] {
	if (Array.isArray(value)) return value.map(String);
	if (typeof value !== 'string' || value === '') return [];
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) ? parsed.map(String) : [];
	} catch {
		return [];
	}
}

export function parseConnectClient(row: any) {
	if (!row) return null;
	return {
		client_id: row.client_id,
		name: row.name,
		description: row.description,
		redirect_uris: parseJsonArray(row.redirect_uris),
		allowed_scopes: parseJsonArray(row.allowed_scopes),
		enabled: row.enabled === 1 || row.enabled === true,
		created_at: row.created_at,
		last_used_at: row.last_used_at,
		// Deliberately not spread: `client_secret_hash` must never leave here.
	};
}

/**
 * Validate a redirect URI for registration.
 *
 * https only (except explicit localhost, for development), absolute, and no
 * fragment — a fragment would let the client's own page silently reinterpret
 * where the code lands.
 */
export function validateRedirectUri(value: string): { valid: boolean; error?: string } {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return { valid: false, error: `Not a valid absolute URL: ${value}` };
	}

	const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalhost)) {
		return { valid: false, error: `Redirect URIs must use https: ${value}` };
	}
	if (url.hash) {
		return { valid: false, error: `Redirect URIs must not contain a fragment: ${value}` };
	}
	return { valid: true };
}

/** Reject scopes SpaceBot does not define. */
export function validateScopes(scopes: string[]): { valid: boolean; error?: string } {
	const known = Object.keys(API_KEY_SCOPES);
	const unknown = scopes.filter((scope) => !known.includes(scope));
	if (unknown.length > 0) {
		return { valid: false, error: `Unknown scopes: ${unknown.join(', ')}` };
	}
	return { valid: true };
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

export async function getConnectClient(db, clientId) {
	if (!db || !clientId) return null;
	try {
		const row = await db
			.prepare(`SELECT * FROM connect_clients WHERE client_id = ?`)
			.bind(String(clientId))
			.first();
		return parseConnectClient(row);
	} catch (error) {
		log.error('[Connect] Failed to load client:', error);
		return null;
	}
}

export async function listConnectClients(db) {
	if (!db) return [];
	try {
		const result = await db
			.prepare(`SELECT * FROM connect_clients ORDER BY name COLLATE NOCASE`)
			.all();
		return (result.results || []).map(parseConnectClient);
	} catch (error) {
		log.error('[Connect] Failed to list clients:', error);
		return [];
	}
}

/**
 * Register a client. Returns the secret ONCE — it is stored only as a hash and
 * cannot be recovered afterwards.
 */
export async function createConnectClient(db, data: Record<string, any>) {
	if (!db) return { success: false, error: 'Database not available' };

	const clientId = String(data.client_id || '').trim();
	if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(clientId)) {
		return {
			success: false,
			error: 'Client ID must be 2-64 lowercase letters, digits or dashes',
		};
	}
	if (!data.name) return { success: false, error: 'Client name is required' };

	const redirectUris = Array.isArray(data.redirect_uris) ? data.redirect_uris.map(String) : [];
	if (redirectUris.length === 0) {
		return { success: false, error: 'At least one redirect URI is required' };
	}
	for (const uri of redirectUris) {
		const check = validateRedirectUri(uri);
		if (!check.valid) return { success: false, error: check.error };
	}

	const scopes = Array.isArray(data.allowed_scopes) ? data.allowed_scopes.map(String) : [];
	if (scopes.length === 0) {
		return { success: false, error: 'At least one allowed scope is required' };
	}
	const scopeCheck = validateScopes(scopes);
	if (!scopeCheck.valid) return { success: false, error: scopeCheck.error };

	const secret = generateClientSecret();
	const secretHash = await hashToken(secret);

	try {
		await db
			.prepare(
				`INSERT INTO connect_clients (
           client_id, name, description, client_secret_hash,
           redirect_uris, allowed_scopes, enabled, created_by
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(
				clientId,
				String(data.name),
				data.description ? String(data.description) : null,
				secretHash,
				JSON.stringify(redirectUris),
				JSON.stringify(scopes),
				data.enabled === false ? 0 : 1,
				data.created_by ? String(data.created_by) : null
			)
			.run();

		return { success: true, client_id: clientId, client_secret: secret };
	} catch (error) {
		if (/UNIQUE/i.test(error?.message || '')) {
			return { success: false, error: 'A client with that ID already exists' };
		}
		log.error('[Connect] Failed to create client:', error);
		return { success: false, error: error.message };
	}
}

export async function deleteConnectClient(db, clientId) {
	if (!db || !clientId) return { success: false, error: 'Missing client' };
	try {
		await db
			.prepare(`DELETE FROM connect_clients WHERE client_id = ?`)
			.bind(String(clientId))
			.run();
		return { success: true };
	} catch (error) {
		log.error('[Connect] Failed to delete client:', error);
		return { success: false, error: error.message };
	}
}

export async function setConnectClientEnabled(db, clientId, enabled) {
	if (!db || !clientId) return { success: false, error: 'Missing client' };
	try {
		await db
			.prepare(
				`UPDATE connect_clients SET enabled = ?, updated_at = CURRENT_TIMESTAMP
         WHERE client_id = ?`
			)
			.bind(enabled ? 1 : 0, String(clientId))
			.run();
		return { success: true };
	} catch (error) {
		log.error('[Connect] Failed to update client:', error);
		return { success: false, error: error.message };
	}
}

/**
 * Verify a presented client secret.
 *
 * Hashes first, compares in constant time, and returns the client only on a
 * match — callers never see the stored hash.
 */
export async function verifyClientSecret(db, clientId, secret) {
	if (!db || !clientId || !secret) return null;
	try {
		const row: any = await db
			.prepare(`SELECT * FROM connect_clients WHERE client_id = ?`)
			.bind(String(clientId))
			.first();
		if (!row || row.enabled !== 1) return null;

		const presented = await hashToken(String(secret));
		if (!timingSafeEqual(presented, String(row.client_secret_hash))) return null;

		return parseConnectClient(row);
	} catch (error) {
		log.error('[Connect] Failed to verify client secret:', error);
		return null;
	}
}

// ---------------------------------------------------------------------------
// Authorization codes
// ---------------------------------------------------------------------------

/**
 * Record an approval and return the one-time code.
 *
 * No API key is minted here. The row is a record of what an admin agreed to;
 * the credential is created only when the code is redeemed, so an abandoned
 * approval leaves nothing behind.
 */
export async function issueAuthorizationCode(
	db,
	{ clientId, guildId, redirectUri, scopes, approvedBy }: Record<string, any>
) {
	if (!db) return { success: false, error: 'Database not available' };

	const code = generateAuthorizationCode();
	const codeHash = await hashToken(code);
	const expiresAt = new Date(Date.now() + CODE_TTL_SECONDS * 1000).toISOString();

	try {
		await db
			.prepare(
				`INSERT INTO connect_authorization_codes (
           code_hash, client_id, guild_id, redirect_uri, scopes, approved_by, expires_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(
				codeHash,
				String(clientId),
				String(guildId),
				String(redirectUri),
				JSON.stringify(scopes),
				String(approvedBy),
				expiresAt
			)
			.run();

		// Opportunistic cleanup; codes are worthless once expired.
		await db
			.prepare(`DELETE FROM connect_authorization_codes WHERE expires_at < datetime('now')`)
			.run()
			.catch(() => {});

		return { success: true, code, expiresAt };
	} catch (error) {
		log.error('[Connect] Failed to issue authorization code:', error);
		return { success: false, error: 'Could not issue an authorization code' };
	}
}

/**
 * Redeem a code exactly once.
 *
 * The consume is a conditional UPDATE rather than a read-then-write, so two
 * simultaneous exchanges cannot both win: whichever `UPDATE ... WHERE
 * consumed_at IS NULL` reports a changed row is the one that gets the key.
 */
export async function consumeAuthorizationCode(db, { code, clientId, redirectUri }) {
	if (!db) return { success: false, error: 'Database not available' };

	const codeHash = await hashToken(String(code));

	try {
		const row: any = await db
			.prepare(`SELECT * FROM connect_authorization_codes WHERE code_hash = ?`)
			.bind(codeHash)
			.first();

		// One message for every rejection: a caller probing codes learns only
		// that this one did not work, not which part was wrong.
		const invalid = { success: false, error: 'Invalid or expired authorization code' };

		if (!row) return invalid;
		if (row.consumed_at) return invalid;
		if (String(row.client_id) !== String(clientId)) return invalid;
		if (String(row.redirect_uri) !== String(redirectUri)) return invalid;
		const expiresAt = parseSqliteTime(row.expires_at);
		// A row whose expiry cannot be parsed is treated as expired, not as
		// valid — failing open on a timestamp is how a code lives forever.
		if (!expiresAt || expiresAt.getTime() <= Date.now()) return invalid;

		const consumed = await db
			.prepare(
				`UPDATE connect_authorization_codes
         SET consumed_at = CURRENT_TIMESTAMP
         WHERE code_hash = ? AND consumed_at IS NULL`
			)
			.bind(codeHash)
			.run();

		if ((consumed.meta?.changes ?? 0) !== 1) return invalid;

		return {
			success: true,
			guildId: String(row.guild_id),
			scopes: parseJsonArray(row.scopes),
			approvedBy: String(row.approved_by),
		};
	} catch (error) {
		log.error('[Connect] Failed to consume authorization code:', error);
		return { success: false, error: 'Could not complete the exchange' };
	}
}

export async function touchConnectClient(db, clientId) {
	if (!db || !clientId) return;
	try {
		await db
			.prepare(
				`UPDATE connect_clients SET last_used_at = CURRENT_TIMESTAMP WHERE client_id = ?`
			)
			.bind(String(clientId))
			.run();
	} catch {
		// Bookkeeping only.
	}
}
