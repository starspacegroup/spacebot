import { json } from '@sveltejs/kit';
import { getSuperadminWorkflowRun } from '$lib/db/superadmin-workflows.js';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';

/** GET /api/superadmin/workflows/runs/:id — run + per-step detail. */
export async function GET({ cookies, platform, params }) {
	if (!checkIsSuperAdmin(cookies.get('discord_user_id'), platform)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const runId = Number(params.id);
	if (!runId) return json({ error: 'Invalid run ID' }, { status: 400 });

	const db = (platform as { env?: { DB?: unknown } })?.env?.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	const run = await getSuperadminWorkflowRun(db, runId);
	if (!run) return json({ error: 'Run not found' }, { status: 404 });

	return json({ run });
}
