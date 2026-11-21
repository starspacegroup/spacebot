import { fail, redirect } from '@sveltejs/kit';
import { log } from '$lib/db/logger.js';
import { hasFullAdminPermission, verifyGuildAdmin } from '$lib/discord/guilds.js';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';
import {
	clearServerCommands,
	deleteServerData,
	recordDeletion,
	removeBotFromServer,
} from '$lib/server/server-deletion.js';

const env = (platform: any, name: string): string | undefined =>
	platform?.env?.[name] ?? (typeof process !== 'undefined' ? process.env?.[name] : undefined);

/** The name the person must type. Falls back to the id when Discord gave no name. */
async function confirmationName(db: any, serverId: string, guildName?: string) {
	if (guildName) return guildName;
	try {
		const row: any = await db
			?.prepare(`SELECT name FROM guild_metadata WHERE guild_id = ?`)
			.bind(serverId)
			.first();
		if (row?.name) return String(row.name);
	} catch {
		// no metadata yet
	}
	return serverId;
}

/** A paid plan that is still running blocks the delete, so nobody is billed for a server that is gone. */
async function activeSubscription(db: any, serverId: string) {
	try {
		const row: any = await db
			?.prepare(
				`SELECT stripe_subscription_id AS id, stripe_status AS status FROM server_plans WHERE guild_id = ?`
			)
			.bind(serverId)
			.first();
		return (
			Boolean(row?.id) && ['active', 'trialing', 'past_due', 'unpaid'].includes(row?.status)
		);
	} catch {
		return false;
	}
}

export async function load({ cookies, platform, parent, params }: any) {
	if (!/^\d{17,20}$/.test(params.serverId)) throw redirect(302, '/admin');
	const parentData = await parent();
	const userId = cookies.get('discord_user_id');
	if (!userId) throw redirect(302, '/login');

	const isSuperAdmin = checkIsSuperAdmin(userId, platform);
	const guild = (parentData.adminGuilds || []).find((g: any) => g.id === params.serverId);
	if (!isSuperAdmin && !guild) throw redirect(302, '/admin');

	const db = platform?.env?.DB;
	return {
		serverId: params.serverId,
		confirmName: await confirmationName(db, params.serverId, guild?.name),
		mayDelete: isSuperAdmin || hasFullAdminPermission(guild),
		hasSubscription: await activeSubscription(db, params.serverId),
	};
}

export const actions = {
	default: async ({ request, cookies, platform, params }: any) => {
		const serverId = params.serverId;
		const userId = cookies.get('discord_user_id');
		if (!userId || !/^\d{17,20}$/.test(serverId))
			return fail(401, { message: 'Not signed in.' });

		// Same bar as Settings: the owner or a full Administrator, or a SpaceBot superadmin.
		let discordName: string | undefined;
		if (!checkIsSuperAdmin(userId, platform)) {
			const check = await verifyGuildAdmin(
				serverId,
				cookies.get('discord_access_token'),
				cookies
			);
			if (!check?.authorized || !hasFullAdminPermission(check.guild)) {
				return fail(403, {
					message: 'Only the server owner or an Administrator can delete a server.',
				});
			}
			discordName = (check.guild as { name?: string } | undefined)?.name;
		}

		const db = platform?.env?.DB;
		if (!db) return fail(500, { message: 'The database is not available right now.' });

		const form = await request.formData();
		const typed = String(form.get('confirm') ?? '').trim();
		const expected = await confirmationName(db, serverId, discordName);
		if (typed !== expected) {
			return fail(400, { message: `Type ${expected} exactly to confirm.` });
		}
		if (await activeSubscription(db, serverId)) {
			return fail(400, {
				message: 'This server has a paid plan. Cancel it on the Billing page first.',
			});
		}

		const botToken = env(platform, 'DISCORD_BOT_TOKEN');
		await clearServerCommands(botToken, env(platform, 'DISCORD_CLIENT_ID'), serverId);

		let result;
		try {
			result = await deleteServerData(db, serverId);
		} catch (error) {
			log.error('[DeleteServer] failed:', error);
			return fail(500, {
				message: 'The delete stopped part way. Press the button again to finish it.',
			});
		}
		if (!result.done) {
			return fail(202, {
				message: `Still deleting (${result.removed.toLocaleString()} rows so far). Press the button again to finish.`,
			});
		}

		await recordDeletion(db, serverId, userId, result.removed, true).catch(() => {});
		// The bot leaves last, so a delete that stopped early can still be finished from the dashboard.
		await removeBotFromServer(botToken, serverId);
		log.info(`[DeleteServer] ${serverId} deleted by ${userId}: ${result.removed} rows`);
		throw redirect(303, '/admin?deleted=1');
	},
};
