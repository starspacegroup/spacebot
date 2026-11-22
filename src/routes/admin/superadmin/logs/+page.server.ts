import { redirect } from '@sveltejs/kit';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';
import {
	activityFeed,
	auditTrail,
	cleanFilter,
	errorFeed,
	DEFAULT_HOURS,
} from '$lib/server/superadmin-logs.js';
import { serverChoices, serverNames } from '$lib/server/superadmin-names.js';

const TABS = ['audit', 'activity', 'errors'] as const;

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform, url }) {
	if (!checkIsSuperAdmin(cookies.get('discord_user_id'), platform)) throw redirect(302, '/admin');
	const db = (platform as any)?.env?.DB;

	const asked = url.searchParams.get('tab');
	const tab = (TABS as readonly string[]).includes(asked ?? '')
		? (asked as (typeof TABS)[number])
		: 'audit';
	const filter = {
		guildId: url.searchParams.get('guild') ?? undefined,
		userId: url.searchParams.get('user') ?? undefined,
		hours: url.searchParams.get('hours') ?? undefined,
		before: url.searchParams.get('before') ?? undefined,
		limit: 50,
	} as any;
	const clean = cleanFilter(filter);

	const run = tab === 'audit' ? auditTrail : tab === 'activity' ? activityFeed : errorFeed;
	const rows = db ? await run(db, filter) : [];
	const [servers, choices] = await Promise.all([
		serverNames(
			db,
			rows.map((r) => r.guild_id)
		),
		serverChoices(db),
	]);

	return {
		tab,
		rows,
		servers,
		choices,
		filter: {
			guild: clean.guildId ?? '',
			user: clean.userId ?? '',
			hours: clean.hours ?? DEFAULT_HOURS,
		},
		// A full page means there may be more; the next page starts after the last row shown.
		next: rows.length >= clean.limit ? rows[rows.length - 1].at : null,
	};
}
