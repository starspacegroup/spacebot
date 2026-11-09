/**
 * The text-channel twin of voice-presence.ts: who starts conversations, who starts big
 * ones, and who kills them, plus how each channel is used. Worked out from the
 * MESSAGE_CREATE events the bot logs (kept 90 days), so it covers history.
 *
 * A CONVERSATION is a run of messages in one channel where no gap between neighbours is longer
 * than CONVO_GAP (10 minutes). The first message after a longer quiet starts the next one.
 *
 *  - STARTS CONVERSATIONS: the author of a conversation's first message. Counted, with how many
 *    of those got a reply from someone else.
 *  - STARTS BIG ONES: a start that grew to BIG_CONVO different people. Not "a long one by one
 *    person": it takes four voices.
 *  - KILLS CONVERSATIONS: the last message of a lively conversation (at least two other people
 *    and five messages from others before it) is theirs, and nobody answered it. Silence after
 *    a message is often only the end of the topic, so this is a count and a rate, never a
 *    verdict: a member who is the last word again and again, out of a small share of their
 *    lively chats, stands out; a talkative one who is last once in a while does not.
 *
 * Bots never count. A channel excluded from logging has no events and shows nothing. Reading
 * is capped at MAX_MESSAGES of the newest messages in the window, and says so when it cut.
 */

type Db = any;

export const CONVO_GAP_MS = 10 * 60_000;
export const BIG_CONVO = 4;
/** A conversation is "lively" before a message can kill it: this many others, this many messages. */
export const LIVELY_OTHERS = 2;
export const LIVELY_MESSAGES = 5;
export const MAX_MESSAGES = 30_000;

export interface Person {
	id: string;
	name: string;
	avatar: string | null;
	discriminator: string;
}
export interface TextStarter extends Person {
	starts: number;
	/** Starts that someone else answered. */
	answered: number;
	/** Starts that reached a big conversation. */
	big: number;
	/** The most different people in one of their starts, themselves included. */
	most_people: number;
}
export interface TextKiller extends Person {
	/** Lively conversations that went quiet right after their message. */
	kills: number;
	/** Lively conversations they spoke in at all. */
	lively: number;
}
export interface Convo {
	channel_id: string;
	channel_name: string | null;
	started_at: string;
	starter: Person;
	people: number;
	messages: number;
	minutes: number;
}
export interface ChannelRow {
	channel_id: string;
	channel_name: string | null;
	messages: number;
	conversations: number;
	big: number;
	/** Mean different people per conversation. */
	avg_people: number;
}
export interface TextConversations {
	period: string;
	truncated: boolean;
	thresholds: {
		gap_minutes: number;
		big: number;
		lively_others: number;
		lively_messages: number;
	};
	starters: { leaders: TextStarter[]; recent: Convo[]; total: number };
	big: TextStarter[];
	killers: TextKiller[];
	channels: ChannelRow[];
}

interface Msg {
	user_id: string;
	channel_id: string;
	channel_name: string | null;
	at: number;
	created_at: string;
	name: string | null;
	avatar: string | null;
	discriminator: string | null;
}

const ms = (sql: string) => Date.parse(sql.replace(' ', 'T') + 'Z');

function periodDays(period: string, fallback = 30): number {
	if (period === '24h') return 1;
	const m = typeof period === 'string' ? period.match(/^(\d+)d$/) : null;
	const n = m ? Number.parseInt(m[1], 10) : NaN;
	return Number.isFinite(n) && n >= 1 ? Math.min(n, 90) : fallback;
}

const EMPTY = (period: string, truncated = false): TextConversations => ({
	period,
	truncated,
	thresholds: {
		gap_minutes: CONVO_GAP_MS / 60_000,
		big: BIG_CONVO,
		lively_others: LIVELY_OTHERS,
		lively_messages: LIVELY_MESSAGES,
	},
	starters: { leaders: [], recent: [], total: 0 },
	big: [],
	killers: [],
	channels: [],
});

const who = (m: Msg): Person => ({
	id: m.user_id,
	name: m.name || 'Unknown member',
	avatar: m.avatar,
	discriminator: m.discriminator ?? '0',
});

/**
 * The pure part: messages in, the views out. `from` is where the period begins; a
 * conversation that began before it is skipped, because we cannot see how it started.
 */
