import { log } from '$lib/log.js';

/**
 * Version history for superadmin workflow templates.
 *
 * Every definition change writes a full snapshot row here (see
 * superadmin-workflows.ts create/update). Reverting applies an old snapshot as
 * a NEW version — history is append-only, like git revert.
 */

/** Definition fields captured in a snapshot. Operational flags (enabled,
 * archived) are deliberately excluded so toggles don't create version churn. */
export const VERSIONED_TEMPLATE_FIELDS = [
	'name',
	'slug',
	'description',
	'category',
	'execution_backend',
	'legacy_job_name',
	'schedule_type',
	'cron_expression',
	'canvas_json',
	'config_json',
] as const;

function safeJsonParse(value, fallback) {
	if (!value) return fallback;

	try {
		return JSON.parse(value);
	} catch {
		return fallback;
	}
}

function canvasFingerprint(canvas) {
	const parsed =
		typeof canvas === 'string'
			? safeJsonParse(canvas, { nodes: [], edges: [] })
			: canvas || { nodes: [], edges: [] };
	return JSON.stringify(parsed);
}

function configFingerprint(config) {
	if (config == null) return 'null';
	const parsed = typeof config === 'string' ? safeJsonParse(config, null) : config;
	return JSON.stringify(parsed);
}

function normalizeVersionRow(row) {
	if (!row) return null;

	const canvas = safeJsonParse(row.canvas_json, { nodes: [], edges: [] });
	return {
		...row,
		template_id: Number(row.template_id),
		version: Number(row.version),
		canvas_json: canvas,
		config_json: safeJsonParse(row.config_json, null),
		node_count: Array.isArray(canvas?.nodes) ? canvas.nodes.length : 0,
	};
}

/**
 * Compare two template definitions (normalized template shapes — canvas_json
 * as objects). Returns true when any versioned field differs.
 */
export function definitionChanged(a, b) {
	if (!a || !b) return true;

	for (const field of VERSIONED_TEMPLATE_FIELDS) {
		if (field === 'canvas_json') {
			if (canvasFingerprint(a.canvas_json) !== canvasFingerprint(b.canvas_json)) return true;
		} else if (field === 'config_json') {
			if (configFingerprint(a.config_json) !== configFingerprint(b.config_json)) return true;
		} else {
			const av = a[field] == null || a[field] === '' ? null : String(a[field]);
			const bv = b[field] == null || b[field] === '' ? null : String(b[field]);
			if (av !== bv) return true;
		}
	}
	return false;
}

/**
 * Insert a snapshot row for the given normalized template at `version`.
 * Best-effort: failures are logged but never block the template write.
 */
export async function snapshotTemplateVersion(
	db,
	template,
	{
		version,
		changeNote = null,
		userId = 'system',
	}: { version?: number; changeNote?: string | null; userId?: string } = {}
) {
	if (!db || !template?.id || !version) return { success: false, error: 'Invalid parameters' };

	try {
		await db
			.prepare(
				`INSERT INTO superadmin_workflow_template_versions (
        template_id, version, name, slug, description, category,
        execution_backend, legacy_job_name, schedule_type, cron_expression,
        canvas_json, config_json, change_note, created_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(
				Number(template.id),
				Number(version),
				String(template.name || ''),
				String(template.slug || ''),
				template.description ? String(template.description) : null,
				template.category ? String(template.category) : 'operations',
				template.execution_backend
					? String(template.execution_backend)
					: 'cloudflare_workflows',
				template.legacy_job_name ? String(template.legacy_job_name) : null,
				template.schedule_type ? String(template.schedule_type) : 'manual',
				template.cron_expression ? String(template.cron_expression) : null,
				typeof template.canvas_json === 'string'
					? template.canvas_json
					: JSON.stringify(template.canvas_json || { nodes: [], edges: [] }),
				template.config_json == null
					? null
					: typeof template.config_json === 'string'
						? template.config_json
						: JSON.stringify(template.config_json),
				changeNote ? String(changeNote).slice(0, 500) : null,
				String(userId || 'system')
			)
			.run();

		return { success: true };
	} catch (error) {
		log.error('[SuperadminWorkflowVersions] snapshot failed:', error);
		return { success: false, error: 'Failed to snapshot workflow version' };
	}
}

export async function listTemplateVersions(db, templateId, { limit = 50 } = {}) {
	if (!db || !templateId) return [];

	const capped = Math.max(1, Math.min(Number(limit) || 50, 200));

	try {
		const result = await db
			.prepare(
				`SELECT * FROM superadmin_workflow_template_versions
       WHERE template_id = ? ORDER BY version DESC LIMIT ?`
			)
			.bind(Number(templateId), capped)
			.all();
		return (result.results || []).map(normalizeVersionRow);
	} catch (error) {
		log.error('[SuperadminWorkflowVersions] list failed:', error);
		return [];
	}
}

export async function getTemplateVersion(db, templateId, version) {
	if (!db || !templateId || !version) return null;

	try {
		const row = await db
			.prepare(
				`SELECT * FROM superadmin_workflow_template_versions
       WHERE template_id = ? AND version = ? LIMIT 1`
			)
			.bind(Number(templateId), Number(version))
			.first();
		return normalizeVersionRow(row);
	} catch (error) {
		log.error('[SuperadminWorkflowVersions] get failed:', error);
		return null;
	}
}
