import { fail, redirect } from '@sveltejs/kit';
import { getBuiltInCommandsForGuild } from '$lib/db/commands.js';
import { verifyGuildAdmin } from '$lib/discord/guilds.js';
import { setCommandEnabled } from '$lib/server/control-actions.js';
import {
	addCustom,
	getHidden,
	listCustom,
	removeCustom,
	setHidden,
} from '$lib/server/personality-command.js';
import {
	CATEGORIES,
	MAX_CUSTOM_TESTS,
	MAX_NAME_LENGTH,
	MAX_NOTE_LENGTH,
	MAX_URL_LENGTH,
	TESTS,
} from '$lib/server/personality-tests.js';

const LIMITS = {
	links: MAX_CUSTOM_TESTS,
	name: MAX_NAME_LENGTH,
	note: MAX_NOTE_LENGTH,
	url: MAX_URL_LENGTH,
};

/** The built-in catalog as the page needs it: no keywords. */
const CATALOG = TESTS.map((t) => ({
	id: t.id,
	name: t.name,
	category: t.category,
	url: t.url,
	blurb: t.blurb,
	adult: Boolean(t.adult),
}));

/** @type {import('./$types').PageServerLoad} */
export async function load({ platform, parent, params }) {
	if (!/^\d{17,20}$/.test(params.serverId)) throw redirect(302, '/admin');
	const parentData = await parent();
	const guildId = params.serverId;
	if (!parentData.adminGuilds?.some((g) => g.id === guildId) && !parentData.isSuperAdmin) {
		throw redirect(302, '/admin');
	}

	const base = {
		serverId: guildId,
		categories: CATEGORIES,
		catalog: CATALOG,
		limits: LIMITS,
	};
	const db = (platform as any)?.env?.DB;
	if (!db) {
		return {
			...base,
			available: false,
			enabled: false,
			commandId: null,
			hidden: [],
			custom: [],
		};
	}

	const [builtIns, hidden, custom] = await Promise.all([
		getBuiltInCommandsForGuild(db, guildId),
		getHidden(db, guildId),
		listCustom(db, guildId),
	]);
	const command = builtIns.find((c) => c.name === 'personality');
	return {
		...base,
		available: Boolean(command),
		enabled: Boolean(command?.enabled),
		commandId: command?.id ?? null,
		hidden: [...hidden],
		custom,
	};
}

/**
 * Every write here needs Manage Server on this server, checked against Discord, not just a
 * sign-in: the same bar as `/personality` itself.
 */
async function guard({ cookies, platform, params }: any) {
	const auth = await verifyGuildAdmin(
		params.serverId,
		cookies.get('discord_access_token'),
		cookies
	);
	if (!auth.authorized) return { error: fail(403, { error: 'You need Manage Server here.' }) };
	const db = (platform as any)?.env?.DB;
	if (!db) return { error: fail(503, { error: 'Database not available' }) };
	return { db, env: (platform as any)?.env, userId: cookies.get('discord_user_id') ?? '' };
}

/** @type {import('./$types').Actions} */
export const actions = {
	/** Turn /personality on or off for this server (the command registers or leaves Discord). */
	enable: async (event) => {
		const g: any = await guard(event);
		if (g.error) return g.error;
		const form = await event.request.formData();
		const commandId = Number(form.get('command_id'));
		const enabled = form.get('enabled') === 'on';
		const r = await setCommandEnabled(g.db, g.env, event.params.serverId, commandId, enabled);
		if (!r.ok) return fail(r.status || 500, { error: r.error });
		return { success: true, message: enabled ? '/personality is on.' : '/personality is off.' };
	},

	/** The checked tests are shown; every other built-in test is hidden. */
	selection: async (event) => {
		const g: any = await guard(event);
		if (g.error) return g.error;
		const form = await event.request.formData();
		const shown = new Set(form.getAll('shown').map(String));
		const hide = TESTS.filter((t) => !shown.has(t.id)).map((t) => t.id);
		await setHidden(g.db, event.params.serverId, g.userId, hide);
		return {
			success: true,
			message: hide.length
				? `Saved. ${TESTS.length - hide.length} of ${TESTS.length} tests show.`
				: 'Saved. Every test shows.',
		};
	},

	showall: async (event) => {
		const g: any = await guard(event);
		if (g.error) return g.error;
		await setHidden(g.db, event.params.serverId, g.userId, []);
		return { success: true, message: 'Every built-in test shows.' };
	},

	add: async (event) => {
		const g: any = await guard(event);
		if (g.error) return g.error;
		const form = await event.request.formData();
		const r = await addCustom(g.db, event.params.serverId, g.userId, {
			name: form.get('name'),
			url: form.get('url'),
			category: form.get('category'),
			note: form.get('note'),
		});
		if (!r.ok) return fail(400, { error: r.error });
		return { success: true, message: `Added: ${r.name}` };
	},

	remove: async (event) => {
		const g: any = await guard(event);
		if (g.error) return g.error;
		const form = await event.request.formData();
		const gone = await removeCustom(g.db, event.params.serverId, Number(form.get('id')));
		return gone
			? { success: true, message: 'Removed.' }
			: fail(404, { error: 'That link is already gone.' });
	},
};
