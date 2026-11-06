import { json } from '@sveltejs/kit';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';
import { intParam } from '$lib/server/query-params.js';
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
	const limit = intParam(url, 'limit', 100, 1, 500);
	const runLimit = intParam(url, 'runLimit', 25, 1, 200);
	const runOffset = intParam(url, 'runOffset', 0, 0);

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

	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		return json({ error: 'Request body must be a JSON object' }, { status: 400 });
	}
	// is_builtin is reserved for the preset seeder.
	const { is_builtin: _ignored, ...input } = body || {};
	const result = await createSuperadminWorkflowTemplate(db, userId, input);
	if (!result.success) {
		const status = result.error === 'A workflow with this slug already exists' ? 409 : 400;
		return json({ error: result.error }, { status });
	}

	return json({ success: true, template: result.template }, { status: 201 });
}
