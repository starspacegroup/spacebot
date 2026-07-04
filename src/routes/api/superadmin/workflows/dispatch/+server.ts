/**
 * Cron dispatcher for superadmin workflows.
 *
 * POST /api/superadmin/workflows/dispatch
 *   Called every minute by the orchestrator worker's Cron Trigger (via the
 *   durable CronDispatchWorkflow). Finds enabled cron-scheduled templates
 *   whose expression matches the current UTC minute, creates a `queued` run
 *   for each (deduped per minute), and enqueues it onto the
 *   spacebot-workflow-runs queue — the worker then drives each run as a
 *   durable Cloudflare Workflow instance. Without the queue binding (local
 *   dev), runs execute inline as a fallback.
 *
 *   Also performs a watchdog pass for runs the durable path lost track of
 *   (dropped queue messages, dead instances).
 *
 *   Auth: Bearer CRON_SECRET / INTERNAL_API_KEY, or a superadmin session.
 *
 * GET /api/superadmin/workflows/dispatch
 *   Superadmin diagnostics: scheduled templates, whether each is due now,
 *   expression validity, and the registered operation catalog.
 */

import { json } from '@sveltejs/kit';
import {
	createSuperadminWorkflowRun,
	listSuperadminWorkflowTemplates,
} from '$lib/db/superadmin-workflows.js';
import { driveSuperadminWorkflowRunInline } from '$lib/server/superadmin-workflow-advance.js';
import {
	enqueueWorkflowRunStart,
	hasWorkflowRunsQueue,
	runInBackground,
} from '$lib/server/superadmin-workflow-queue.js';
import {
	OPERATION_TEMPLATES,
	seedSuperadminWorkflowPresets,
} from '$lib/server/superadmin-workflow-presets.js';
import { listWorkflowOperations } from '$lib/server/superadmin-workflow-operations.js';
import { cronMatches, isValidCronExpression } from '$lib/server/cron-match.js';
import { checkInternalOrSuperAdmin } from '$lib/server/superadmin-guard.js';
import { log } from '$lib/log.js';

function minuteStartSql(date) {
	// Matches the "YYYY-MM-DD HH:MM:SS" format used for created_at values.
	return `${date.toISOString().slice(0, 16).replace('T', ' ')}:00`;
}

function agoSql(date, ms) {
	return new Date(date.getTime() - ms).toISOString().slice(0, 19).replace('T', ' ');
}

function listCronTemplates(templates) {
	return templates.filter(
		(t) =>
			t.enabled &&
			!t.archived &&
			t.schedule_type === 'cron' &&
			String(t.cron_expression || '').trim()
	);
}

/**
 * A template already dispatched for this minute must not fire again — ticks
 * may overlap and cron granularity is 1 minute.
 */
async function hasRunThisMinute(db, templateId, minuteSql) {
	const row = await db
		.prepare(
			`SELECT id FROM superadmin_workflow_runs
     WHERE template_id = ? AND trigger_source = 'cron' AND created_at >= ?
     LIMIT 1`
		)
		.bind(templateId, minuteSql)
		.first();
	return Boolean(row);
}

/**
 * Watchdog: recover runs the durable path lost.
 *  - `queued` runs older than 2 min: the start message was dropped → re-enqueue
 *    (idempotent: deterministic instance ids make duplicate creates no-ops).
 *  - `sleeping` runs whose wake time passed >10 min ago and `waiting_approval`
 *    runs past their gate timeout +1h: the instance died → resume inline.
 *  - `running` runs untouched for >25h: past the 24h deadline → advance once
 *    inline, which poison-fails them.
 */
async function watchdogPass(db, platform, fetch, now) {
	const actions = [];
	const inlineDrives = [];

	try {
		const staleQueued = await db
			.prepare(
				`SELECT id FROM superadmin_workflow_runs
       WHERE status = 'queued' AND created_at <= ? LIMIT 20`
			)
			.bind(agoSql(now, 2 * 60 * 1000))
			.all();

		for (const row of staleQueued.results || []) {
			const enqueued = await enqueueWorkflowRunStart(platform, row.id);
			if (!enqueued) {
				inlineDrives.push(Number(row.id));
			}
			actions.push({
				run_id: Number(row.id),
				action: enqueued ? 're_enqueued' : 'inline_drive',
			});
		}

		const staleActive = await db
			.prepare(
				`SELECT id, status, state_json, updated_at FROM superadmin_workflow_runs
       WHERE status IN ('sleeping', 'waiting_approval', 'running') AND updated_at <= ? LIMIT 20`
			)
			.bind(agoSql(now, 10 * 60 * 1000))
			.all();

		for (const row of staleActive.results || []) {
			let state = null;
			try {
				state = row.state_json ? JSON.parse(row.state_json) : null;
			} catch {
				state = null;
			}

			const status = String(row.status);
			let overdue = false;
			if (status === 'sleeping') {
				overdue =
					!state?.wake_at ||
					now.getTime() - new Date(state.wake_at).getTime() > 10 * 60 * 1000;
			} else if (status === 'waiting_approval') {
				const timeoutAt = state?.pending_approval?.timeout_at;
				overdue =
					Boolean(timeoutAt) &&
					now.getTime() - new Date(timeoutAt).getTime() > 60 * 60 * 1000;
			} else if (status === 'running') {
				const updated = new Date(String(row.updated_at).replace(' ', 'T') + 'Z').getTime();
				overdue = Number.isFinite(updated) && now.getTime() - updated > 25 * 60 * 60 * 1000;
			}

			if (overdue) {
				inlineDrives.push(Number(row.id));
				actions.push({ run_id: Number(row.id), action: 'inline_drive', reason: status });
			}
		}
	} catch (error) {
		log.error('[Workflows] Watchdog pass failed:', error);
	}

	const drives = inlineDrives.map((runId) =>
		driveSuperadminWorkflowRunInline({ db, platform, fetch, runId }).catch((error) => {
			log.error(`[Workflows] Watchdog inline drive failed for run #${runId}:`, error);
		})
	);

	return { actions, drives };
}

