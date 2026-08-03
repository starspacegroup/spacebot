import { json } from '@sveltejs/kit';
import { getAllRunnerTokens } from '$lib/db/local-runners.js';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';

// Backs the runner-token picker in the superadmin workflow editor's task
// step (operation: "local_runner_job") — see src/routes/admin/superadmin/workflows/+page.svelte.
export async function GET({ cookies, platform }) {
	const userId = cookies.get('discord_user_id');
	if (!checkIsSuperAdmin(userId, platform)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const db = (platform as any)?.env?.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	const tokens = await getAllRunnerTokens(db);
	return json({ tokens });
}
