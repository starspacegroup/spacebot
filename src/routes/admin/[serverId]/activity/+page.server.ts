import { fail, redirect } from '@sveltejs/kit';
import { log } from '$lib/db/logger.js';
import { getBuiltInCommandsForGuild, setBuiltInCommandOverride } from '$lib/db/commands.js';
import { syncGuildCommands } from '$lib/discord/commands.js';
import { hasFullAdminPermission } from '$lib/discord/guilds.js';
import { ACTIVITY_MODULES } from '$lib/server/activity.js';
import { DEFAULTS, getSettings, upsertSettings } from '$lib/server/timebox.js';
import {
	DEFAULTS as GAME_DEFAULTS,
	LIMITS as GAME_LIMITS,
	getSettings as getGameSettings,
	upsertSettings as upsertGameSettings,
} from '$lib/server/game.js';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';

/** Bounds match what `/timebox settings` accepts, so the two never disagree. */
const TIMEBOX_LIMITS = {
	focus: [1, 180],
	break: [1, 60],
	longBreak: [1, 120],
	rounds: [1, 12],
} as const;

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform, parent, params }) {
	if (!/^\d{17,20}$/.test(params.serverId)) throw redirect(302, '/admin');

	const parentData = await parent();
	const userId = cookies.get('discord_user_id');
	if (!userId) throw redirect(302, '/login');

	const serverId = params.serverId;
	const isSuperAdmin = checkIsSuperAdmin(userId, platform);
	const adminGuilds = parentData.adminGuilds || [];
	const guild = adminGuilds.find((g) => g.id === serverId);
	if (!isSuperAdmin && !guild) throw redirect(302, '/admin');

	// Turning a feature on changes what the bot offers members, so full admin.
	if (!(isSuperAdmin || hasFullAdminPermission(guild))) {
		throw redirect(302, `/admin/${serverId}`);
	}

	const db = (platform as any)?.env?.DB;
	const commands = db ? await getBuiltInCommandsForGuild(db, serverId) : [];
	const modules = ACTIVITY_MODULES.map((m) => {
		const command = commands.find((c) => c.name === m.command);
		return {
			id: m.id,
			name: m.name,
			command: m.command,
			summary: m.help.summary,
			start: m.help.start,
			enabled: Boolean(command?.enabled),
		};
	});

	return {
		serverId,
		guild,
		modules,
		timebox: db
			? await getSettings(db, serverId)
			: { ...DEFAULTS, longBreak: DEFAULTS.longBreak },
		limits: TIMEBOX_LIMITS,
		game: db ? await getGameSettings(db, serverId) : { ...GAME_DEFAULTS },
		gameLimits: GAME_LIMITS,
	};
}

