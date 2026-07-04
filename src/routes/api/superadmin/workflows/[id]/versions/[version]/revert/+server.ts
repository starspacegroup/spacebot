import { json } from '@sveltejs/kit';
import {
	getSuperadminWorkflowTemplate,
	updateSuperadminWorkflowTemplate,
} from '$lib/db/superadmin-workflows.js';
import { getTemplateVersion } from '$lib/db/superadmin-workflow-versions.js';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';

/**
 * POST /api/superadmin/workflows/:id/versions/:version/revert
 *
 * Applies the snapshot's definition as a NEW version (git-revert style — the
 * history never rewinds). Body: { change_note? }
 */
export async function POST({ request, cookies, platform, params }) {
	const userId = cookies.get('discord_user_id');
	if (!checkIsSuperAdmin(userId, platform)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const templateId = Number(params.id);
	const version = Number(params.version);
	if (!templateId || !version) return json({ error: 'Invalid parameters' }, { status: 400 });

	const db = (platform as { env?: { DB?: unknown } })?.env?.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	const template = await getSuperadminWorkflowTemplate(db, templateId);
	if (!template) return json({ error: 'Workflow not found' }, { status: 404 });

	const snapshot = await getTemplateVersion(db, templateId, version);
	if (!snapshot) return json({ error: 'Version not found' }, { status: 404 });

	if (version === template.published_version) {
		return json({ error: 'This is already the live version' }, { status: 409 });
	}

	const body = await request.json().catch(() => ({}));
	const changeNote = body?.change_note ? String(body.change_note) : `Revert to v${version}`;

	const result = await updateSuperadminWorkflowTemplate(
		db,
		templateId,
		userId,
		{
			name: snapshot.name,
			// Built-in slugs are immutable; keep the live slug for them.
			slug: template.is_builtin ? template.slug : snapshot.slug,
			description: snapshot.description,
			category: snapshot.category,
			execution_backend: snapshot.execution_backend,
			legacy_job_name: snapshot.legacy_job_name,
			schedule_type: snapshot.schedule_type,
			cron_expression: snapshot.cron_expression,
			canvas_json: snapshot.canvas_json,
			config_json: snapshot.config_json,
		},
		{ changeNote }
	);

	if (!result.success) {
		return json({ error: result.error }, { status: 400 });
	}

	return json({ success: true, template: result.template, reverted_to: version });
}
