import { log } from '$lib/log.js';
import {
	definitionChanged,
	snapshotTemplateVersion,
} from '$lib/db/superadmin-workflow-versions.js';

interface ListTemplatesOptions {
	includeArchived?: boolean;
	limit?: number;
}

interface CreateTemplateInput {
	name?: string;
	slug?: string;
	canvas_json?: unknown;
	canvas?: unknown;
	description?: string;
	category?: string;
	enabled?: boolean;
	execution_backend?: string;
	legacy_job_name?: string;
	schedule_type?: string;
	cron_expression?: string;
	config_json?: unknown;
	/** Internal callers only (preset seeding); not accepted from API bodies. */
	is_builtin?: boolean;
	change_note?: string;
}

interface ListRunsOptions {
	limit?: number;
	templateId?: number | string;
}

interface CreateRunInput {
	status?: string;
	trigger_source?: string;
	workflow_instance_id?: string;
	legacy_history_id?: number | string;
	input_json?: unknown;
}

/** Max wall-clock lifetime for a run before it is poison-failed. */
export const RUN_DEADLINE_MS = 24 * 60 * 60 * 1000;

/** Fresh advance-loop state for a new run (see superadmin-workflow-advance.ts). */
function initialRunState(now = new Date()) {
	return {
		cursor: null,
		variables: { steps: {} },
		path: [],
		events: [],
		queued_jobs: [],
		messages: [],
		webhooks: [],
		approvals: {},
		wake_at: null,
		wake_for: null,
		pending_approval: null,
		attempts: {},
		steps_executed: 0,
		deadline_at: new Date(now.getTime() + RUN_DEADLINE_MS).toISOString(),
	};
}

const DEFAULT_CANVAS = {
	nodes: [],
	edges: [],
};

