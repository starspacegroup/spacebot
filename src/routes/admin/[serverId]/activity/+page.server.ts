import { fail, redirect } from '@sveltejs/kit';
import { log } from '$lib/db/logger.js';
import { getBuiltInCommandsForGuild, setBuiltInCommandOverride } from '$lib/db/commands.js';
import { syncGuildCommands } from '$lib/discord/commands.js';
import { hasFullAdminPermission, verifyGuildAdmin } from '$lib/discord/guilds.js';
import { ACTIVITY_MODULES } from '$lib/server/activity.js';
import { DEFAULTS, getSettings, upsertSettings } from '$lib/server/timebox.js';
import {
	DEFAULTS as GAME_DEFAULTS,
	LIMITS as GAME_LIMITS,
	getSettings as getGameSettings,
	upsertSettings as upsertGameSettings,
} from '$lib/server/game.js';
import {
	DEFAULTS as SHIRITORI_DEFAULTS,
	LIMITS as SHIRITORI_LIMITS,
	chainRecord,
	getHealth as getShiritoriHealth,
	getLeaderboard,
	getSettings as getShiritoriSettings,
	parseWordList,
	resetChain,
	upsertSettings as upsertShiritoriSettings,
} from '$lib/server/shiritori-game.js';
import { discordFor } from '$lib/server/shiritori-api.js';
import { CHANNEL_TYPES, getGuildChannels } from '$lib/db/guild-channels.js';
import { nameOf } from '$lib/server/game.js';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';
import { GAMES, findGame, gameCommands } from '$lib/games/registry.js';
import { loadGameStates, setGameEnabled } from '$lib/server/games-admin.js';
import { getGameDisplays, saveGameDisplay } from '$lib/server/game-display.js';

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
	// Tools are the Activity's modules that are not a game's switch; the games
	// are drawn from the registry, below.
	const asGame = gameCommands();
	const tools = ACTIVITY_MODULES.filter((m) => !asGame.has(m.command)).map((m) => {
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

	const switches = commands.map((c) => ({ name: c.name, enabled: Boolean(c.enabled) }));
	const states = await loadGameStates(db, serverId, switches);
	const displays = await getGameDisplays(db, serverId);
	// `defaults` is the registry's text, for placeholders and Reset; `display` is
	// what members see on this server.
	const games = GAMES.map((g, i) => ({
		...g,
		...states[i],
		defaults: { name: g.name, icon: g.icon, tagline: g.tagline },
		display: displays[g.id],
	}));

	return {
		serverId,
		guild,
		tools,
		games,
		timebox: db
			? await getSettings(db, serverId)
			: { ...DEFAULTS, longBreak: DEFAULTS.longBreak },
		limits: TIMEBOX_LIMITS,
		game: db ? await getGameSettings(db, serverId) : { ...GAME_DEFAULTS },
		gameLimits: GAME_LIMITS,
		shiritori: db ? await getShiritoriSettings(db, serverId) : { ...SHIRITORI_DEFAULTS },
		shiritoriLimits: SHIRITORI_LIMITS,
		shiritoriChannels: db
			? (await getGuildChannels(db, serverId))
					.filter((c) => c.type === CHANNEL_TYPES.TEXT)
					.map((c) => ({ id: c.channelId, name: c.name }))
			: [],
		shiritoriBoard: db ? await shiritoriBoard(db, serverId) : { rows: [], record: 0 },
		shiritoriHealth: db ? await getShiritoriHealth(db, serverId) : null,
	};
}

async function shiritoriBoard(db, serverId: string) {
	const rows = await getLeaderboard(db, serverId, 10);
	return {
		record: await chainRecord(db, serverId),
		rows: await Promise.all(
			rows.map(async (r) => ({
				userId: r.user_id,
				name: await nameOf(db, serverId, r.user_id),
				wordsAdded: r.words_added,
				chainsBroken: r.chains_broken,
				roundsWon: r.rounds_won,
				longestWord: r.longest_word,
			}))
		),
	};
}

/**
 * The caller must be an Administrator (or owner) of this server, or a superadmin.
 * A form action runs without the page's load, so the load's check does not cover
 * it: the cookie alone only says someone is signed in, not that they manage THIS
 * server. Returns a failure to hand back, or null when allowed.
 */
async function denyUnlessAdmin({ cookies, platform, params }) {
	const userId = cookies.get('discord_user_id');
	if (!userId) return fail(401, { success: false, message: 'Not authenticated' });
	if (checkIsSuperAdmin(userId, platform)) return null;
	const checked = await verifyGuildAdmin(
		params.serverId,
		cookies.get('discord_access_token'),
		cookies
	);
	if (!checked.authorized || !hasFullAdminPermission(checked.guild)) {
		return fail(403, {
			success: false,
			message: 'You need Administrator on this server to change this.',
		});
	}
	return null;
}

function whole(formData: FormData, key: string, [min, max]: readonly [number, number]) {
	const n = Number(formData.get(key));
	return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** @type {import('./$types').Actions} */
export const actions = {
	toggleModule: async (event) => {
		const { request, platform, params } = event;
		const denied = await denyUnlessAdmin(event);
		if (denied) return denied;
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

	toggleGame: async (event) => {
		const { request, platform, params } = event;
		const denied = await denyUnlessAdmin(event);
		if (denied) return denied;
		const db = (platform as any)?.env?.DB;
		if (!db) return fail(500, { success: false, message: 'Database not available' });

		const formData = await request.formData();
		const game = findGame(formData.get('game'));
		if (!game) return fail(400, { success: false, message: 'Unknown game.' });
		const enabled = formData.get('enabled') === 'on';

		const result = await setGameEnabled(db, params.serverId, game, enabled);
		if ('message' in result)
			return fail(result.status, { success: false, message: result.message });

		log.info(`[Activity] ${game.name} ${enabled ? 'on' : 'off'} for ${params.serverId}`);
		if (result.sync) await syncGuildCommands(db, params.serverId, (platform as any)?.env);
		const { name } = (await getGameDisplays(db, params.serverId))[game.id];
		return { success: true, message: `${name} is ${enabled ? 'on' : 'off'}.` };
	},

	/** A game's name, icon and description on this server. Empty fields reset. */
	saveGameName: async (event) => {
		const { request, platform, params } = event;
		const denied = await denyUnlessAdmin(event);
		if (denied) return denied;
		const db = (platform as any)?.env?.DB;
		if (!db) return fail(500, { success: false, message: 'Database not available' });

		const formData = await request.formData();
		const game = findGame(formData.get('game'));
		if (!game) return fail(400, { success: false, message: 'Unknown game.' });
		const reset = formData.get('reset') === '1';
		const result = await saveGameDisplay(
			db,
			params.serverId,
			game.id,
			reset
				? {}
				: {
						name: formData.get('name'),
						icon: formData.get('icon'),
						tagline: formData.get('tagline'),
					}
		);
		if ('error' in result)
			return fail(400, { success: false, game: game.id, message: result.error });

		log.info(`[Activity] ${game.id} display name saved for ${params.serverId}`);
		// /play's descriptions carry the names (docs/command-sync.md): push them now.
		await syncGuildCommands(db, params.serverId, (platform as any)?.env);
		return {
			success: true,
			game: game.id,
			message: reset
				? `${game.name} is back to its default name.`
				: `Saved. Members now see ${result.display.name}.`,
		};
	},

	saveTimebox: async (event) => {
		const { request, platform, params } = event;
		const denied = await denyUnlessAdmin(event);
		if (denied) return denied;
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

	saveGame: async (event) => {
		const { request, platform, params } = event;
		const denied = await denyUnlessAdmin(event);
		if (denied) return denied;
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
	saveShiritori: async (event) => {
		const { request, platform, params } = event;
		const denied = await denyUnlessAdmin(event);
		if (denied) return denied;
		const db = (platform as any)?.env?.DB;
		if (!db) return fail(500, { success: false, message: 'Database not available' });

		const formData = await request.formData();
		const turnSeconds = whole(formData, 'turnSeconds', SHIRITORI_LIMITS.turnSeconds);
		if (turnSeconds === null) {
			return fail(400, {
				success: false,
				message: `The turn clock is a whole number of seconds, ${SHIRITORI_LIMITS.turnSeconds[0]}–${SHIRITORI_LIMITS.turnSeconds[1]}.`,
			});
		}

		const chainChannelId = String(formData.get('chainChannelId') || '');
		if (chainChannelId) {
			const known = (await getGuildChannels(db, params.serverId)).some(
				(c) => c.channelId === chainChannelId && c.type === CHANNEL_TYPES.TEXT
			);
			if (!known) {
				return fail(400, { success: false, message: 'Pick a text channel from the list.' });
			}
		}

		// A pool of single letters; an empty or invalid one falls back to the default.
		const letters = [...new Set(String(formData.get('deadLetters') || '').toLowerCase())]
			.filter((l) => /^[a-z]$/.test(l))
			.join('');

		const allowWords = [...parseWordList(String(formData.get('allowWords') || ''))].join('\n');
		const blockWords = [...parseWordList(String(formData.get('blockWords') || ''))].join('\n');
		if (
			allowWords.length > SHIRITORI_LIMITS.wordList ||
			blockWords.length > SHIRITORI_LIMITS.wordList
		) {
			return fail(400, {
				success: false,
				message: `The word lists hold up to ${SHIRITORI_LIMITS.wordList} characters each.`,
			});
		}

		// The game card's switch owns `enabled` now; a form without the field keeps
		// what is stored. A form that sends it (older pages) still sets it.
		const enabled = formData.has('enabled')
			? formData.get('enabled') === 'on'
			: (await getShiritoriSettings(db, params.serverId)).enabled;
		if (enabled && !chainChannelId) {
			// Rounds work without a Chain channel; only the Chain mode needs one.
			log.debug('[Shiritori] Enabled without a Chain channel: rounds only');
		}
		await upsertShiritoriSettings(db, params.serverId, {
			enabled,
			chainChannelId: chainChannelId || null,
			turnSeconds,
			hardMode: formData.get('hardMode') === 'on',
			deadLetters: letters || SHIRITORI_DEFAULTS.deadLetters,
			allowWords,
			blockWords,
		});
		return { success: true, message: 'Shiritori settings saved.' };
	},

	resetShiritoriChain: async (event) => {
		const { platform, params } = event;
		const denied = await denyUnlessAdmin(event);
		if (denied) return denied;
		const db = (platform as any)?.env?.DB;
		if (!db) return fail(500, { success: false, message: 'Database not available' });
		const done = await resetChain(db, discordFor(platform), params.serverId);
		return done
			? { success: true, message: 'The chain was reset.' }
			: fail(400, { success: false, message: 'Pick a Chain channel and save first.' });
	},
};
