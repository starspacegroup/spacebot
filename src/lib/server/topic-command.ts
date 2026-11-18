/**
 * /topic: a conversation starter, off until a server turns it on from Commands.
 *
 *   /topic new [kind]                      a random topic, posted for the channel
 *   /topic settings set_voice_status:true  (Manage Server) ...
 *
 * When the server has turned `set_voice_status` on, and the command is used in a voice channel's
 * own chat by someone who is in that voice channel, the topic is also set as that channel's voice
 * status. Anyone elsewhere, or not in the channel, just gets the topic.
 */

import { getCommandByName } from '../db/commands.js';
import { log } from '../log.js';
import { pickTopic } from './topics.js';

type Db = any;

const RESPOND_MESSAGE = 4;
const EPHEMERAL = 64;
const ADMINISTRATOR = 1n << 3n;
const MANAGE_GUILD = 1n << 5n;
const NO_MENTIONS = { parse: [] as string[] };

const say = (content: string) => ({
	type: RESPOND_MESSAGE,
	data: { content, flags: EPHEMERAL, allowed_mentions: NO_MENTIONS },
});

function mayManage(permissions: unknown): boolean {
	try {
		const bits = BigInt(String(permissions ?? '0'));
		return (bits & ADMINISTRATOR) === ADMINISTRATOR || (bits & MANAGE_GUILD) === MANAGE_GUILD;
	} catch {
		return false;
	}
}

export async function getTopicSettings(db: Db, guildId: string) {
	const row = await db
		.prepare(`SELECT set_voice_status, last_topic FROM topic_settings WHERE guild_id = ?`)
		.bind(guildId)
		.first();
	return { setVoiceStatus: row?.set_voice_status === 1, lastTopic: row?.last_topic ?? null };
}

async function save(db: Db, guildId: string, patch: { setVoiceStatus?: boolean; last?: string }) {
	await db
		.prepare(
			`INSERT INTO topic_settings (guild_id, set_voice_status, last_topic)
			 VALUES (?, ?, ?)
			 ON CONFLICT(guild_id) DO UPDATE SET
			   set_voice_status = COALESCE(?, set_voice_status),
			   last_topic = COALESCE(?, last_topic),
			   updated_at = datetime('now')`
		)
		.bind(
			guildId,
			patch.setVoiceStatus ? 1 : 0,
			patch.last ?? null,
			patch.setVoiceStatus === undefined ? null : patch.setVoiceStatus ? 1 : 0,
			patch.last ?? null
		)
		.run();
}

/** The voice channel the member is in, from the live voice table. */
async function voiceChannelOf(db: Db, guildId: string, userId: string) {
	const row = await db
		.prepare(`SELECT channel_id FROM live_voice_states WHERE guild_id = ? AND user_id = ?`)
		.bind(guildId, userId)
		.first();
	return row?.channel_id ? String(row.channel_id) : null;
}

export async function handleTopicCommand(
	body: any,
	db: Db,
	discord: any,
	random: () => number = Math.random
) {
	const guildId: string | undefined = body.guild_id;
	const channelId: string | undefined = body.channel_id;
	const userId: string | undefined = body.member?.user?.id;
	if (!guildId || !channelId || !userId) return say('/topic only works inside a server.');
	if (!db) return say('The database is not available right now.');
	// Discord only lists the command where it is on; this is the same check at the point of use.
	if (!(await getCommandByName(db, 'topic', guildId))) {
		return say('/topic is not turned on in this server.');
	}

	const sub = (body.data?.options ?? [])[0];
	const opts = new Map<string, any>((sub?.options ?? []).map((o: any) => [o.name, o.value]));

	if (sub?.name === 'settings') {
		if (!mayManage(body.member?.permissions)) {
			return say('Only people with Manage Server can change /topic options.');
		}
		const on = opts.get('set_voice_status') === true;
		await save(db, guildId, { setVoiceStatus: on });
		return say(
			on
				? 'On. When someone in a voice channel uses /topic in that channel’s chat, the topic also becomes the channel’s voice status. SpaceBot needs the **Set Voice Channel Status** permission there.'
				: 'Off. /topic only posts the topic.'
		);
	}

	const settings = await getTopicSettings(db, guildId);
	const topic = pickTopic(opts.get('kind'), settings.lastTopic, random);
	await save(db, guildId, { last: topic });

	// A voice channel's chat has the same id as the voice channel, so "used in the chat of the
	// voice channel I am in" is: my voice channel is this channel.
	let note = '';
	if (settings.setVoiceStatus && discord?.channels?.setVoiceStatus) {
		const inChannel = (await voiceChannelOf(db, guildId, userId)) === channelId;
		if (inChannel) {
			try {
				await discord.channels.setVoiceStatus(channelId, topic, 'Set by /topic');
				note = '\n-# Set as this voice channel’s status.';
			} catch (error: any) {
				log.warn(`[Topic] Could not set the voice status: ${error?.message}`);
				note =
					error?.status === 403
						? '\n-# I could not set the voice status: I need the Set Voice Channel Status permission.'
						: '\n-# I could not set the voice status just now.';
			}
		}
	}

	return {
		type: RESPOND_MESSAGE,
		data: { content: `💬 **${topic}**${note}`, allowed_mentions: NO_MENTIONS },
	};
}
