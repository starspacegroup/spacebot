import { json } from '@sveltejs/kit';
import {
	createSuperadminWorkflowRun,
	getSuperadminWorkflowRun,
	getSuperadminWorkflowTemplate,
	listSuperadminWorkflowRuns,
} from '$lib/db/superadmin-workflows.js';
import { driveSuperadminWorkflowRunInline } from '$lib/server/superadmin-workflow-advance.js';
import { enqueueWorkflowRunStart, runInBackground } from '$lib/server/superadmin-workflow-queue.js';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';
import { log } from '$lib/log.js';

export async function GET({ cookies, platform, params, url }) {
	const userId = cookies.get('discord_user_id');
	if (!checkIsSuperAdmin(userId, platform)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const templateId = Number(params.id);
	if (!templateId) return json({ error: 'Invalid workflow ID' }, { status: 400 });

	const db = (platform as { env?: { DB?: unknown } })?.env?.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	const template = await getSuperadminWorkflowTemplate(db, templateId);
	if (!template) return json({ error: 'Workflow not found' }, { status: 404 });

	const limit = parseInt(url.searchParams.get('limit') || '50', 10);
	const runs = await listSuperadminWorkflowRuns(db, { templateId, limit });
	return json({ template, runs });
}

/**
 * POST /api/superadmin/workflows/:id/runs — manual run.
 *
 * Creates the run `queued` and hands it to the durable execution path (the
 * spacebot-workflow-runs queue → orchestrator worker → Cloudflare Workflow).
 * Without the queue binding (local dev), the run executes inline instead.
 * `execute_now: false` creates the run without starting it.
 */
export async function POST({ cookies, platform, params, request, fetch }) {
	const userId = cookies.get('discord_user_id');
	if (!checkIsSuperAdmin(userId, platform)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const templateId = Number(params.id);
	if (!templateId) return json({ error: 'Invalid workflow ID' }, { status: 400 });

	const db = (platform as { env?: { DB?: unknown } })?.env?.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	const body = await request.json();
	const result = await createSuperadminWorkflowRun(db, templateId, userId, {
		...(body || {}),
		status: 'queued',
		trigger_source: body?.trigger_source || 'manual',
	});
	if (!result.success) {
		const status = result.error === 'Workflow not found' ? 404 : 400;
		return json({ error: result.error }, { status });
	}

	let run = result.run;
	let execution = 'deferred';

	if (body?.execute_now !== false) {
		const enqueued = await enqueueWorkflowRunStart(platform, run.id);
		if (enqueued) {
			execution = 'workflow';
		} else {
			execution = 'inline';
			const drive = driveSuperadminWorkflowRunInline({
				db,
				platform,
				fetch,
				runId: run.id,
			}).catch((error) => {
				log.error(`[Workflows] Inline manual run failed for #${run.id}:`, error);
			});

			await runInBackground(platform, drive);
			run = (await getSuperadminWorkflowRun(db, run.id)) || run;
		}
	}

	return json({ success: true, run, template: result.template, execution }, { status: 201 });
}
