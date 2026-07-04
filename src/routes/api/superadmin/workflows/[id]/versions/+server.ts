import { json } from '@sveltejs/kit';
import { getSuperadminWorkflowTemplate } from '$lib/db/superadmin-workflows.js';
import { listTemplateVersions } from '$lib/db/superadmin-workflow-versions.js';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';

/** GET /api/superadmin/workflows/:id/versions — version history (newest first). */
export async function GET({ cookies, platform, params, url }) {
	if (!checkIsSuperAdmin(cookies.get('discord_user_id'), platform)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const templateId = Number(params.id);
	if (!templateId) return json({ error: 'Invalid workflow ID' }, { status: 400 });

	const db = (platform as { env?: { DB?: unknown } })?.env?.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	const template = await getSuperadminWorkflowTemplate(db, templateId);
	if (!template) return json({ error: 'Workflow not found' }, { status: 404 });

	const limit = parseInt(url.searchParams.get('limit') || '50', 10);
	const versions = await listTemplateVersions(db, templateId, { limit });

	return json({
		template_id: templateId,
		published_version: template.published_version,
		versions: versions.map((v) => ({
			version: v.version,
			name: v.name,
			description: v.description,
			category: v.category,
			schedule_type: v.schedule_type,
			cron_expression: v.cron_expression,
			node_count: v.node_count,
			change_note: v.change_note,
			created_by_user_id: v.created_by_user_id,
			created_at: v.created_at,
		})),
	});
}
