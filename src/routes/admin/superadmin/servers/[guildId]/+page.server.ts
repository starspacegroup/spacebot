import { error, redirect } from '@sveltejs/kit';
import { getGuildMetadata } from '$lib/db/guild-metadata.js';
import { getServerPlan } from '$lib/db/server-plans.js';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';
import { peopleOfServer } from '$lib/server/user-guilds.js';
import { activityFeed, auditTrail, errorFeed } from '$lib/server/superadmin-logs.js';

async function one(db: any, sql: string, ...binds: unknown[]) {
	try {
		return await db
			.prepare(sql)
			.bind(...binds)
			.first();
	} catch {
		return null;
	}
}

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform, params, url }) {
	if (!checkIsSuperAdmin(cookies.get('discord_user_id'), platform)) throw redirect(302, '/admin');
	const db = (platform as any)?.env?.DB;
	if (!db || !/^\d{17,20}$/.test(params.guildId)) throw error(404, 'No such server');
	const guildId = params.guildId;

	const [meta, plan, sync, commands, automations, people] = await Promise.all([
		getGuildMetadata(db, guildId),
		getServerPlan(db, guildId),
		one(
			db,
			`SELECT synced_at, attempted_at, last_error FROM guild_command_sync WHERE guild_id = ?`,
			guildId
		),
		one(
			db,
			`SELECT COUNT(*) total, SUM(enabled = 1) active FROM commands WHERE guild_id = ?`,
			guildId
		),
		one(
			db,
			`SELECT COUNT(*) total, SUM(enabled = 1) active FROM automations WHERE guild_id = ?`,
			guildId
		),
		peopleOfServer(db, guildId),
	]);
	if (!meta && people.length === 0 && !commands?.total) throw error(404, 'No such server');

	const hours = url.searchParams.get('hours') ?? undefined;
	const [audit, activity, errors] = await Promise.all([
		auditTrail(db, { guildId, hours: hours as any, limit: 30 }),
		activityFeed(db, { guildId, hours: hours as any, limit: 30 }),
		errorFeed(db, { guildId, hours: hours as any, limit: 20 }),
	]);

	// The owner Discord reports may never have signed in, so show them either way.
	const ownerId: string | null = meta?.owner_id ?? null;
	const ownerRow = ownerId
		? await one(db, `SELECT username, global_name FROM users WHERE id = ?`, ownerId)
		: null;

	return {
		guild: {
			id: guildId,
			name: meta?.name ?? guildId,
			icon: meta?.icon ?? null,
			members: meta?.approximate_member_count ?? null,
			ownerId,
			ownerName: ownerRow ? ownerRow.global_name || ownerRow.username : null,
		},
		plan: { name: plan?.plan ?? 'free', expires_at: plan?.expires_at ?? null },
		sync: sync ?? null,
		commands: { total: commands?.total ?? 0, active: commands?.active ?? 0 },
		automations: { total: automations?.total ?? 0, active: automations?.active ?? 0 },
		people,
		audit,
		activity,
		errors,
		hours: Number(hours) || 168,
	};
}
