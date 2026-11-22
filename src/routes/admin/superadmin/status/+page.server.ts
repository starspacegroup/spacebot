import { fail } from '@sveltejs/kit';
import { COMPONENTS, IMPACTS, INCIDENT_STATUSES } from '$lib/status/logic.js';
import { addIncidentUpdate, createIncident, getStatusSnapshot } from '$lib/db/status.js';

/** The layout already checks superadmin. Actions check again: a form post skips the layout. */
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';

export async function load({ platform }) {
	const db = (platform as any)?.env?.DB;
	const snapshot = db ? await getStatusSnapshot(db) : null;
	return {
		snapshot,
		components: COMPONENTS.map((c) => ({ id: c.id, name: c.name })),
		impacts: IMPACTS,
		statuses: INCIDENT_STATUSES,
	};
}

function guard(cookies: any, platform: any) {
	const userId = cookies.get('discord_user_id');
	if (!checkIsSuperAdmin(userId, platform)) return null;
	return { userId: String(userId), db: platform?.env?.DB };
}

export const actions = {
	create: async ({ request, cookies, platform }) => {
		const who = guard(cookies, platform);
		if (!who?.db) return fail(403, { error: 'Not allowed.', incident: null as number | null });
		const form = await request.formData();
		const result = await createIncident(who.db, {
			title: String(form.get('title') ?? ''),
			impact: String(form.get('impact') ?? ''),
			status: String(form.get('status') ?? ''),
			components: form.getAll('components').map(String),
			message: String(form.get('message') ?? ''),
			by: who.userId,
		});
		return result.ok
			? { created: true }
			: fail(400, { error: result.error, incident: null as number | null });
	},

	update: async ({ request, cookies, platform }) => {
		const who = guard(cookies, platform);
		if (!who?.db) return fail(403, { error: 'Not allowed.', incident: null as number | null });
		const form = await request.formData();
		const result = await addIncidentUpdate(who.db, {
			incidentId: Number(form.get('incident_id')),
			status: String(form.get('status') ?? ''),
			message: String(form.get('message') ?? ''),
			by: who.userId,
		});
		return result.ok
			? { updated: Number(form.get('incident_id')) }
			: fail(400, { error: result.error, incident: Number(form.get('incident_id')) });
	},
};
