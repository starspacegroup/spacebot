import { json } from '@sveltejs/kit';
import {
	getMessagePurgeSettings,
	setMessagePurgeSettings,
	MIN_MAX_BATCHES,
	MAX_MAX_BATCHES,
} from '$lib/server/message-purge-settings.js';

function checkIsSuperAdmin(userId, platform) {
	if (!userId) return false;
	const adminUserIds = (platform as any)?.env?.ADMIN_USER_IDS || process.env.ADMIN_USER_IDS || '';
	return adminUserIds
		.split(',')
		.map((id: string) => id.trim())
		.filter(Boolean)
		.includes(userId);
}

export async function GET({ cookies, platform }) {
	const userId = cookies.get('discord_user_id');
	if (!checkIsSuperAdmin(userId, platform)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const db = (platform as any)?.env?.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	const settings = await getMessagePurgeSettings(db);
	return json(settings);
}

export async function PATCH({ cookies, platform, request }) {
	const userId = cookies.get('discord_user_id');
	if (!checkIsSuperAdmin(userId, platform)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const db = (platform as any)?.env?.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	let body: { maxBatches?: unknown; checkpointContinue?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid request body' }, { status: 400 });
	}

	const updates: { maxBatches?: number; checkpointContinue?: boolean } = {};

	if (body.maxBatches !== undefined) {
		const n = Number(body.maxBatches);
		if (!Number.isFinite(n) || n < MIN_MAX_BATCHES || n > MAX_MAX_BATCHES) {
			return json(
				{ error: `maxBatches must be between ${MIN_MAX_BATCHES} and ${MAX_MAX_BATCHES}` },
				{ status: 400 }
			);
		}
		updates.maxBatches = Math.floor(n);
	}

	if (body.checkpointContinue !== undefined) {
		if (typeof body.checkpointContinue !== 'boolean') {
			return json({ error: 'checkpointContinue must be a boolean' }, { status: 400 });
		}
		updates.checkpointContinue = body.checkpointContinue;
	}

	const result = await setMessagePurgeSettings(db, updates);
	if (!result.success) {
		return json({ error: result.error || 'Failed to update settings' }, { status: 500 });
	}

	const settings = await getMessagePurgeSettings(db);
	return json({ success: true, ...settings });
}
