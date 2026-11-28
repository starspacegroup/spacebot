import { fail, redirect } from '@sveltejs/kit';
import { log } from '$lib/db/logger.js';
import { verifyGuildAdmin } from '$lib/discord/guilds.js';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';
import {
	clearServerCommands,
	MIN_WAIT_SECONDS,
	deleteServerData,
	isServerOwner,
	issueConfirmation,
	namesMatch,
	redeemConfirmation,
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
		// If the plan cannot be read, do not risk deleting a paid server.
		return true;
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
		// Only the owner. Superadmins and Administrators can look at this page, not use it.
		mayDelete: guild?.owner === true,
		hasSubscription: await activeSubscription(db, params.serverId),
		waitSeconds: MIN_WAIT_SECONDS,
	};
}

/** Who may delete, and the name they must type. Shared by both steps. */
async function gate({ cookies, platform, params }: any) {
	const serverId = params.serverId;
	const userId = cookies.get('discord_user_id');
	if (!userId || !/^\d{17,20}$/.test(serverId))
		return { error: fail(401, { message: 'Not signed in.' }) };

	// Only the server's owner. Not an Administrator, and not a SpaceBot superadmin.
	const check = await verifyGuildAdmin(serverId, cookies.get('discord_access_token'), cookies);
	const owner =
		check?.authorized &&
		(await isServerOwner(
			env(platform, 'DISCORD_BOT_TOKEN'),
			serverId,
			userId,
			(check.guild as { owner?: unknown } | undefined)?.owner
		));
	if (!owner) {
		return {
			error: fail(403, { message: 'Only the owner of the Discord server can delete it.' }),
		};
	}
	const discordName = (check.guild as { name?: string } | undefined)?.name;
	const db = platform?.env?.DB;
	if (!db) return { error: fail(500, { message: 'The database is not available right now.' }) };
	if (await activeSubscription(db, serverId)) {
		return {
			error: fail(400, {
				message: 'This server has a paid plan. Cancel it on the Billing page first.',
			}),
		};
	}
	return { serverId, userId, db, expected: await confirmationName(db, serverId, discordName) };
}

export const actions = {
	/** Step one: the name and the tick box. Hands back a token; deletes nothing. */
	prepare: async (event: any) => {
		const g = await gate(event);
		if (g.error) return g.error;
		const form = await event.request.formData();
		if (!namesMatch(form.get('confirm'), g.expected!)) {
			return fail(400, { message: `Type ${g.expected} exactly to continue.` });
		}
		if (form.get('understand') !== 'on') {
			return fail(400, {
				message: 'Tick the box to say you understand this cannot be undone.',
			});
		}
		const token = await issueConfirmation(g.db, g.serverId!, g.userId!);
		return { step: 'confirm', token, waitSeconds: MIN_WAIT_SECONDS };
	},

	/** Step two: the token, no sooner than the wait. This is the only thing that deletes. */
	confirm: async (event: any) => {
		const g = await gate(event);
		if (g.error) return g.error;
		const form = await event.request.formData();
		const token = String(form.get('token') ?? '');
		const verdict = await redeemConfirmation(g.db, g.serverId!, g.userId!, token);
		if (verdict === 'too-soon') {
			return fail(400, {
				step: 'confirm',
				token,
				message: 'Wait for the timer, then press the button.',
			});
		}
		if (verdict !== 'ok') {
			return fail(400, {
				message: 'That confirmation has expired. Start again and type the name.',
			});
		}

		const botToken = env(event.platform, 'DISCORD_BOT_TOKEN');
		await clearServerCommands(botToken, env(event.platform, 'DISCORD_CLIENT_ID'), g.serverId!);

		let result;
		try {
			result = await deleteServerData(g.db, g.serverId!);
		} catch (error) {
			log.error('[DeleteServer] failed:', error);
			return fail(500, {
				message: 'The delete stopped part way. Start again to finish it.',
			});
		}
		if (!result.done) {
			// Not finished: hand back a fresh token so the next press carries on without retyping.
			const next = await issueConfirmation(g.db, g.serverId!, g.userId!);
			return {
				step: 'confirm',
				token: next,
				waitSeconds: MIN_WAIT_SECONDS,
				message: `Still deleting (${result.removed.toLocaleString()} rows so far). Press the button again to finish.`,
			};
		}

		await recordDeletion(g.db, g.serverId!, g.userId!, result.removed, true).catch(() => {});
		// The bot leaves last, so a delete that stopped early can still be finished from the dashboard.
		await removeBotFromServer(botToken, g.serverId!);
		log.info(`[DeleteServer] ${g.serverId} deleted by ${g.userId}: ${result.removed} rows`);
		throw redirect(303, '/admin?deleted=1');
	},
};
