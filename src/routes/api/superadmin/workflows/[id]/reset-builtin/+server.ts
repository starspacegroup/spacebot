import { json } from '@sveltejs/kit';
import {
	getSuperadminWorkflowTemplate,
	updateSuperadminWorkflowTemplate,
} from '$lib/db/superadmin-workflows.js';
import { OPERATION_TEMPLATES } from '$lib/server/superadmin-workflow-presets.js';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';

/**
 * POST /api/superadmin/workflows/:id/reset-builtin
 *
 * Restore a built-in workflow to its shipped preset definition, published as
 * a new version (the customized history remains revertible).
 */
export async function POST({ cookies, platform, params }) {
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

	const preset = OPERATION_TEMPLATES.find((p) => p.slug === template.slug);
	if (!template.is_builtin || !preset) {
		return json({ error: 'Not a built-in workflow' }, { status: 400 });
	}

	const result = await updateSuperadminWorkflowTemplate(
		db,
		templateId,
		userId,
		{
			name: preset.name,
			description: preset.description,
			category: preset.category,
			execution_backend: preset.execution_backend,
			legacy_job_name: preset.legacy_job_name,
			schedule_type: preset.schedule_type,
			cron_expression: preset.cron_expression,
			canvas_json: preset.canvas_json,
			config_json: null,
		},
		{ changeNote: 'Reset to built-in definition' }
	);

	if (!result.success) {
		return json({ error: result.error }, { status: 400 });
	}

	return json({ success: true, template: result.template });
}
