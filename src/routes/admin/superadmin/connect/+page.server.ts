/**
 * Superadmin: applications registered for the Connect handshake.
 *
 * Registering a client is what makes one-click Connect possible for a site, and
 * it is also the only thing standing between this flow and a phishing kit — an
 * unregistered `redirect_uri` is refused on the consent screen. So this page is
 * superadmin-only (the parent layout enforces that), and the secret it hands
 * back is shown exactly once.
 */

import { fail } from '@sveltejs/kit';
import { API_KEY_SCOPES } from '$lib/db/api-keys.js';
import {
	createConnectClient,
	deleteConnectClient,
	listConnectClients,
	setConnectClientEnabled,
} from '$lib/db/connect-clients.js';
import { log } from '$lib/db/logger.js';

/** @type {import('./$types').PageServerLoad} */
export async function load({ platform }) {
	const db = (platform as any)?.env?.DB;
	return {
		clients: db ? await listConnectClients(db) : [],
		availableScopes: API_KEY_SCOPES,
	};
}

/** Split a textarea of one-per-line values. */
function readLines(value: unknown): string[] {
	return String(value || '')
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
}

/** @type {import('./$types').Actions} */
export const actions = {
	create: async ({ request, cookies, platform }) => {
		const db = (platform as any)?.env?.DB;
		if (!db) return fail(500, { message: 'Database not available' });

		const formData = await request.formData();
		const result = await createConnectClient(db, {
			client_id: formData.get('client_id'),
			name: formData.get('name'),
			description: formData.get('description'),
			redirect_uris: readLines(formData.get('redirect_uris')),
			allowed_scopes: formData.getAll('allowed_scopes').map(String),
			created_by: cookies.get('discord_user_id'),
		});

		if (!result.success) return fail(400, { message: result.error });

		log.info(`[Connect] Registered client ${result.client_id}`);
		return {
			success: true,
			message: `Registered ${result.client_id}. Copy the secret now — it is not stored.`,
			client_id: result.client_id,
			// Shown once, then gone. Only its hash is kept.
			client_secret: result.client_secret,
		};
	},

	toggle: async ({ request, platform }) => {
		const db = (platform as any)?.env?.DB;
		if (!db) return fail(500, { message: 'Database not available' });

		const formData = await request.formData();
		const result = await setConnectClientEnabled(
			db,
			formData.get('client_id'),
			formData.get('enabled') === 'true'
		);
		if (!result.success) return fail(400, { message: result.error });
		return { success: true, message: 'Updated.' };
	},

	delete: async ({ request, platform }) => {
		const db = (platform as any)?.env?.DB;
		if (!db) return fail(500, { message: 'Database not available' });

		const formData = await request.formData();
		const result = await deleteConnectClient(db, formData.get('client_id'));
		if (!result.success) return fail(400, { message: result.error });

		// Keys already issued keep working; they are ordinary API keys now and
		// are revoked from the server's own API keys page.
		return { success: true, message: 'Client removed. Keys it already issued still work.' };
	},
};
