import { json } from '@sveltejs/kit';
import { getTemplateVersion } from '$lib/db/superadmin-workflow-versions.js';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';

/** GET /api/superadmin/workflows/:id/versions/:version — full snapshot. */
export async function GET({ cookies, platform, params }) {
	if (!checkIsSuperAdmin(cookies.get('discord_user_id'), platform)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const templateId = Number(params.id);
	const version = Number(params.version);
	if (!templateId || !version) return json({ error: 'Invalid parameters' }, { status: 400 });

	const db = (platform as { env?: { DB?: unknown } })?.env?.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	const snapshot = await getTemplateVersion(db, templateId, version);
	if (!snapshot) return json({ error: 'Version not found' }, { status: 404 });

	return json({ version: snapshot });
}
