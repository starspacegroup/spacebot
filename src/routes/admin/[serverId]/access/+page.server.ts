import { redirect } from '@sveltejs/kit';

/**
 * What a member may open here when the server let them in through a role (Settings, Permissions).
 * Admins belong on the dashboard; anyone else who is not in the member list is sent away.
 * The features come from the layout, which asked Discord for the member's roles this request.
 */
export async function load({ params, parent }) {
	const { serverId } = params;
	if (!/^\d{17,20}$/.test(serverId)) throw redirect(302, '/admin');

	const parentData = await parent();
	if (parentData.isSuperAdmin || (parentData.adminGuilds || []).some((g) => g.id === serverId)) {
		throw redirect(302, `/admin/${serverId}`);
	}

	const guild = (parentData.memberGuilds || []).find((g) => g.id === serverId);
	if (!guild) throw redirect(302, '/admin');

	return {
		serverId,
		guild: { id: guild.id, name: guild.name ?? null, icon: guild.icon ?? null },
		features: guild.features,
	};
}
