import { fail, redirect } from '@sveltejs/kit';
import { log } from '$lib/db/logger.js';
import {
	getAnniversaryPostLog,
	getAnniversarySettings,
	saveAnniversarySettings,
} from '$lib/db/anniversary-timeline.js';
import {
	ANNIVERSARY_TIMELINES,
	DEFAULT_TIMELINE_KEY,
	getTimeline,
	zonedNow,
} from '$lib/anniversaries.js';
import { CHANNEL_TYPES, getGuildChannels } from '$lib/db/guild-channels.js';
import { hasFullAdminPermission } from '$lib/discord/guilds.js';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';
import { TIMEZONE_OPTIONS } from '$lib/timezone.js';

/** Channel types the bot can post a plain message into. */
const POSTABLE_TYPES = new Set<number>([CHANNEL_TYPES.TEXT, CHANNEL_TYPES.ANNOUNCEMENT]);

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform, parent, params }) {
	if (!/^\d{17,20}$/.test(params.serverId)) {
		throw redirect(302, '/admin');
	}

	const parentData = await parent();
	const userId = cookies.get('discord_user_id');
	if (!userId) throw redirect(302, '/login');

	const serverId = params.serverId;
	const isSuperAdmin = checkIsSuperAdmin(userId, platform);
	const adminGuilds = parentData.adminGuilds || [];

	const hasAccessToServer = isSuperAdmin || adminGuilds.some((g) => g.id === serverId);
	if (!hasAccessToServer) throw redirect(302, '/admin');

	const guild = adminGuilds.find((g) => g.id === serverId);

	// Turning this on makes the bot speak in a channel on a fixed date without
	// anyone present to approve it. That is server configuration, so it takes
	// full admin — the same bar as API keys and member rooms.
	const hasFullAdminAccess = isSuperAdmin || hasFullAdminPermission(guild);
	if (!hasFullAdminAccess) throw redirect(302, `/admin/${serverId}`);

	const db = (platform as any)?.env?.DB;

	const settings = await getAnniversarySettings(db, serverId, DEFAULT_TIMELINE_KEY);
	const channels = db ? await getGuildChannels(db, serverId) : [];
	const timeline = getTimeline(DEFAULT_TIMELINE_KEY);

	// The log is per-year, and "this year" has to be read on the guild's own
	// clock — on the evening of the 11th in New York it is already the 12th in
	// Sydney, and showing that guild an empty log would be a lie.
	let logYear = new Date().getUTCFullYear();
	try {
		logYear = zonedNow(new Date(), settings.timezone).year;
	} catch {
		/* fall back to UTC's year */
	}

	return {
		serverId,
		guild,
		settings,
		timeline,
		timelines: ANNIVERSARY_TIMELINES.map((t) => ({ key: t.key, title: t.title })),
		channels: channels.filter((c) => POSTABLE_TYPES.has(c.type)),
		// Drop the "auto-detect (browser timezone)" entry. There is no browser
		// involved when this posts — it runs on a cron tick with nobody watching,
		// so an empty zone would silently mean "whatever the server thinks",
		// which is the one answer that is never what someone chose.
		timezones: TIMEZONE_OPTIONS.filter((tz) => tz.value !== ''),
		logYear,
		postLog: await getAnniversaryPostLog(db, serverId, DEFAULT_TIMELINE_KEY, logYear),
	};
}

/** @type {import('./$types').Actions} */
export const actions = {
	save: async ({ request, cookies, platform, params }) => {
		const userId = cookies.get('discord_user_id');
		if (!userId) return fail(401, { error: 'Not signed in' });

		const db = (platform as any)?.env?.DB;
		if (!db) return fail(503, { error: 'Database not available' });

		const formData = await request.formData();
		const timelineKey = String(formData.get('timeline_key') || DEFAULT_TIMELINE_KEY);

		const result = await saveAnniversarySettings(
			db,
			params.serverId,
			{
				enabled: formData.get('enabled') === 'on',
				channel_id: formData.get('channel_id'),
				timezone: formData.get('timezone'),
				grace_minutes: formData.get('grace_minutes'),
				use_embed: formData.get('use_embed') === 'on',
				embed_color: formData.get('embed_color'),
			},
			timelineKey
		);

		if (!result.success) return fail(400, { error: result.error });

		log.info(
			`[Anniversary] ${userId} ${result.settings.enabled ? 'enabled' : 'disabled'} ${timelineKey} for guild ${params.serverId}`
		);

		return { success: true, settings: result.settings };
	},
};
