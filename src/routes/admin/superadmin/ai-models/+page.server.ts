import { redirect } from '@sveltejs/kit';
import {
	getCachedWorkersAICatalog,
	getModelSelection,
	isCatalogStale,
} from '$lib/server/workers-ai-models.js';
import { DEFAULT_MODEL } from '$lib/ai/chat.js';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform }) {
	const userId = cookies.get('discord_user_id');
	if (!checkIsSuperAdmin(userId, platform)) {
		throw redirect(302, '/admin');
	}

	const db = (platform as any)?.env?.DB;

	const [cached, envModel] = await Promise.all([
		getCachedWorkersAICatalog(db),
		Promise.resolve(
			(platform as any)?.env?.CLOUDFLARE_AI_MODEL ||
				(typeof process !== 'undefined' ? process.env?.CLOUDFLARE_AI_MODEL : undefined) ||
				DEFAULT_MODEL
		),
	]);

	const { models, syncedAt } = cached;
	const source = 'database';
	const warning =
		models.length === 0
			? 'No cached model catalog found. Run a Workers AI catalog sync job or use Sync From Cloudflare.'
			: null;

	const selection = await getModelSelection(db, envModel);

	return {
		catalog: models,
		syncedAt,
		stale: isCatalogStale(syncedAt),
		source,
		warning,
		selection,
		defaults: { envModel },
	};
}
