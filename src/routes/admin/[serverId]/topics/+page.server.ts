import { fail, redirect } from '@sveltejs/kit';
import { getBuiltInCommandsForGuild } from '$lib/db/commands.js';
import { CHANNEL_TYPES, getGuildChannels } from '$lib/db/guild-channels.js';
import { log } from '$lib/db/logger.js';
import { verifyGuildAdmin } from '$lib/discord/guilds.js';
import { createDiscordRestClient } from '$lib/discord/rest-client.js';
import { setCommandEnabled } from '$lib/server/control-actions.js';
import {
	MAX_CUSTOM_TOPICS,
	MAX_TOPIC_LENGTH,
	addOwnTopic,
	getTopicSettings,
	listOwnTopics,
	removeOwnTopic,
	saveTopicSettings,
	setVoiceStatusByHand,
} from '$lib/server/topic-command.js';

const VOICE_TYPES = new Set<number>([CHANNEL_TYPES.VOICE, CHANNEL_TYPES.STAGE]);

/** @type {import('./$types').PageServerLoad} */
export async function load({ platform, parent, params }) {
	if (!/^\d{17,20}$/.test(params.serverId)) throw redirect(302, '/admin');
	const parentData = await parent();
	const guildId = params.serverId;
	if (!parentData.adminGuilds?.some((g) => g.id === guildId) && !parentData.isSuperAdmin) {
		throw redirect(302, '/admin');
	}

	const db = (platform as any)?.env?.DB;
	if (!db) {
		return {
			serverId: guildId,
			available: false,
			enabled: false,
			commandId: null,
			settings: { setVoiceStatus: false, customOnly: false },
			topics: [],
			voiceChannels: [],
			limits: { topics: MAX_CUSTOM_TOPICS, length: MAX_TOPIC_LENGTH },
		};
	}

	const [builtIns, settings, topics, channels] = await Promise.all([
		getBuiltInCommandsForGuild(db, guildId),
		getTopicSettings(db, guildId),
		listOwnTopics(db, guildId),
		getGuildChannels(db, guildId),
	]);
	const command = builtIns.find((c) => c.name === 'topic');

	return {
		serverId: guildId,
		available: Boolean(command),
		enabled: Boolean(command?.enabled),
		commandId: command?.id ?? null,
		settings: { setVoiceStatus: settings.setVoiceStatus, customOnly: settings.customOnly },
		topics,
		voiceChannels: channels
			.filter((c) => VOICE_TYPES.has(c.type))
			.map((c) => ({ id: c.channelId, name: c.name, parent: c.parentName ?? null })),
		limits: { topics: MAX_CUSTOM_TOPICS, length: MAX_TOPIC_LENGTH },
	};
}

/**
 * Every write here needs Manage Server on this server, checked against Discord, not just a
 * sign-in: the same bar as `/topic` itself.
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
	/** Turn /topic on or off for this server (the command registers or leaves Discord). */
	enable: async (event) => {
		const g: any = await guard(event);
		if (g.error) return g.error;
		const form = await event.request.formData();
		const commandId = Number(form.get('command_id'));
		const enabled = form.get('enabled') === 'on';
		const r = await setCommandEnabled(g.db, g.env, event.params.serverId, commandId, enabled);
		if (!r.ok) return fail(r.status || 500, { error: r.error });
		return { success: true, message: enabled ? '/topic is on.' : '/topic is off.' };
	},

	options: async (event) => {
		const g: any = await guard(event);
		if (g.error) return g.error;
		const form = await event.request.formData();
		await saveTopicSettings(g.db, event.params.serverId, {
			setVoiceStatus: form.get('set_voice_status') === 'on',
			customOnly: form.get('custom_only') === 'on',
		});
		return { success: true, message: 'Saved.' };
	},

	add: async (event) => {
		const g: any = await guard(event);
		if (g.error) return g.error;
		const form = await event.request.formData();
		const r = await addOwnTopic(g.db, event.params.serverId, g.userId, form.get('text'));
		if (!r.ok) return fail(400, { error: r.error });
		return { success: true, message: `Added: ${r.text}` };
	},

	remove: async (event) => {
		const g: any = await guard(event);
		if (g.error) return g.error;
		const form = await event.request.formData();
		const gone = await removeOwnTopic(g.db, event.params.serverId, Number(form.get('id')));
		return gone
			? { success: true, message: 'Removed.' }
			: fail(404, { error: 'That topic is already gone.' });
	},

	/** Set or clear a voice channel's status by hand, on the bot's own authority. */
	voice: async (event) => {
		const g: any = await guard(event);
		if (g.error) return g.error;
		const form = await event.request.formData();
		const channelId = String(form.get('channel_id') || '');
		const mode = form.get('mode') === 'clear' ? 'clear' : 'set';

		// The channel must be one this server has, taken from its own synced list: the id is
		// never trusted from the form on its own.
		const channels = await getGuildChannels(g.db, event.params.serverId);
		const channel = channels.find((c) => c.channelId === channelId);
		if (!channel || !VOICE_TYPES.has(channel.type))
			return fail(400, { error: 'Pick one of this server’s voice channels.' });

		const token = g.env?.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;
		const r = await setVoiceStatusByHand(
			g.db,
			token ? createDiscordRestClient(token) : null,
			event.params.serverId,
			{ id: channel.channelId, type: channel.type },
			mode,
			form.get('text')
		);
		if (!r.ok) return fail(502, { error: r.error });
		log.info(
			`[Topic] ${g.userId} ${mode} the status of ${channelId} in ${event.params.serverId}`
		);
		return {
			success: true,
			message:
				mode === 'set' ? `Set #${channel.name} to: ${r.text}` : `Cleared #${channel.name}.`,
		};
	},
};
