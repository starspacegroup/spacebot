import { json } from '@sveltejs/kit';
import { advanceSuperadminWorkflowRun } from '$lib/server/superadmin-workflow-advance.js';
import { checkInternalOrSuperAdmin } from '$lib/server/superadmin-guard.js';

/**
 * POST /api/superadmin/workflows/runs/:id/advance
 *
 * Executes at most one graph node and returns the run's next instruction.
 * Idempotent — the orchestrator worker's SuperadminRunWorkflow drives a run
 * by looping durable step.do() calls over this endpoint.
 *
 * Auth: Bearer CRON_SECRET / INTERNAL_API_KEY or superadmin session.
 * Body: { instance_id?: string }
 * 200: { run_id, status, done, executed_step, wait }
 */
export async function POST({ request, cookies, platform, params, fetch }) {
	if (!checkInternalOrSuperAdmin({ request, cookies, platform })) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const runId = Number(params.id);
	if (!runId) return json({ error: 'Invalid run ID' }, { status: 400 });

	const db = (platform as { env?: { DB?: unknown } })?.env?.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	const body = await request.json().catch(() => ({}));
	const instanceId = body?.instance_id ? String(body.instance_id) : null;

	const advanced = await advanceSuperadminWorkflowRun({ db, platform, fetch, runId, instanceId });
	if (!advanced) return json({ error: 'Run not found' }, { status: 404 });

	return json(advanced);
}
