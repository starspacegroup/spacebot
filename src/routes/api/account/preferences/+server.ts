import { json } from '@sveltejs/kit';
import { getUserPreferences, updateUserPreferences } from '$lib/db/users.js';
import { isStorableTimeZone as isValidTimeZone } from '$lib/ai/time-context.js';

/** @type {import('./$types').RequestHandler} */
export async function GET({ cookies, platform }) {
	const userId = cookies.get('discord_user_id');
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const db = (platform as any)?.env?.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	const preferences = await getUserPreferences(db, userId);
	return json({ preferences });
}

/** @type {import('./$types').RequestHandler} */
export async function PATCH({ request, cookies, platform }) {
	const userId = cookies.get('discord_user_id');
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const db = (platform as any)?.env?.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	let body;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const runnerUi = body?.runnerUi;
	const hasRunnerUi = runnerUi && typeof runnerUi === 'object' && !Array.isArray(runnerUi);
	const hasTimezone = Object.prototype.hasOwnProperty.call(body || {}, 'timezone');

	if (!hasRunnerUi && !hasTimezone) {
		return json({ error: 'runnerUi object or timezone is required' }, { status: 400 });
	}

	const payload: Record<string, any> = {};
	const current = await getUserPreferences(db, userId);

	// The browser is the only thing that knows where the user actually is, so the
	// dashboard reports its detected zone here. Persisting it (rather than leaving
	// it in the `user_timezone` cookie) is what lets the Discord DM assistant read
	// the same zone — a DM has no browser and no cookie.
	if (hasTimezone) {
		const timezone = typeof body.timezone === 'string' ? body.timezone.trim() : '';
		if (!timezone) {
			// Explicit null/"" clears it and falls back to the server's zone.
			payload.timezone = null;
		} else if (!isValidTimeZone(timezone)) {
			return json({ error: 'Invalid IANA timezone name' }, { status: 400 });
		} else {
			payload.timezone = timezone;
		}
	}

	const currentRunnerUi =
		current?.runnerUi &&
		typeof current.runnerUi === 'object' &&
		!Array.isArray(current.runnerUi)
			? current.runnerUi
			: {};

	const nextRunnerUi = { ...currentRunnerUi };
	let hasRunnerUiUpdate = false;

	if (hasRunnerUi) {
		if (Object.prototype.hasOwnProperty.call(runnerUi, 'showRevoked')) {
			nextRunnerUi.showRevoked = Boolean(runnerUi.showRevoked);
			hasRunnerUiUpdate = true;
		}

		if (Object.prototype.hasOwnProperty.call(runnerUi, 'preferLocalRunnerForDM')) {
			nextRunnerUi.preferLocalRunnerForDM = Boolean(runnerUi.preferLocalRunnerForDM);
			hasRunnerUiUpdate = true;
		}

		if (Object.prototype.hasOwnProperty.call(runnerUi, 'defaultMaxAttempts')) {
			const raw = Number(runnerUi.defaultMaxAttempts);
			nextRunnerUi.defaultMaxAttempts = Number.isFinite(raw)
				? Math.max(1, Math.min(20, Math.round(raw)))
				: 5;
			hasRunnerUiUpdate = true;
		}
	}

	if (hasRunnerUiUpdate) {
		payload.runnerUi = nextRunnerUi;
	}

	if (!Object.keys(payload).length) {
		return json({ error: 'No supported preference keys provided' }, { status: 400 });
	}

	const result = await updateUserPreferences(db, userId, payload);
	if (!result.success) {
		return json({ error: result.error || 'Failed to update preferences' }, { status: 400 });
	}

	return json({ success: true, preferences: result.preferences });
}
