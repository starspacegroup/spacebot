import { fail, redirect } from '@sveltejs/kit';
import { hasFullAdminPermission } from '$lib/discord/guilds.js';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';
import {
	createInboundWebhook,
	deleteInboundWebhook,
	listInboundWebhooks,
	rotateInboundWebhookSecret,
	setInboundWebhookEnabled,
	webhookUrl,
} from '$lib/db/inbound-webhooks.js';
import { getServerPlan, inboundWebhookLimit } from '$lib/db/server-plans.js';

/** Manage Server only, as for API keys. Returns what the actions need, or redirects. */
async function guard({ cookies, platform, parent, params }: any) {
	if (!/^\d{17,20}$/.test(params.serverId)) throw redirect(302, '/admin');
	const parentData = await parent();
	const userId = cookies.get('discord_user_id');
	if (!userId) throw redirect(302, '/login');
	const isSuperAdmin = checkIsSuperAdmin(userId, platform);
	const guild = (parentData.adminGuilds || []).find((g: any) => g.id === params.serverId);
	if (!isSuperAdmin && !guild) throw redirect(302, '/admin');
	if (!isSuperAdmin && !hasFullAdminPermission(guild))
		throw redirect(302, `/admin/${params.serverId}`);
	return { userId, guild };
}

/** @type {import('./$types').PageServerLoad} */
export async function load(event: any) {
	const { guild } = await guard(event);
	const db = event.platform?.env?.DB;
	const serverId = event.params.serverId;
	const origin = event.url.origin;
	const [hooks, plan] = await Promise.all([
		db ? listInboundWebhooks(db, serverId) : [],
		db ? getServerPlan(db, serverId) : { plan: 'free' },
	]);
	return {
		serverId,
		guild,
		limit: inboundWebhookLimit(plan),
		webhooks: hooks.map((h) => ({ ...h, url: webhookUrl(origin, h.public_id) })),
	};
}

/** Mutations are authorized per server by authorizePageMutation (hooks) before they get here. */
async function run(
	event: any,
	fn: (db: any, serverId: string, userId: string, fd: FormData) => Promise<any>
) {
	const userId = event.cookies.get('discord_user_id');
	if (!userId) return fail(401, { success: false, message: 'Not authenticated' });
	const db = event.platform?.env?.DB;
	if (!db) return fail(500, { success: false, message: 'Database not available' });
	return fn(db, event.params.serverId, userId, await event.request.formData());
}

/** @type {import('./$types').Actions} */
export const actions = {
	create: async (event: any) =>
		run(event, async (db, serverId, userId, fd) => {
			const r = await createInboundWebhook(db, serverId, {
				name: fd.get('name'),
				description: fd.get('description'),
				created_by: userId,
			});
			if ('error' in r) return fail(r.status, { success: false, message: r.error });
			return {
				success: true,
				message: "Webhook created. Copy the secret now; it won't be shown again.",
				secret: r.secret,
				secretFor: r.webhook.name,
				url: webhookUrl(event.url.origin, r.webhook.public_id),
			};
		}),

	rotate: async (event: any) =>
		run(event, async (db, serverId, _u, fd) => {
			const r = await rotateInboundWebhookSecret(db, serverId, String(fd.get('id') || ''));
			if ('error' in r) return fail(r.status, { success: false, message: r.error });
			return {
				success: true,
				message: 'Secret replaced. The old one no longer works.',
				secret: r.secret,
				secretFor: r.webhook.name,
				url: webhookUrl(event.url.origin, r.webhook.public_id),
			};
		}),

	toggle: async (event: any) =>
		run(event, async (db, serverId, _u, fd) => {
			const r = await setInboundWebhookEnabled(
				db,
				serverId,
				String(fd.get('id') || ''),
				fd.get('enabled') === 'true'
			);
			if ('error' in r) return fail(r.status, { success: false, message: r.error });
			return {
				success: true,
				message: r.webhook.enabled ? 'Webhook enabled' : 'Webhook disabled',
			};
		}),

	delete: async (event: any) =>
		run(event, async (db, serverId, _u, fd) => {
			const r = await deleteInboundWebhook(db, serverId, String(fd.get('id') || ''));
			if ('error' in r) return fail(r.status, { success: false, message: r.error });
			return { success: true, message: 'Webhook deleted' };
		}),
};
