import { json } from '@sveltejs/kit';
import { guardGuildAdmin, statsPeriod } from '$lib/server/admin-guild-guard.js';
import { getTextConversations } from '$lib/db/text-conversations.js';

/** Who starts text conversations, who starts big ones, who kills them, and per channel. */
export async function GET(event) {
	const denied = await guardGuildAdmin(event);
	if (denied) return denied;
	const { params, platform, url } = event;
	const out = await getTextConversations(
		(platform as any).env.DB,
		params.serverId,
		statsPeriod(url)
	);
	return json(out, { headers: { 'cache-control': 'no-store' } });
}