function nowSql() {
	return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function safeJsonParse(value, fallback) {
	if (!value) return fallback;

	try {
		return JSON.parse(value);
	} catch {
		return fallback;
	}
}

function slugify(value) {
	return String(value || '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80);
}

export function normalizeCanvas(canvas) {
	const raw =
		typeof canvas === 'string'
			? safeJsonParse(canvas, DEFAULT_CANVAS)
			: canvas || DEFAULT_CANVAS;
	const nodes = Array.isArray(raw?.nodes) ? raw.nodes : [];
	const edges = Array.isArray(raw?.edges) ? raw.edges : [];

	return {
		nodes: nodes.map((node, index) => ({
			id: String(node?.id || `step-${index + 1}`),
			type: String(node?.type || 'task'),
			title: String(node?.title || node?.label || `Step ${index + 1}`),
			position:
				typeof node?.position === 'object' && node.position
					? {
							x: Number(node.position.x) || 0,
							y: Number(node.position.y) || 0,
						}
					: { x: 0, y: index * 120 },
			data: typeof node?.data === 'object' && node.data ? node.data : {},
		})),
		edges: edges
			.map((edge, index) => ({
				id: String(edge?.id || `edge-${index + 1}`),
				source: String(edge?.source || ''),
				target: String(edge?.target || ''),
				source_handle: String(edge?.source_handle || edge?.sourceHandle || 'out'),
				target_handle: String(edge?.target_handle || edge?.targetHandle || 'in'),
				label: edge?.label ? String(edge.label) : '',
			}))
			.filter((edge) => edge.source && edge.target),
	};
}

function normalizeTemplateRow(row) {
	if (!row) return null;

	return {
		...row,
		enabled: Boolean(row.enabled),
		archived: Boolean(row.archived),
		is_builtin: Boolean(row.is_builtin),
		published_version: Number(row.published_version || 1),
		canvas_json: normalizeCanvas(row.canvas_json),
		config_json: safeJsonParse(row.config_json, null),
	};
}

function normalizeRunRow(row) {
	if (!row) return null;

	return {
		...row,
		template_id: Number(row.template_id),
		template_version: row.template_version == null ? null : Number(row.template_version),
		legacy_history_id: row.legacy_history_id == null ? null : Number(row.legacy_history_id),
		duration_ms: row.duration_ms == null ? null : Number(row.duration_ms),
		input_json: safeJsonParse(row.input_json, null),
		result_json: safeJsonParse(row.result_json, null),
		state_json: safeJsonParse(row.state_json, null),
	};
}

function normalizeStepRows(rows) {
	return (rows || []).map((row) => ({
		...row,
		run_id: Number(row.run_id),
		position: Number(row.position || 0),
		duration_ms: row.duration_ms == null ? null : Number(row.duration_ms),
		input_json: safeJsonParse(row.input_json, null),
		output_json: safeJsonParse(row.output_json, null),
	}));
}

async function getTemplateRow(db, templateId) {
	return db
		.prepare('SELECT * FROM superadmin_workflow_templates WHERE id = ?')
		.bind(templateId)
		.first();
}

async function getRunRow(db, runId) {
	return db.prepare('SELECT * FROM superadmin_workflow_runs WHERE id = ?').bind(runId).first();
}

async function getRunStepRow(db, runId, stepKey) {
	return db
		.prepare(
			'SELECT * FROM superadmin_workflow_run_steps WHERE run_id = ? AND step_key = ? LIMIT 1'
		)
		.bind(runId, stepKey)
		.first();
}

export async function listSuperadminWorkflowTemplates(db, options: ListTemplatesOptions = {}) {
	if (!db) return [];

	const includeArchived = options.includeArchived === true;
	const limit = Math.max(1, Math.min(Number(options.limit) || 100, 200));

	try {
		const query = includeArchived
			? `SELECT * FROM superadmin_workflow_templates ORDER BY archived ASC, updated_at DESC LIMIT ?`
			: `SELECT * FROM superadmin_workflow_templates WHERE archived = 0 ORDER BY enabled DESC, updated_at DESC LIMIT ?`;
		const result = await db.prepare(query).bind(limit).all();
		return (result.results || []).map(normalizeTemplateRow);
	} catch (error) {
		log.error('[SuperadminWorkflows] list templates failed:', error);
		return [];
	}
}

export async function getSuperadminWorkflowTemplate(db, templateId) {
	if (!db || !templateId) return null;

	try {
		const row = await getTemplateRow(db, templateId);
		return normalizeTemplateRow(row);
	} catch (error) {
		log.error('[SuperadminWorkflows] get template failed:', error);
		return null;
	}
}

export async function createSuperadminWorkflowTemplate(
	db,
	userId,
	input: CreateTemplateInput = {}
) {
	if (!db || !userId) return { success: false, error: 'Invalid parameters' };

	const name = String(input.name || '').trim();
	if (!name) return { success: false, error: 'Workflow name is required' };

	const slug = slugify(input.slug || name);
	if (!slug) return { success: false, error: 'Workflow slug is required' };

	const canvas = normalizeCanvas(input.canvas_json || input.canvas || DEFAULT_CANVAS);
	const timestamp = nowSql();

	try {
		await db
			.prepare(
				`INSERT INTO superadmin_workflow_templates (
        name, slug, description, category, enabled, archived, is_builtin,
        execution_backend, legacy_job_name, schedule_type, cron_expression,
        canvas_json, config_json, published_version,
        created_by_user_id, updated_by_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
			)
			.bind(
				name,
				slug,
				input.description ? String(input.description).trim() : null,
				input.category ? String(input.category).trim() : 'operations',
				input.enabled === false ? 0 : 1,
				input.is_builtin === true ? 1 : 0,
				input.execution_backend
					? String(input.execution_backend).trim()
					: 'cloudflare_workflows',
				input.legacy_job_name ? String(input.legacy_job_name).trim() : null,
				input.schedule_type ? String(input.schedule_type).trim() : 'manual',
				input.cron_expression ? String(input.cron_expression).trim() : null,
				JSON.stringify(canvas),
				input.config_json == null ? null : JSON.stringify(input.config_json),
				userId,
				userId,
				timestamp,
				timestamp
			)
			.run();

		const row = await db
			.prepare(
				'SELECT * FROM superadmin_workflow_templates WHERE slug = ? ORDER BY id DESC LIMIT 1'
			)
			.bind(slug)
			.first();
		const template = normalizeTemplateRow(row);
		if (template) {
			await snapshotTemplateVersion(db, template, {
				version: 1,
				changeNote: input.change_note ? String(input.change_note) : 'Created',
				userId,
			});
		}
		return { success: true, template };
	} catch (error) {
		log.error('[SuperadminWorkflows] create template failed:', error);
		if (
			String(error?.message || '')
				.toLowerCase()
				.includes('unique')
		) {
			return { success: false, error: 'A workflow with this slug already exists' };
		}
		return { success: false, error: 'Failed to create workflow' };
	}
}

export async function updateSuperadminWorkflowTemplate(
	db,
	templateId,
	userId,
	patch = {},
	options: { changeNote?: string } = {}
) {
	if (!db || !templateId || !userId) return { success: false, error: 'Invalid parameters' };

	const current = await getSuperadminWorkflowTemplate(db, templateId);
	if (!current) return { success: false, error: 'Workflow not found' };

	// published_version is engine-managed; never trust it from a patch.
	const {
		published_version: _ignoredVersion,
		is_builtin: _ignoredBuiltin,
		...safePatch
	} = patch as Record<string, unknown>;

	const merged = {
		...current,
		...safePatch,
	};

	const name = String(merged.name || '').trim();
	if (!name) return { success: false, error: 'Workflow name is required' };

	const slug = slugify(merged.slug || name);
	if (!slug) return { success: false, error: 'Workflow slug is required' };

	if (current.is_builtin && slug !== current.slug) {
		return { success: false, error: 'Built-in workflow slugs cannot be changed' };
	}
	if (current.is_builtin && merged.archived === true) {
		return { success: false, error: 'Built-in workflows cannot be archived' };
	}

	const canvas = normalizeCanvas(merged.canvas_json || merged.canvas || DEFAULT_CANVAS);
	const changed = definitionChanged(current, { ...merged, slug, name, canvas_json: canvas });
	const nextVersion = changed ? current.published_version + 1 : current.published_version;
	const timestamp = nowSql();

	try {
		await db
			.prepare(
				`UPDATE superadmin_workflow_templates
       SET name = ?,
           slug = ?,
           description = ?,
           category = ?,
           enabled = ?,
           archived = ?,
           execution_backend = ?,
           legacy_job_name = ?,
           schedule_type = ?,
           cron_expression = ?,
           canvas_json = ?,
           config_json = ?,
           published_version = ?,
           updated_by_user_id = ?,
           updated_at = ?
       WHERE id = ?`
			)
			.bind(
				name,
				slug,
				merged.description ? String(merged.description).trim() : null,
				merged.category ? String(merged.category).trim() : 'operations',
				merged.enabled === false ? 0 : 1,
				merged.archived === true ? 1 : 0,
				merged.execution_backend
					? String(merged.execution_backend).trim()
					: 'cloudflare_workflows',
				merged.legacy_job_name ? String(merged.legacy_job_name).trim() : null,
				merged.schedule_type ? String(merged.schedule_type).trim() : 'manual',
				merged.cron_expression ? String(merged.cron_expression).trim() : null,
				JSON.stringify(canvas),
				merged.config_json == null ? null : JSON.stringify(merged.config_json),
				nextVersion,
				userId,
				timestamp,
				templateId
			)
			.run();

		const row = await getTemplateRow(db, templateId);
		const template = normalizeTemplateRow(row);
		if (changed && template) {
			await snapshotTemplateVersion(db, template, {
				version: nextVersion,
				changeNote: options.changeNote ? String(options.changeNote) : null,
				userId,
			});
		}
		return { success: true, template };
	} catch (error) {
		log.error('[SuperadminWorkflows] update template failed:', error);
		if (
			String(error?.message || '')
				.toLowerCase()
				.includes('unique')
		) {
			return { success: false, error: 'A workflow with this slug already exists' };
		}
		return { success: false, error: 'Failed to update workflow' };
	}
}

export async function archiveSuperadminWorkflowTemplate(db, templateId, userId) {
	const current = await getSuperadminWorkflowTemplate(db, templateId);
	if (!current) return { success: false, error: 'Workflow not found' };
	if (current.is_builtin) {
		return { success: false, error: 'Built-in workflows cannot be archived (disable instead)' };
	}
	return updateSuperadminWorkflowTemplate(db, templateId, userId, {
		archived: true,
		enabled: false,
	});
}

export async function listSuperadminWorkflowRuns(db, options: ListRunsOptions = {}) {
	if (!db) return [];

	const limit = Math.max(1, Math.min(Number(options.limit) || 50, 200));
	const templateId = options.templateId ? Number(options.templateId) : null;

	try {
		const query = templateId
			? `SELECT * FROM superadmin_workflow_runs WHERE template_id = ? ORDER BY created_at DESC LIMIT ?`
			: `SELECT * FROM superadmin_workflow_runs ORDER BY created_at DESC LIMIT ?`;
		const binds = templateId ? [templateId, limit] : [limit];
		const result = await db
			.prepare(query)
			.bind(...binds)
			.all();
		return (result.results || []).map(normalizeRunRow);
	} catch (error) {
		log.error('[SuperadminWorkflows] list runs failed:', error);
		return [];
	}
}

export async function getSuperadminWorkflowRun(db, runId) {
	if (!db || !runId) return null;

	try {
		const [runRow, stepsResult] = await Promise.all([
			getRunRow(db, runId),
			db
				.prepare(
					'SELECT * FROM superadmin_workflow_run_steps WHERE run_id = ? ORDER BY position ASC'
				)
				.bind(runId)
				.all(),
		]);

		const run = normalizeRunRow(runRow);
		if (!run) return null;

		return {
			...run,
			steps: normalizeStepRows(stepsResult.results || []),
		};
	} catch (error) {
		log.error('[SuperadminWorkflows] get run failed:', error);
		return null;
	}
}

export async function createSuperadminWorkflowRun(
	db,
	templateId,
	userId,
	input: CreateRunInput = {}
) {
	if (!db || !templateId) return { success: false, error: 'Invalid parameters' };

	const template = await getSuperadminWorkflowTemplate(db, templateId);
	if (!template) return { success: false, error: 'Workflow not found' };

	const timestamp = nowSql();
	const requestedBy = userId || null;
	const initialStatus = input.status ? String(input.status).trim() : 'queued';

	try {
		const runInsert = await db
			.prepare(
				`INSERT INTO superadmin_workflow_runs (
        template_id, template_version, status, trigger_source, requested_by_user_id,
        workflow_instance_id, legacy_history_id, input_json, state_json,
        result_json, error_message, started_at, completed_at,
        duration_ms, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?)`
			)
			.bind(
				templateId,
				template.published_version,
				initialStatus,
				input.trigger_source ? String(input.trigger_source).trim() : 'manual',
				requestedBy,
				input.workflow_instance_id ? String(input.workflow_instance_id).trim() : null,
				input.legacy_history_id == null ? null : Number(input.legacy_history_id),
				input.input_json == null ? null : JSON.stringify(input.input_json),
				JSON.stringify(initialRunState()),
				timestamp,
				timestamp
			)
			.run();

		const runId = runInsert.meta?.last_row_id;
		if (!runId) {
			return { success: false, error: 'Failed to create workflow run' };
		}

		const nodes = template.canvas_json?.nodes || [];
		for (let index = 0; index < nodes.length; index += 1) {
			const node = nodes[index];
			await db
				.prepare(
					`INSERT INTO superadmin_workflow_run_steps (
          run_id, step_key, step_type, title, position, status,
          input_json, output_json, error_message, started_at,
          completed_at, duration_ms, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', ?, NULL, NULL, NULL, NULL, NULL, ?, ?)`
				)
				.bind(
					runId,
					String(node.id || `step-${index + 1}`),
					String(node.type || 'task'),
					String(node.title || `Step ${index + 1}`),
					index,
					JSON.stringify(node.data || {}),
					timestamp,
					timestamp
				)
				.run();
		}

		const run = await getSuperadminWorkflowRun(db, runId);
		return { success: true, run, template };
	} catch (error) {
		log.error('[SuperadminWorkflows] create run failed:', error);
		return { success: false, error: 'Failed to create workflow run' };
	}
}

export async function updateSuperadminWorkflowRun(db, runId, patch = {}) {
	if (!db || !runId) return { success: false, error: 'Invalid parameters' };

	const current = await getRunRow(db, runId);
	if (!current) return { success: false, error: 'Workflow run not found' };

	const merged = {
		...current,
		...patch,
	};

	const timestamp = nowSql();

	try {
		await db
			.prepare(
				`UPDATE superadmin_workflow_runs
       SET status = ?,
           trigger_source = ?,
           requested_by_user_id = ?,
           workflow_instance_id = ?,
           legacy_history_id = ?,
           input_json = ?,
           state_json = ?,
           result_json = ?,
           error_message = ?,
           started_at = ?,
           completed_at = ?,
           duration_ms = ?,
           updated_at = ?
       WHERE id = ?`
			)
			.bind(
				merged.status ? String(merged.status).trim() : 'queued',
				merged.trigger_source ? String(merged.trigger_source).trim() : 'manual',
				merged.requested_by_user_id || null,
				merged.workflow_instance_id || null,
				merged.legacy_history_id == null ? null : Number(merged.legacy_history_id),
				merged.input_json == null
					? null
					: JSON.stringify(
							typeof merged.input_json === 'string'
								? safeJsonParse(merged.input_json, null)
								: merged.input_json
						),
				merged.state_json == null
					? null
					: JSON.stringify(
							typeof merged.state_json === 'string'
								? safeJsonParse(merged.state_json, null)
								: merged.state_json
						),
				merged.result_json == null
					? null
					: JSON.stringify(
							typeof merged.result_json === 'string'
								? safeJsonParse(merged.result_json, null)
								: merged.result_json
						),
				merged.error_message || null,
				merged.started_at || null,
				merged.completed_at || null,
				merged.duration_ms == null ? null : Number(merged.duration_ms),
				timestamp,
				runId
			)
			.run();

		const run = await getSuperadminWorkflowRun(db, runId);
		return { success: true, run };
	} catch (error) {
		log.error('[SuperadminWorkflows] update run failed:', error);
		return { success: false, error: 'Failed to update workflow run' };
	}
}

export async function updateSuperadminWorkflowRunStep(db, runId, stepKey, patch = {}) {
	if (!db || !runId || !stepKey) return { success: false, error: 'Invalid parameters' };

	const current = await getRunStepRow(db, runId, String(stepKey));
	if (!current) return { success: false, error: 'Workflow run step not found' };

	const merged = {
		...current,
		...patch,
	};

	const timestamp = nowSql();

	try {
		await db
			.prepare(
				`UPDATE superadmin_workflow_run_steps
       SET status = ?,
           input_json = ?,
           output_json = ?,
           error_message = ?,
           started_at = ?,
           completed_at = ?,
           duration_ms = ?,
           updated_at = ?
       WHERE run_id = ? AND step_key = ?`
			)
			.bind(
				merged.status ? String(merged.status).trim() : 'pending',
				merged.input_json == null
					? null
					: JSON.stringify(
							typeof merged.input_json === 'string'
								? safeJsonParse(merged.input_json, null)
								: merged.input_json
						),
				merged.output_json == null
					? null
					: JSON.stringify(
							typeof merged.output_json === 'string'
								? safeJsonParse(merged.output_json, null)
								: merged.output_json
						),
				merged.error_message || null,
				merged.started_at || null,
				merged.completed_at || null,
				merged.duration_ms == null ? null : Number(merged.duration_ms),
				timestamp,
				Number(runId),
				String(stepKey)
			)
			.run();

		const row = await getRunStepRow(db, Number(runId), String(stepKey));
		return {
			success: true,
			step: normalizeStepRows(row ? [row] : [])[0] || null,
		};
	} catch (error) {
		log.error('[SuperadminWorkflows] update run step failed:', error);
		return { success: false, error: 'Failed to update workflow run step' };
	}
}
