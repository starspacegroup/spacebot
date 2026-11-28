import { fail, redirect } from '@sveltejs/kit';
import { hasFullAdminPermission } from '$lib/discord/guilds.js';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';
import { getGuildMetadata } from '$lib/db/guild-metadata.js';
import { applyBotIdentity, getBotIdentity, saveBotIdentity } from '$lib/db/bot-identity.js';
import {
	MAX_CUSTOM_IMAGE_BYTES,
	MAX_NICK,
	bytesToDataUri,
	defaultBotName,
	guildIconUrl,
	parseCustomName,
} from '$lib/server/bot-identity-core.js';

const getEnv = (platform: any, name: string) =>
	platform?.env?.[name] ?? (typeof process !== 'undefined' ? process.env?.[name] : undefined);

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform, parent, params }: any) {
	if (!/^\d{17,20}$/.test(params.serverId)) throw redirect(302, '/admin');
	const parentData = await parent();
	const userId = cookies.get('discord_user_id');
	if (!userId) throw redirect(302, '/login');
	const isSuperAdmin = checkIsSuperAdmin(userId, platform);
	const guild = (parentData.adminGuilds || []).find((g: any) => g.id === params.serverId);
	if (!isSuperAdmin && !guild) throw redirect(302, '/admin');
	if (!isSuperAdmin && !hasFullAdminPermission(guild))
		throw redirect(302, `/admin/${params.serverId}`);

	const db = platform?.env?.DB;
	const [identity, meta] = await Promise.all([
		getBotIdentity(db, params.serverId),
		db ? getGuildMetadata(db, params.serverId) : null,
	]);
	const guildName = meta?.name || guild?.name || '';
	return {
		serverId: params.serverId,
		guild,
		identity: { ...identity, avatar_data: identity.avatar_data ? 'set' : null },
		customImagePreview: identity.avatar_data,
		defaultName: defaultBotName(guildName),
		defaultIconUrl: guildIconUrl(params.serverId, meta?.icon ?? guild?.icon),
		maxNick: MAX_NICK,
		maxImageKb: MAX_CUSTOM_IMAGE_BYTES / 1024,
	};
}

/** Mutations are authorized per server by authorizePageMutation (hooks) before they get here. */
export const actions = {
	save: async ({ request, cookies, platform, params }: any) => {
		const userId = cookies.get('discord_user_id');
		if (!userId) return fail(401, { success: false, message: 'Not authenticated' });
		const db = platform?.env?.DB;
		if (!db) return fail(500, { success: false, message: 'Database not available' });

		const fd = await request.formData();
		const enabled = fd.get('enabled') === 'on';
		const parsed = parseCustomName(fd.get('name'));
		if ('error' in parsed) return fail(400, { success: false, message: parsed.error });
		const mode = fd.get('avatar_mode') === 'custom' ? 'custom' : 'server_icon';

		const current = await getBotIdentity(db, params.serverId);
		let avatarData: string | null = mode === 'custom' ? current.avatar_data : null;
		const file = fd.get('avatar');
		if (mode === 'custom' && file instanceof File && file.size > 0) {
			if (file.size > MAX_CUSTOM_IMAGE_BYTES) {
				return fail(400, {
					success: false,
					message: `The image is over ${MAX_CUSTOM_IMAGE_BYTES / 1024} KB`,
				});
			}
			const r = bytesToDataUri(new Uint8Array(await file.arrayBuffer()));
			if ('error' in r) return fail(400, { success: false, message: r.error });
			avatarData = r.dataUri;
		}
		if (mode === 'custom' && !avatarData) {
			return fail(400, {
				success: false,
				message: 'Choose an image, or use the server icon.',
			});
		}

		await saveBotIdentity(
			db,
			params.serverId,
			{ enabled, name: parsed.name, avatar_mode: mode, avatar_data: avatarData },
			userId
		);
		const result = await applyBotIdentity(
			db,
			getEnv(platform, 'DISCORD_BOT_TOKEN'),
			params.serverId,
			{ force: true }
		);
		if ('error' in result)
			return fail(502, {
				success: false,
				message: `Saved, but Discord did not take it. ${result.error}`,
			});
		return {
			success: true,
			message: enabled
				? `The bot now goes by “${result.name}” on this server.`
				: 'The bot is back to its own name and picture here.',
		};
	},

	reapply: async ({ cookies, platform, params }: any) => {
		if (!cookies.get('discord_user_id'))
			return fail(401, { success: false, message: 'Not authenticated' });
		const db = platform?.env?.DB;
		if (!db) return fail(500, { success: false, message: 'Database not available' });
		const result = await applyBotIdentity(
			db,
			getEnv(platform, 'DISCORD_BOT_TOKEN'),
			params.serverId,
			{ force: true }
		);
		if ('error' in result) return fail(502, { success: false, message: result.error });
		return { success: true, message: 'Applied again.' };
	},
};
