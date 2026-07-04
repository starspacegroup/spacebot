import { json } from '@sveltejs/kit';
import {
	getSuperadminWorkflowRun,
	updateSuperadminWorkflowRun,
} from '$lib/db/superadmin-workflows.js';
import { driveSuperadminWorkflowRunInline } from '$lib/server/superadmin-workflow-advance.js';
import {
	enqueueWorkflowRunApproval,
	runInBackground,
} from '$lib/server/superadmin-workflow-queue.js';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';
import { log } from '$lib/log.js';

/**
 * POST /api/superadmin/workflows/runs/:id/approval
 *
 * Record an operator decision for a run paused on an approval gate, then wake
 * the run's Workflow instance (queue) or resume it inline (dev fallback).
 *
 * Body: { step_key, decision: "approved"|"rejected", note? }
 */
export async function POST({ request, cookies, platform, params, fetch }) {
	const userId = cookies.get('discord_user_id');
	if (!checkIsSuperAdmin(userId, platform)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const runId = Number(params.id);
	if (!runId) return json({ error: 'Invalid run ID' }, { status: 400 });

	const db = (platform as { env?: { DB?: unknown } })?.env?.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	const body = await request.json().catch(() => ({}));
	const stepKey = String(body?.step_key || '').trim();
	const decision = String(body?.decision || '')
		.trim()
		.toLowerCase();

	if (!stepKey) return json({ error: 'step_key is required' }, { status: 400 });
	if (!['approved', 'rejected'].includes(decision)) {
		return json({ error: 'decision must be "approved" or "rejected"' }, { status: 400 });
	}

	const run = await getSuperadminWorkflowRun(db, runId);
	if (!run) return json({ error: 'Run not found' }, { status: 404 });

	const gate = run.state_json?.pending_approval;
	if (run.status !== 'waiting_approval' || !gate || String(gate.step_key) !== stepKey) {
		return json({ error: 'Run is not waiting for approval on this step' }, { status: 409 });
	}

	const state = run.state_json;
	state.approvals = {
		...(state.approvals || {}),
		[stepKey]: {
			decision,
			decided_by: userId,
			decided_at: new Date().toISOString(),
			note: body?.note ? String(body.note).slice(0, 500) : null,
		},
	};
	await updateSuperadminWorkflowRun(db, runId, { state_json: state });

	// Wake the durable instance; fall back to inline resumption in dev.
	const enqueued = await enqueueWorkflowRunApproval(platform, runId, stepKey);
	if (!enqueued) {
		const resume = driveSuperadminWorkflowRunInline({ db, platform, fetch, runId }).catch(
			(error) =>
				log.error(`[Workflows] Inline approval resume failed for run #${runId}:`, error)
		);
		await runInBackground(platform, resume);
	}

	const refreshed = await getSuperadminWorkflowRun(db, runId);
	return json({ success: true, run: refreshed, execution: enqueued ? 'workflow' : 'inline' });
}
