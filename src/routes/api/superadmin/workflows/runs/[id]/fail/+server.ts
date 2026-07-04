import { json } from '@sveltejs/kit';
import {
	getSuperadminWorkflowRun,
	updateSuperadminWorkflowRun,
} from '$lib/db/superadmin-workflows.js';
import { checkInternalOrSuperAdmin } from '$lib/server/superadmin-guard.js';

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

function nowSql() {
	return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * POST /api/superadmin/workflows/runs/:id/fail
 *
 * Last-resort poison marker: the orchestrator worker calls this when its
 * driver loop budget is exhausted or advance retries are spent. No-op on
 * already-terminal runs.
 *
 * Body: { reason?: string }
 */
export async function POST({ request, cookies, platform, params }) {
	if (!checkInternalOrSuperAdmin({ request, cookies, platform })) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const runId = Number(params.id);
	if (!runId) return json({ error: 'Invalid run ID' }, { status: 400 });

	const db = (platform as { env?: { DB?: unknown } })?.env?.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	const run = await getSuperadminWorkflowRun(db, runId);
	if (!run) return json({ error: 'Run not found' }, { status: 404 });
	if (TERMINAL.has(run.status)) {
		return json({ success: true, run, changed: false });
	}

	const body = await request.json().catch(() => ({}));
	const reason = body?.reason
		? String(body.reason).slice(0, 500)
		: 'Marked failed by workflow driver';

	const updated = await updateSuperadminWorkflowRun(db, runId, {
		status: 'failed',
		completed_at: nowSql(),
		error_message: reason,
	});

	return json({ success: updated.success, run: updated.run, changed: true });
}
