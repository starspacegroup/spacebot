import { json } from '@sveltejs/kit';
import { guardGuildAdmin, statsPeriod } from '$lib/server/admin-guild-guard.js';
import { getVoicePresence } from '$lib/db/voice-presence.js';

/** Who starts voice chats, who starts big ones, and who kills them. See voice-presence.ts. */
export async function GET(event) {
	const denied = await guardGuildAdmin(event);
	if (denied) return denied;
	const { params, platform, url } = event;
	const out = await getVoicePresence((platform as any).env.DB, params.serverId, statsPeriod(url));
	return json(out, { headers: { 'cache-control': 'no-store' } });
}
