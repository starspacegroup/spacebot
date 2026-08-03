import { redirect } from '@sveltejs/kit';
import {
	listSuperadminWorkflowRuns,
	listSuperadminWorkflowTemplates,
} from '$lib/db/superadmin-workflows.js';
import { OPERATION_TEMPLATES } from '$lib/server/superadmin-workflow-presets.js';
import { listWorkflowOperations } from '$lib/server/superadmin-workflow-operations.js';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';

export async function load({ cookies, platform }) {
	const userId = cookies.get('discord_user_id');
	if (!checkIsSuperAdmin(userId, platform)) {
		throw redirect(302, '/admin');
	}

	const db = (platform as any)?.env?.DB;
	const [templates, runs] = db
		? await Promise.all([
				listSuperadminWorkflowTemplates(db, { limit: 100 }),
				listSuperadminWorkflowRuns(db, { limit: 25 }),
			])
		: [[], []];

	return {
		templates,
		runs,
		operationTemplates: OPERATION_TEMPLATES,
		operationCatalog: listWorkflowOperations(),
	};
}