export function analyseText(
	msgs: Msg[],
	from: number,
	period: string,
	truncated = false,
	recentLimit = 12,
	leaderLimit = 10
): TextConversations {
	const out = EMPTY(period, truncated);
	const byChannel = new Map<string, Msg[]>();
	for (const m of msgs) {
		if (!byChannel.has(m.channel_id)) byChannel.set(m.channel_id, []);
		byChannel.get(m.channel_id)!.push(m);
	}

	const starters = new Map<string, TextStarter>();
	const killers = new Map<string, TextKiller>();
	const convos: Convo[] = [];
	const channels: ChannelRow[] = [];

	for (const [channelId, list] of byChannel) {
		list.sort((a, b) => a.at - b.at);
		let convoCount = 0;
		let bigCount = 0;
		let peopleSum = 0;
		let name: string | null = null;

		let i = 0;
		while (i < list.length) {
			// one conversation: list[i..j)
			let j = i + 1;
			while (j < list.length && list[j].at - list[j - 1].at <= CONVO_GAP_MS) j++;
			const run = list.slice(i, j);
			const first = run[0];
			const last = run[run.length - 1];
			// The first run in the window may have begun before it: only trust its start when
			// the channel was quiet for a full gap before it.
			const startedInside = first.at >= from && (i > 0 || first.at - from >= CONVO_GAP_MS);
			i = j;
			name = last.channel_name ?? name;
			if (!startedInside) continue;

			const people = new Set(run.map((m) => m.user_id));
			convoCount++;
			peopleSum += people.size;
			const big = people.size >= BIG_CONVO;
			if (big) bigCount++;

			const lead =
				starters.get(first.user_id) ??
				({ ...who(first), starts: 0, answered: 0, big: 0, most_people: 0 } as TextStarter);
			lead.starts++;
			if (people.size > 1) lead.answered++;
			if (big) lead.big++;
			lead.most_people = Math.max(lead.most_people, people.size);
			starters.set(first.user_id, lead);

			convos.push({
				channel_id: channelId,
				channel_name: first.channel_name,
				started_at: first.created_at,
				starter: who(first),
				people: people.size,
				messages: run.length,
				minutes: Math.round((last.at - first.at) / 60_000),
			});

			// who spoke in a lively conversation, and whose message was the last word
			const lively = (upTo: number, by: string) => {
				const others = new Set<string>();
				let n = 0;
				for (let k = 0; k < upTo; k++) {
					if (run[k].user_id !== by) {
						others.add(run[k].user_id);
						n++;
					}
				}
				return others.size >= LIVELY_OTHERS && n >= LIVELY_MESSAGES;
			};
			const spoke = new Set<string>();
			for (let k = 0; k < run.length; k++) {
				const m = run[k];
				if (spoke.has(m.user_id)) continue;
				// lively from this person's point of view the first time they join in
				if (lively(k, m.user_id)) {
					spoke.add(m.user_id);
					const row =
						killers.get(m.user_id) ??
						({ ...who(m), kills: 0, lively: 0 } as TextKiller);
					row.lively++;
					killers.set(m.user_id, row);
				}
			}
			if (lively(run.length - 1, last.user_id)) {
				const row =
					killers.get(last.user_id) ??
					({ ...who(last), kills: 0, lively: 0 } as TextKiller);
				row.kills++;
				if (!spoke.has(last.user_id)) row.lively++;
				killers.set(last.user_id, row);
			}
		}
		channels.push({
			channel_id: channelId,
			channel_name: name,
			messages: list.filter((m) => m.at >= from).length,
			conversations: convoCount,
			big: bigCount,
			avg_people: convoCount ? Math.round((peopleSum / convoCount) * 10) / 10 : 0,
		});
	}

	convos.sort((a, b) => b.started_at.localeCompare(a.started_at));
	const all = [...starters.values()];
	out.starters = {
		leaders: all
			.sort((a, b) => b.starts - a.starts || b.answered - a.answered)
			.slice(0, leaderLimit),
		recent: convos.slice(0, recentLimit),
		total: convos.length,
	};
	out.big = all
		.filter((l) => l.big > 0)
		.sort((a, b) => b.big - a.big || b.most_people - a.most_people)
		.slice(0, leaderLimit);
	out.killers = [...killers.values()]
		.filter((k) => k.kills > 0)
		.sort((a, b) => b.kills - a.kills || b.kills / b.lively - a.kills / a.lively)
		.slice(0, leaderLimit);
	out.channels = channels.sort((a, b) => b.messages - a.messages).slice(0, 25);
	return out;
}

export async function getTextConversations(
	db: Db,
	guildId: string,
	period = '30d'
): Promise<TextConversations> {
	if (!db) return EMPTY(period);
	const days = periodDays(period);
	const { results } = await db
		.prepare(
			`SELECT COALESCE(actor_id, target_id) AS user_id, channel_id, channel_name, created_at,
			        actor_name, actor_avatar, actor_discriminator
			   FROM event_logs
			  WHERE guild_id = ? AND event_type = 'MESSAGE_CREATE'
			    AND COALESCE(actor_is_bot, 0) = 0 AND channel_id IS NOT NULL
			    AND COALESCE(actor_id, target_id) IS NOT NULL
			    AND created_at >= datetime('now', ?)
			  ORDER BY created_at DESC LIMIT ?`
		)
		.bind(guildId, `-${days} days`, MAX_MESSAGES + 1)
		.all();
	let rows = (results || []) as any[];
	const truncated = rows.length > MAX_MESSAGES;
	if (truncated) rows = rows.slice(0, MAX_MESSAGES);
	const msgs: Msg[] = rows.map((r) => ({
		user_id: String(r.user_id),
		channel_id: String(r.channel_id),
		channel_name: r.channel_name ?? null,
		at: ms(r.created_at),
		created_at: r.created_at,
		name: r.actor_name ?? null,
		avatar: r.actor_avatar ?? null,
		discriminator: r.actor_discriminator ?? null,
	}));
	// When the newest messages were cut, the window starts where the cut left off.
	const oldest = msgs.length ? Math.min(...msgs.map((m) => m.at)) : Date.now();
	const from = truncated ? oldest : Date.now() - days * 86_400_000;
	return analyseText(msgs, from, period, truncated);
}
