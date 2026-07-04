import { json } from '@sveltejs/kit';
import {
	getSuperadminWorkflowRun,
	updateSuperadminWorkflowRun,
} from '$lib/db/superadmin-workflows.js';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

function nowSql() {
	return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * POST /api/superadmin/workflows/runs/:id/cancel
 *
 * Operator cancellation. The run is marked cancelled immediately; the durable
 * driver observes the terminal status on its next advance call and exits.
 */
export async function POST({ cookies, platform, params }) {
	const userId = cookies.get('discord_user_id');
	if (!checkIsSuperAdmin(userId, platform)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const runId = Number(params.id);
	if (!runId) return json({ error: 'Invalid run ID' }, { status: 400 });

	const db = (platform as { env?: { DB?: unknown } })?.env?.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	const run = await getSuperadminWorkflowRun(db, runId);
	if (!run) return json({ error: 'Run not found' }, { status: 404 });
	if (TERMINAL.has(run.status)) {
		return json({ error: `Run is already ${run.status}` }, { status: 409 });
	}

	const updated = await updateSuperadminWorkflowRun(db, runId, {
		status: 'cancelled',
		completed_at: nowSql(),
		error_message: `Cancelled by ${userId}`,
	});

	return json({ success: updated.success, run: updated.run });
}
