/**
 * The Connect consent screen.
 *
 * A registered site sends an admin here to approve a scope grant for one of
 * their servers. Everything the query string asks for is checked against the
 * client's registration before anything is shown, and re-checked from the
 * database before a code is issued — the form's hidden fields are never trusted
 * on their own.
 *
 * The rule that matters most: **an invalid or unregistered `redirect_uri` is
 * refused on this page and never redirected to.** Bouncing the browser to an
 * unvalidated URI is the open redirect that turns this flow into a way to
 * harvest keys.
 */

import { fail, redirect } from '@sveltejs/kit';
import { log } from '$lib/db/logger.js';
import { API_KEY_SCOPES } from '$lib/db/api-keys.js';
import { getConnectClient, issueAuthorizationCode } from '$lib/db/connect-clients.js';
import { hasFullAdminPermission, verifyGuildAdmin } from '$lib/discord/guilds.js';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';

/** Scope strings may arrive space- or comma-separated. */
function parseRequestedScopes(raw: string | null): string[] {
	if (!raw) return [];
	return [...new Set(raw.split(/[\s,]+/).filter(Boolean))];
}

/**
 * Resolve and validate the request against the client's registration.
 *
 * Returns either a `problem` (render an error, never redirect) or a validated
 * request the page can act on.
 */
async function resolveRequest(db, url: URL) {
	const clientId = (url.searchParams.get('client_id') || '').trim();
	const redirectUri = (url.searchParams.get('redirect_uri') || '').trim();
	const state = (url.searchParams.get('state') || '').trim();
	const requestedScopes = parseRequestedScopes(url.searchParams.get('scope'));

	if (!clientId || !redirectUri) {
		return { problem: 'This link is missing its client_id or redirect_uri.' };
	}

	// Required, not optional: without it the receiving site cannot tell its own
	// callback from one an attacker triggered, and we would be handing out
	// codes that complete a CSRF.
	if (!state) {
		return { problem: 'This link is missing its state parameter.' };
	}

	if (!db) return { problem: 'SpaceBot cannot reach its database right now.' };

	const client = await getConnectClient(db, clientId);
	if (!client || !client.enabled) {
		return { problem: 'That application is not registered with SpaceBot.' };
	}

	// Exact match against the allowlist. Never a prefix, never a host compare.
	if (!client.redirect_uris.includes(redirectUri)) {
		return {
			problem: `“${client.name}” is registered, but not for that return address. Nothing was sent there.`,
		};
	}

	if (requestedScopes.length === 0) {
		return { problem: 'This link does not ask for any permissions.' };
	}

	const beyondRegistration = requestedScopes.filter(
		(scope) => !client.allowed_scopes.includes(scope)
	);
	if (beyondRegistration.length > 0) {
		return {
			problem: `“${client.name}” is asking for more than it is registered for: ${beyondRegistration.join(', ')}.`,
		};
	}

	const unknown = requestedScopes.filter((scope) => !(scope in API_KEY_SCOPES));
	if (unknown.length > 0) {
		return { problem: `Unknown permissions requested: ${unknown.join(', ')}.` };
	}

	return { client, redirectUri, state, requestedScopes };
}

/** @type {import('./$types').PageServerLoad} */
export async function load({ url, cookies, platform, parent }) {
	const db = (platform as any)?.env?.DB;
	const resolved = await resolveRequest(db, url);

	if (resolved.problem) {
		return { problem: resolved.problem };
	}

	const userId = cookies.get('discord_user_id');
	if (!userId) {
		// Come back to this exact request after login.
		throw redirect(302, `/login?redirect=${encodeURIComponent(url.pathname + url.search)}`);
	}

	const parentData = await parent();
	const isSuperAdmin = checkIsSuperAdmin(userId, platform);

	// Only servers this person actually administers, and only ones the bot is
	// in — a key for a guild SpaceBot cannot see would return nothing.
	const guilds = (parentData.adminGuilds || [])
		.filter((guild) => guild.botIsInServer !== false)
		.filter((guild) => isSuperAdmin || hasFullAdminPermission(guild))
		.map((guild) => ({ id: guild.id, name: guild.name, icon: guild.icon }));

	return {
		problem: null,
		client: {
			client_id: resolved.client.client_id,
			name: resolved.client.name,
			description: resolved.client.description,
		},
		redirectUri: resolved.redirectUri,
		redirectHost: new URL(resolved.redirectUri).host,
		state: resolved.state,
		scopes: resolved.requestedScopes.map((scope) => ({
			scope,
			label: API_KEY_SCOPES[scope],
		})),
		guilds,
	};
}

/** @type {import('./$types').Actions} */
export const actions = {
	approve: async ({ request, url, cookies, platform }) => {
		const userId = cookies.get('discord_user_id');
		if (!userId) return fail(401, { message: 'Not signed in' });

		const db = (platform as any)?.env?.DB;

		// Re-resolve from the query string against the database. The form's
		// hidden fields are a convenience for rendering, never the authority.
		const resolved = await resolveRequest(db, url);
		if (resolved.problem) return fail(400, { message: resolved.problem });

		const formData = await request.formData();
		const guildId = String(formData.get('guildId') || '');
		if (!guildId) return fail(400, { message: 'Pick a server first.' });

		// Approving for a guild you do not administer must be impossible even if
		// the select is edited in the browser. Re-checked against Discord rather
		// than against anything the page rendered.
		const isSuperAdmin = checkIsSuperAdmin(userId, platform);
		if (!isSuperAdmin) {
			const accessToken = cookies.get('discord_access_token');
			const check = await verifyGuildAdmin(guildId, accessToken, cookies);
			if (!check.authorized || !hasFullAdminPermission(check.guild)) {
				return fail(403, { message: 'You do not administer that server.' });
			}
		}

		// Only the scopes actually ticked, intersected with what was validly
		// requested. Approval can narrow the request; it can never widen it.
		const approvedScopes = formData
			.getAll('scopes')
			.map(String)
			.filter((scope) => resolved.requestedScopes.includes(scope));

		if (approvedScopes.length === 0) {
			return fail(400, { message: 'Approve at least one permission, or cancel.' });
		}

		const issued = await issueAuthorizationCode(db, {
			clientId: resolved.client.client_id,
			guildId,
			redirectUri: resolved.redirectUri,
			scopes: approvedScopes,
			approvedBy: userId,
		});

		if (!issued.success) return fail(500, { message: issued.error });

		log.info(
			`[Connect] ${resolved.client.client_id} approved for guild ${guildId} by ${userId} (${approvedScopes.join(', ')})`
		);

		// Safe to redirect only now: this URI came from the allowlist, not the
		// query string.
		const target = new URL(resolved.redirectUri);
		target.searchParams.set('code', issued.code);
		target.searchParams.set('state', resolved.state);
		throw redirect(302, target.toString());
	},
};
