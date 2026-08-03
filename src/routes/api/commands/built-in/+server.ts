/**
 * Built-in Commands API (Superadmin only)
 * GET - List all built-in commands
 * POST - Create a new built-in command
 */

import { json } from '@sveltejs/kit';
import { createBuiltInCommand, getBuiltInCommands } from '$lib/db/commands.js';
import { log } from '$lib/db/logger.js';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';

/** @type {import('./$types').RequestHandler} */
export async function GET({ cookies, platform }) {
	const userId = cookies.get('discord_user_id');
	if (!checkIsSuperAdmin(userId, platform)) {
		return json({ error: 'Superadmin access required' }, { status: 403 });
	}

	const db = (platform as any)?.env?.DB;
	if (!db) {
		return json({ error: 'Database not available' }, { status: 500 });
	}

	const commands = await getBuiltInCommands(db);
	return json({ commands });
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ request, cookies, platform }) {
	const userId = cookies.get('discord_user_id');
	if (!checkIsSuperAdmin(userId, platform)) {
		return json({ error: 'Superadmin access required' }, { status: 403 });
	}

	const db = (platform as any)?.env?.DB;
	if (!db) {
		return json({ error: 'Database not available' }, { status: 500 });
	}

	try {
		const body = await request.json();

		if (!body.name || !body.description) {
			return json({ error: 'Missing required fields: name, description' }, { status: 400 });
		}

		const result = await createBuiltInCommand(db, {
			...body,
			name: body.name.toLowerCase(),
			created_by: userId,
		});

		if (!result.success) {
			return json({ error: result.error }, { status: 400 });
		}

		return json({ success: true, id: result.id }, { status: 201 });
	} catch (error) {
		log.error('Create built-in command error:', error);
		return json({ error: 'Failed to create built-in command' }, { status: 500 });
	}
}
