import { fail, redirect } from '@sveltejs/kit';
import { log } from '$lib/db/logger.js';
import {
	createChannelPreset,
	deleteChannelPreset,
	listActiveManagedChannels,
	listChannelPresets,
	updateChannelPreset,
} from '$lib/db/managed-channels.js';
import {
	CHANNEL_TYPE_TEXT,
	CHANNEL_TYPE_VOICE,
	LIFETIME_MODES,
	PERMISSION_FLAGS,
	ROOM_VERBS,
	sanitizeOwnerPermissions,
} from '$lib/discord/managed-channel-policy.js';
import { hasFullAdminPermission } from '$lib/discord/guilds.js';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';

/** Permission names a preset may grant, minus the ones an owner can never hold. */
const GRANTABLE_PERMISSIONS = Object.keys(PERMISSION_FLAGS);

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

	// Presets decide who may create channels and what they may do to them —
	// that is server configuration, so it needs full admin, like API keys.
	const hasFullAdminAccess = isSuperAdmin || hasFullAdminPermission(guild);
	if (!hasFullAdminAccess) throw redirect(302, `/admin/${serverId}`);

	const db = (platform as any)?.env?.DB;
	const [presets, rooms] = db
		? await Promise.all([
				listChannelPresets(db, serverId),
				listActiveManagedChannels(db, serverId),
			])
		: [[], []];

	return {
		serverId,
		guild,
		presets,
		rooms,
		verbs: ROOM_VERBS,
		permissions: GRANTABLE_PERMISSIONS,
		lifetimeModes: LIFETIME_MODES,
		channelTypes: { text: CHANNEL_TYPE_TEXT, voice: CHANNEL_TYPE_VOICE },
	};
}

/** Read one preset's fields out of a submitted form. */
function readPresetForm(formData: FormData) {
	const number = (key: string, fallback: number | null = null) => {
		const raw = formData.get(key);
		if (raw === null || String(raw).trim() === '') return fallback;
		const parsed = Number(raw);
		return Number.isFinite(parsed) ? parsed : fallback;
	};

	const list = (key: string) => formData.getAll(key).map((value) => String(value));

	return {
		name: String(formData.get('name') || '').trim(),
		enabled: formData.get('enabled') === 'on',
		channel_type: number('channel_type', CHANNEL_TYPE_VOICE),
		parent_id: String(formData.get('parent_id') || '').trim() || null,
		name_pattern: String(formData.get('name_pattern') || '').trim() || "{user.name}'s room",
		default_user_limit: number('default_user_limit'),
		lobby_channel_id: String(formData.get('lobby_channel_id') || '').trim() || null,
		allow_role_ids: list('allow_role_ids'),
		deny_role_ids: list('deny_role_ids'),
		lifetime_mode: String(formData.get('lifetime_mode') || 'idle'),
		ttl_minutes: number('ttl_minutes', 120),
		idle_minutes: number('idle_minutes', 15),
		grace_minutes: number('grace_minutes', 5),
		extend_minutes: number('extend_minutes', 30),
		max_extensions: number('max_extensions', 2),
		max_per_user: number('max_per_user', 1),
		max_per_guild: number('max_per_guild', 25),
		max_renames: number('max_renames', 2),
		owner_can: list('owner_can').filter((verb) => ROOM_VERBS.includes(verb as any)),
		// Strip anything that would put the room beyond the bot's control even if
		// the form is tampered with.
		owner_allow: sanitizeOwnerPermissions(list('owner_allow')),
		everyone_deny: list('everyone_deny').filter((name) => name in PERMISSION_FLAGS),
	};
}

function validatePreset(preset: ReturnType<typeof readPresetForm>) {
	if (!preset.name) return 'Give the preset a name.';
	if (!LIFETIME_MODES.includes(preset.lifetime_mode as any)) return 'Pick a lifetime mode.';
	if (![CHANNEL_TYPE_TEXT, CHANNEL_TYPE_VOICE].includes(preset.channel_type as any)) {
		return 'Rooms can be voice or text channels.';
	}
	if (preset.channel_type === CHANNEL_TYPE_TEXT && preset.lobby_channel_id) {
		return 'A join-to-create lobby only makes sense for voice rooms.';
	}
	return null;
}

/** @type {import('./$types').Actions} */
export const actions = {
	createPreset: async ({ request, cookies, platform, params }) => {
		if (!cookies.get('discord_user_id')) {
			return fail(401, { success: false, message: 'Not authenticated' });
		}
		const db = (platform as any)?.env?.DB;
		if (!db) return fail(500, { success: false, message: 'Database not available' });

		const preset = readPresetForm(await request.formData());
		const problem = validatePreset(preset);
		if (problem) return fail(400, { success: false, message: problem });

		const result = await createChannelPreset(db, params.serverId, preset);
		if (!result.success) {
			// The one unique constraint here is the lobby channel.
			const message = /UNIQUE/i.test(result.error || '')
				? 'That lobby channel already drives another preset.'
				: result.error;
			return fail(400, { success: false, message });
		}

		log.info(`[Rooms] Preset created for ${params.serverId}: ${preset.name}`);
		return { success: true, message: `Saved “${preset.name}”.` };
	},

	updatePreset: async ({ request, cookies, platform, params }) => {
		if (!cookies.get('discord_user_id')) {
			return fail(401, { success: false, message: 'Not authenticated' });
		}
		const db = (platform as any)?.env?.DB;
		if (!db) return fail(500, { success: false, message: 'Database not available' });

		const formData = await request.formData();
		const presetId = Number(formData.get('presetId'));
		if (!presetId) return fail(400, { success: false, message: 'Missing preset' });

		const preset = readPresetForm(formData);
		const problem = validatePreset(preset);
		if (problem) return fail(400, { success: false, message: problem });

		const result = await updateChannelPreset(db, params.serverId, presetId, preset);
		if (!result.success) {
			const message = /UNIQUE/i.test(result.error || '')
				? 'That lobby channel already drives another preset.'
				: result.error;
			return fail(400, { success: false, message });
		}

		return { success: true, message: `Saved “${preset.name}”.` };
	},

	deletePreset: async ({ request, cookies, platform, params }) => {
		if (!cookies.get('discord_user_id')) {
			return fail(401, { success: false, message: 'Not authenticated' });
		}
		const db = (platform as any)?.env?.DB;
		if (!db) return fail(500, { success: false, message: 'Database not available' });

		const formData = await request.formData();
		const presetId = Number(formData.get('presetId'));
		if (!presetId) return fail(400, { success: false, message: 'Missing preset' });

		const result = await deleteChannelPreset(db, params.serverId, presetId);
		if (!result.success) return fail(400, { success: false, message: result.error });

		// Rooms already open keep running; their preset_id is nulled by the
		// schema and they fall back to the reaper's defaults.
		return { success: true, message: 'Preset deleted. Open rooms keep running.' };
	},
};
