import { json } from '@sveltejs/kit';
import { validateRunnerToken } from '$lib/db/local-runners.js';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';
import { getLatestAIContextSnapshotForUser } from '$lib/db/ai-orchestration.js';
import { getAllGuildMetadata, getGuildMetadataBatch } from '$lib/db/guild-metadata.js';

/**
 * GET /api/runner/guilds
 *
 * Deterministic (non-LLM) Discord server listing for the local runner TUI.
 * Superadmins see every guild the bot has data for; everyone else sees only
 * the guilds from their most recent managed-guilds snapshot (the same data
 * DMs are grounded on), enriched with the richer guild_metadata table.
 */
export async function GET({ request, platform }) {
	const db = (platform as any)?.env?.DB;
	if (!db) {
		return json({ error: 'Database not available' }, { status: 503 });
	}

	const authHeader = request.headers.get('Authorization') ?? '';
	const rawToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
	const clientIp =
		request.headers.get('CF-Connecting-IP') ??
		request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ??
		null;

	const auth = await validateRunnerToken(db, rawToken, clientIp);
	if (!auth.valid) {
		return json({ error: auth.error ?? 'Unauthorized' }, { status: 401 });
	}

	const isSuperAdmin = checkIsSuperAdmin(auth.userId, platform);

	if (isSuperAdmin) {
		const guilds = await getAllGuildMetadata(db);
		return json({ success: true, scope: 'all', guilds });
	}

	const snapshot = await getLatestAIContextSnapshotForUser(db, auth.userId);
	const managedGuilds = Array.isArray(snapshot?.managedGuilds) ? snapshot.managedGuilds : [];
	const guildIds = managedGuilds.map((g) => g?.id).filter(Boolean);
	const metadataById = await getGuildMetadataBatch(db, guildIds);

	const guilds = managedGuilds.map((g) => ({
		...(metadataById.get(g.id) || {}),
		guild_id: g.id,
		name: metadataById.get(g.id)?.name || g.name || g.id,
		isOwner: Boolean(g.isOwner),
		isAdmin: Boolean(g.isAdmin),
	}));

	return json({ success: true, scope: 'managed', guilds });
}
