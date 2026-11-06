import { json } from '@sveltejs/kit';
import { listUserWorkflows, createUserWorkflow } from '$lib/db/workflows.js';
import { intParam } from '$lib/server/query-params.js';

/** @type {import('./$types').RequestHandler} */
export async function GET({ cookies, platform, url }) {
	const userId = cookies.get('discord_user_id');
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const db = (platform as any)?.env?.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	const enabledOnly = url.searchParams.get('enabled') === '1';
	const limit = intParam(url, 'limit', 100, 1, 200);

	const workflows = await listUserWorkflows(db, userId, { enabledOnly, limit });
	return json({ workflows, filters: { enabledOnly, limit } });
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ request, cookies, platform }) {
	const userId = cookies.get('discord_user_id');
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const db = (platform as any)?.env?.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	let body;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const result: any = await createUserWorkflow(db, userId, body || {});
	if (!result.success) return json({ error: result.error }, { status: 400 });

	return json({ success: true, workflow: result.workflow }, { status: 201 });
}
