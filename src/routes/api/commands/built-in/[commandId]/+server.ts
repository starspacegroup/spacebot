/**
 * Single Built-in Command API (Superadmin only)
 * PATCH - Update a built-in command
 * DELETE - Delete a built-in command
 */

import { json } from '@sveltejs/kit';
import { getBuiltInCommand, updateCommand, deleteBuiltInCommand } from '$lib/db/commands.js';
import { log } from '$lib/db/logger.js';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';

/** @type {import('./$types').RequestHandler} */
export async function PATCH({ params, request, cookies, platform }) {
	const userId = cookies.get('discord_user_id');
	if (!checkIsSuperAdmin(userId, platform)) {
		return json({ error: 'Superadmin access required' }, { status: 403 });
	}

	const db = (platform as any)?.env?.DB;
	if (!db) {
		return json({ error: 'Database not available' }, { status: 500 });
	}

	const commandId = parseInt(params.commandId);

	try {
		const existing = await getBuiltInCommand(db, commandId);
		if (!existing) {
			return json({ error: 'Built-in command not found' }, { status: 404 });
		}

		const body = await request.json();
		const result = await updateCommand(db, commandId, body);

		if (!result.success) {
			return json({ error: result.error }, { status: 400 });
		}

		return json({ success: true });
	} catch (error) {
		log.error('Update built-in command error:', error);
		return json({ error: 'Failed to update built-in command' }, { status: 500 });
	}
}

/** @type {import('./$types').RequestHandler} */
export async function DELETE({ params, cookies, platform }) {
	const userId = cookies.get('discord_user_id');
	if (!checkIsSuperAdmin(userId, platform)) {
		return json({ error: 'Superadmin access required' }, { status: 403 });
	}

	const db = (platform as any)?.env?.DB;
	if (!db) {
		return json({ error: 'Database not available' }, { status: 500 });
	}

	const commandId = parseInt(params.commandId);

	try {
		const result = await deleteBuiltInCommand(db, commandId);

		if (!result.success) {
			return json({ error: result.error }, { status: 400 });
		}

		return json({ success: true });
	} catch (error) {
		log.error('Delete built-in command error:', error);
		return json({ error: 'Failed to delete built-in command' }, { status: 500 });
	}
}
