import { redirect } from '@sveltejs/kit';
import { log } from '$lib/db/logger.js';
import { getLiveVoiceChannels } from '$lib/db/live-voice.js';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';
import { LIVE_UPDATE_TOKEN_TTL_SECONDS, signLiveUpdateAccess } from '$lib/live-updates.js';
import {
	getVoiceActivityLogPage,
	getVoiceEventTypeOptions,
	parseVoiceActivityQuery,
} from '$lib/server/voice-activity-log.js';

function getEnv(platform, name) {
	return (
		platform?.env?.[name] ?? (typeof process !== 'undefined' ? process.env?.[name] : undefined)
	);
}

/** @type {import('./$types').PageServerLoad} */
export async function load({ params, cookies, platform, parent, url }) {
	const { serverId } = params;

	if (!/^\d{17,20}$/.test(serverId)) {
		throw redirect(302, '/admin');
	}

	const parentData = await parent();

	if (!parentData.isLoggedIn || !parentData.user) {
		throw redirect(302, '/login');
	}

	const userId = cookies.get('discord_user_id');
	const isSuperAdmin = checkIsSuperAdmin(userId, platform);
	const adminGuilds = parentData.adminGuilds || [];

	const hasAccessToServer = isSuperAdmin || adminGuilds.some((g) => g.id === serverId);
	if (!hasAccessToServer) {
		throw redirect(302, '/admin');
	}

	const guild = adminGuilds.find((g) => g.id === serverId);
	const db = (platform as any)?.env?.DB;

	let liveVoiceSnapshot = null;
	let voiceActivityLog = [];
	let voiceActivityPagination = null;
	let liveUpdatesAuth = null;
	const voiceActivityQuery = parseVoiceActivityQuery(url.searchParams);

	if (db) {
		try {
			liveVoiceSnapshot = await getLiveVoiceChannels(db, serverId);
		} catch (error) {
			log.warn(`[LiveVoice] Failed to fetch snapshot for ${serverId}:`, error);
		}

		try {
			const logPage = await getVoiceActivityLogPage(db, serverId, voiceActivityQuery);
			voiceActivityLog = logPage.entries;
			voiceActivityPagination = logPage.pagination;
		} catch (error) {
			log.warn(`[LiveVoice] Failed to fetch voice activity log for ${serverId}:`, error);
		}
	}

	const liveUpdateSecret =
		getEnv(platform, 'INTERNAL_API_KEY') || getEnv(platform, 'DISCORD_BOT_TOKEN');
	const liveUpdateUserId = userId || parentData.user?.id;
	if (liveUpdateSecret && liveUpdateUserId) {
		const expiresAt = Math.floor(Date.now() / 1000) + LIVE_UPDATE_TOKEN_TTL_SECONDS;
		liveUpdatesAuth = {
			userId: liveUpdateUserId,
			expiresAt,
			signature: await signLiveUpdateAccess(
				serverId,
				liveUpdateUserId,
				expiresAt,
				liveUpdateSecret
			),
		};
	}

	return {
		serverId,
		guild,
		liveVoiceSnapshot,
		voiceActivityLog,
		voiceActivityPagination,
		voiceEventTypeOptions: getVoiceEventTypeOptions(),
		voiceActivityFilters: {
			search: voiceActivityQuery.search,
			eventType: voiceActivityQuery.eventType,
			sortOrder: voiceActivityQuery.sortOrder,
			startDate: voiceActivityQuery.rawStartDate,
			endDate: voiceActivityQuery.rawEndDate,
		},
		liveUpdatesAuth,
		user: parentData.user,
	};
}