export async function GET({ request, cookies, platform }) {
	if (!checkInternalOrSuperAdmin({ request, cookies, platform })) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const db = (platform as { env?: { DB?: unknown } })?.env?.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	const now = new Date();
	const templates = await listSuperadminWorkflowTemplates(db, { limit: 200 });
	const scheduled = listCronTemplates(templates).map((t) => ({
		id: t.id,
		name: t.name,
		slug: t.slug,
		is_builtin: t.is_builtin,
		cron_expression: t.cron_expression,
		valid_expression: isValidCronExpression(t.cron_expression),
		due_now: cronMatches(t.cron_expression, now),
	}));

	return json({
		now: now.toISOString(),
		scheduled,
		durable_queue: hasWorkflowRunsQueue(platform),
		operations: listWorkflowOperations(),
	});
}

export async function POST({ request, cookies, platform, fetch }) {
	if (!checkInternalOrSuperAdmin({ request, cookies, platform })) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const db = (platform as { env?: { DB?: unknown } })?.env?.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	const now = new Date();
	const minuteSql = minuteStartSql(now);

	// Built-in continuity: top up any missing preset (matched by slug) so the
	// shipped workflows always exist, even if one was deleted from the DB or a
	// new preset ships in an update.
	let seeded = [];
	let templates = await listSuperadminWorkflowTemplates(db, {
		includeArchived: true,
		limit: 200,
	});
	const existingSlugs = new Set(templates.map((t) => t.slug));
	if (OPERATION_TEMPLATES.some((preset) => !existingSlugs.has(preset.slug))) {
		seeded = await seedSuperadminWorkflowPresets(db, 'system', { existing: templates });
		templates = await listSuperadminWorkflowTemplates(db, {
			includeArchived: true,
			limit: 200,
		});
	}

	const cronTemplates = listCronTemplates(templates);
	const due = [];
	const skipped = [];

	for (const template of cronTemplates) {
		if (!isValidCronExpression(template.cron_expression)) {
			skipped.push({ id: template.id, slug: template.slug, reason: 'invalid_expression' });
			continue;
		}
		if (!cronMatches(template.cron_expression, now)) continue;
		if (await hasRunThisMinute(db, template.id, minuteSql)) {
			skipped.push({ id: template.id, slug: template.slug, reason: 'already_dispatched' });
			continue;
		}
		due.push(template);
	}

	const durableQueue = hasWorkflowRunsQueue(platform);
	const dispatched = [];
	const failures = [];
	const inlineExecutions = [];

	for (const template of due) {
		const created = await createSuperadminWorkflowRun(db, template.id, null, {
			status: 'queued',
			trigger_source: 'cron',
			input_json: { scheduled_for: minuteSql, dispatched_at: now.toISOString() },
		});

		if (!created.success) {
			failures.push({ id: template.id, slug: template.slug, error: created.error });
			continue;
		}

		let execution = 'workflow';
		if (durableQueue && (await enqueueWorkflowRunStart(platform, created.run.id))) {
			// Worker will create the SuperadminRunWorkflow instance.
		} else {
			execution = 'inline';
			inlineExecutions.push(
				driveSuperadminWorkflowRunInline({
					db,
					platform,
					fetch,
					runId: created.run.id,
				}).catch((error) => {
					log.error(
						`[Workflows] Inline dispatch execution failed for ${template.slug}:`,
						error
					);
				})
			);
		}

		dispatched.push({
			id: template.id,
			slug: template.slug,
			run_id: created.run.id,
			execution,
		});
	}

	// Watchdog for runs the durable path lost track of.
	const watchdog = await watchdogPass(db, platform, fetch, now);

	// Run inline work after responding when the platform supports it, so the
	// scheduler tick returns quickly.
	await runInBackground(platform, Promise.allSettled([...inlineExecutions, ...watchdog.drives]));

	if (dispatched.length > 0) {
		log.info(
			`[Workflows] Dispatched ${dispatched.length} cron workflow(s): ${dispatched
				.map((d) => `${d.slug}(${d.execution})`)
				.join(', ')}`
		);
	}

	return json({
		success: true,
		now: now.toISOString(),
		checked: cronTemplates.length,
		durable_queue: durableQueue,
		dispatched,
		skipped,
		failures,
		seeded,
		watchdog: watchdog.actions,
	});
}