function whole(formData: FormData, key: string, [min, max]: readonly [number, number]) {
	const n = Number(formData.get(key));
	return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** @type {import('./$types').Actions} */
export const actions = {
	toggleModule: async ({ request, cookies, platform, params }) => {
		if (!cookies.get('discord_user_id')) {
			return fail(401, { success: false, message: 'Not authenticated' });
		}
		const db = (platform as any)?.env?.DB;
		if (!db) return fail(500, { success: false, message: 'Database not available' });

		const formData = await request.formData();
		const module = ACTIVITY_MODULES.find((m) => m.id === String(formData.get('module')));
		if (!module) return fail(400, { success: false, message: 'Unknown module.' });
		const enabled = formData.get('enabled') === 'on';

		const command = (await getBuiltInCommandsForGuild(db, params.serverId)).find(
			(c) => c.name === module.command
		);
		if (!command)
			return fail(404, { success: false, message: `/${module.command} is missing.` });

		const result = await setBuiltInCommandOverride(db, params.serverId, command.id, {
			enabled,
		});
		if (!result.success) return fail(400, { success: false, message: result.error });

		log.info(`[Activity] ${module.name} ${enabled ? 'on' : 'off'} for ${params.serverId}`);
		// The command is what Discord shows members; push it now rather than wait
		// for the minute sweep.
		await syncGuildCommands(db, params.serverId, (platform as any)?.env);
		return { success: true, message: `${module.name} is ${enabled ? 'on' : 'off'}.` };
	},

	saveTimebox: async ({ request, cookies, platform, params }) => {
		if (!cookies.get('discord_user_id')) {
			return fail(401, { success: false, message: 'Not authenticated' });
		}
		const db = (platform as any)?.env?.DB;
		if (!db) return fail(500, { success: false, message: 'Database not available' });

		const formData = await request.formData();
		const focus = whole(formData, 'focus', TIMEBOX_LIMITS.focus);
		const rest = whole(formData, 'break', TIMEBOX_LIMITS.break);
		const longBreak = whole(formData, 'longBreak', TIMEBOX_LIMITS.longBreak);
		const rounds = whole(formData, 'rounds', TIMEBOX_LIMITS.rounds);
		if (focus === null || rest === null || longBreak === null || rounds === null) {
			return fail(400, {
				success: false,
				message: `Use whole minutes: focus 1–180, break 1–60, long break 1–120, rounds 1–12.`,
			});
		}
		const control = formData.get('control') === 'anyone' ? 'anyone' : 'crew';

		await upsertSettings(db, params.serverId, {
			focus,
			break: rest,
			longBreak,
			rounds,
			control,
		});
		return { success: true, message: 'Timebox defaults saved.' };
	},

	saveGame: async ({ request, cookies, platform, params }) => {
		if (!cookies.get('discord_user_id')) {
			return fail(401, { success: false, message: 'Not authenticated' });
		}
		const db = (platform as any)?.env?.DB;
		if (!db) return fail(500, { success: false, message: 'Database not available' });

		const formData = await request.formData();
		const L = GAME_LIMITS;
		const agentName = String(formData.get('agentName') || '').trim();
		const crewName = String(formData.get('crewName') || '').trim();
		// Names go into messages members read; keep them plain words.
		const NAME = /^[\p{L}\p{N} '-]+$/u;
		for (const [label, v] of [
			['The hidden role name', agentName],
			['The other role name', crewName],
		] as const) {
			if (v.length < L.name[0] || v.length > L.name[1] || !NAME.test(v)) {
				return fail(400, {
					success: false,
					message: `${label} is ${L.name[0]}–${L.name[1]} characters: letters, numbers, spaces, apostrophes and hyphens.`,
				});
			}
		}
		const minPlayers = whole(formData, 'minPlayers', L.minPlayers);
		const roundSeconds = whole(formData, 'roundSeconds', L.roundSeconds);
		const callLockSeconds = whole(formData, 'callLockSeconds', L.callLockSeconds);
		const meetingSeconds = whole(formData, 'meetingSeconds', L.meetingSeconds);
		const callsPerPlayer = whole(formData, 'callsPerPlayer', L.callsPerPlayer);
		if (
			minPlayers === null ||
			roundSeconds === null ||
			callLockSeconds === null ||
			meetingSeconds === null ||
			callsPerPlayer === null
		) {
			return fail(400, {
				success: false,
				message: `Use whole numbers: players ${L.minPlayers[0]}–${L.minPlayers[1]}, round ${L.roundSeconds[0]}–${L.roundSeconds[1]} seconds, vote lock ${L.callLockSeconds[0]}–${L.callLockSeconds[1]}, vote length ${L.meetingSeconds[0]}–${L.meetingSeconds[1]}, calls ${L.callsPerPlayer[0]}–${L.callsPerPlayer[1]}.`,
			});
		}
		if (callLockSeconds >= roundSeconds) {
			return fail(400, {
				success: false,
				message:
					'The vote lock has to be shorter than the round, or nobody could ever call one.',
			});
		}

		await upsertGameSettings(db, params.serverId, {
			agentName,
			crewName,
			minPlayers,
			roundSeconds,
			callLockSeconds,
			meetingSeconds,
			callsPerPlayer,
			muteOut: formData.get('muteOut') === 'on',
		});
		return { success: true, message: 'Game settings saved. They apply to the next round.' };
	},
};
