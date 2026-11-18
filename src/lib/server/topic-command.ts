/**
 * /topic: a conversation starter, off until a server turns it on from Commands.
 *
 *   /topic new [kind]                      a random topic, posted for the channel
 *   /topic settings set_voice_status:true custom_only:true   (Manage Server)
 *   /topic add text:...   /topic remove number:3   /topic list   (Manage Server): the server's own list
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

/** How many topics of its own a server may keep. */
export const MAX_CUSTOM_TOPICS = 200;
export const MAX_TOPIC_LENGTH = 200;

export async function getTopicSettings(db: Db, guildId: string) {
	const row = await db
		.prepare(
			`SELECT set_voice_status, custom_only, last_topic FROM topic_settings WHERE guild_id = ?`
		)
		.bind(guildId)
		.first();
	return {
		setVoiceStatus: row?.set_voice_status === 1,
		customOnly: row?.custom_only === 1,
		lastTopic: row?.last_topic ?? null,
	};
}

const flag = (v: boolean | undefined) => (v === undefined ? null : v ? 1 : 0);

async function save(
	db: Db,
	guildId: string,
	patch: { setVoiceStatus?: boolean; customOnly?: boolean; last?: string }
) {
	await db
		.prepare(
			`INSERT INTO topic_settings (guild_id, set_voice_status, custom_only, last_topic)
			 VALUES (?, COALESCE(?, 0), COALESCE(?, 0), ?)
			 ON CONFLICT(guild_id) DO UPDATE SET
			   set_voice_status = COALESCE(?, set_voice_status),
			   custom_only = COALESCE(?, custom_only),
			   last_topic = COALESCE(?, last_topic),
			   updated_at = datetime('now')`
		)
		.bind(
			guildId,
			flag(patch.setVoiceStatus),
			flag(patch.customOnly),
			patch.last ?? null,
			flag(patch.setVoiceStatus),
			flag(patch.customOnly),
			patch.last ?? null
		)
		.run();
}

async function ownTopics(db: Db, guildId: string): Promise<{ id: number; text: string }[]> {
	const { results } = await db
		.prepare(`SELECT id, text FROM topic_custom WHERE guild_id = ? ORDER BY id LIMIT ?`)
		.bind(guildId, MAX_CUSTOM_TOPICS)
		.all();
	return results ?? [];
}

/** One line, no pings, no markdown that breaks the bold wrapper. */
export function cleanTopic(raw: unknown): string {
	return String(raw ?? '')
		.replace(/\s+/g, ' ')
		.replace(/\*\*/g, '')
		.trim()
		.slice(0, MAX_TOPIC_LENGTH);
}

/** The voice channel the member is in, from the live voice table. */
async function voiceChannelOf(db: Db, guildId: string, userId: string) {
	const row = await db
		.prepare(`SELECT channel_id FROM live_voice_states WHERE guild_id = ? AND user_id = ?`)
		.bind(guildId, userId)
		.first();
	return row?.channel_id ? String(row.channel_id) : null;
}

async function manage(
	name: string,
	opts: Map<string, any>,
	ctx: { db: Db; guildId: string; userId: string }
) {
	const { db, guildId, userId } = ctx;
	if (name === 'settings') {
		const patch: { setVoiceStatus?: boolean; customOnly?: boolean } = {};
		if (typeof opts.get('set_voice_status') === 'boolean')
			patch.setVoiceStatus = opts.get('set_voice_status');
		if (typeof opts.get('custom_only') === 'boolean')
			patch.customOnly = opts.get('custom_only');
		if (Object.keys(patch).length) await save(db, guildId, patch);
		const now = await getTopicSettings(db, guildId);
		const count = (await ownTopics(db, guildId)).length;
		return say(
			`Voice channel status: **${now.setVoiceStatus ? 'on' : 'off'}**` +
				(now.setVoiceStatus
					? ' (in a voice channel’s chat, by someone in it; SpaceBot needs **Set Voice Channel Status** there)'
					: '') +
				`\nTopics: **${now.customOnly ? 'only this server’s own' : 'built-in plus this server’s own'}** (${count} of your own${now.customOnly && !count ? ', so the built-in list is used until you add some' : ''}).`
		);
	}
	if (name === 'add') {
		const text = cleanTopic(opts.get('text'));
		if (!text) return say('Give me some text for the topic.');
		const have = await ownTopics(db, guildId);
		if (have.length >= MAX_CUSTOM_TOPICS) {
			return say(`A server can keep ${MAX_CUSTOM_TOPICS} topics. Remove one first.`);
		}
		if (have.some((t) => t.text.toLowerCase() === text.toLowerCase())) {
			return say('That topic is already on your list.');
		}
		const added: any = await db
			.prepare(`INSERT INTO topic_custom (guild_id, text, added_by) VALUES (?, ?, ?)`)
			.bind(guildId, text, userId)
			.run();
		return say(`Added #${added?.meta?.last_row_id}: ${text}\nYou have ${have.length + 1}.`);
	}
	if (name === 'remove') {
		const id = Number(opts.get('number'));
		const gone: any = await db
			.prepare(`DELETE FROM topic_custom WHERE id = ? AND guild_id = ?`)
			.bind(id, guildId)
			.run();
		return say(
			gone?.meta?.changes ? `Removed #${id}.` : `There is no topic #${id} on your list.`
		);
	}
	// list
	const rows = await ownTopics(db, guildId);
	if (!rows.length)
		return say('Your server has no topics of its own yet. Add one with `/topic add`.');
	const lines = rows.map((t) => `#${t.id} ${t.text}`);
	let out = '';
	for (const l of lines) {
		if (out.length + l.length + 1 > 1900) {
			out += `\n…and ${lines.length - out.split('\n').length} more`;
			break;
		}
		out += (out ? '\n' : '') + l;
	}
	return say(out);
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

	if (['settings', 'add', 'remove', 'list'].includes(sub?.name)) {
		if (!mayManage(body.member?.permissions)) {
			return say('Only people with Manage Server can change /topic.');
		}
		return manage(sub.name, opts, { db, guildId, userId });
	}

	const settings = await getTopicSettings(db, guildId);
	const own = (await ownTopics(db, guildId)).map((t) => t.text);
	const topic = pickTopic(opts.get('kind'), settings.lastTopic, random, own, settings.customOnly);
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
