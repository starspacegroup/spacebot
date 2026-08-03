import { json } from '@sveltejs/kit';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';
import {
	createSuperadminWorkflowTemplate,
	listSuperadminWorkflowRuns,
	listSuperadminWorkflowTemplates,
} from '$lib/db/superadmin-workflows.js';

export async function GET({ cookies, platform, url }) {
	const userId = cookies.get('discord_user_id');
	if (!checkIsSuperAdmin(userId, platform)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const db = (platform as any)?.env?.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	const includeArchived = url.searchParams.get('includeArchived') === 'true';
	const limit = parseInt(url.searchParams.get('limit') || '100', 10);
	const runLimit = parseInt(url.searchParams.get('runLimit') || '25', 10);
	const runOffset = parseInt(url.searchParams.get('runOffset') || '0', 10);

	const [templates, runs] = await Promise.all([
		listSuperadminWorkflowTemplates(db, { includeArchived, limit }),
		listSuperadminWorkflowRuns(db, { limit: runLimit, offset: runOffset }),
	]);

	return json({ templates, runs });
}

export async function POST({ cookies, platform, request }) {
	const userId = cookies.get('discord_user_id');
	if (!checkIsSuperAdmin(userId, platform)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const db = (platform as any)?.env?.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	const body = await request.json();
	// is_builtin is reserved for the preset seeder.
	const { is_builtin: _ignored, ...input } = body || {};
	const result = await createSuperadminWorkflowTemplate(db, userId, input);
	if (!result.success) {
		const status = result.error === 'A workflow with this slug already exists' ? 409 : 400;
		return json({ error: result.error }, { status });
	}

	return json({ success: true, template: result.template }, { status: 201 });
}
