/**
 * What the Activity's Quorum tab may show a viewer, and the moves it may make.
 *
 * A question lives in a text channel, and a channel can be private, so a
 * question is shown, voted on and answered only for a member who can see its
 * channel (`channel-access.ts`). The viewer's own vote is the one thing the
 * server looks up per person; it is read the way the Discord card reads it, by
 * the voter hash, and nobody else's is ever sent. Moves reuse the engine in
 * quorum.ts, so a vote from the Activity and a vote from the card are the same
 * vote, and the card in the channel is edited to match.
 */

import { getCommandByName } from '../db/commands.js';
import {
	CHOICES,
	DEFAULTS,
	MAX_CLOSES_MINUTES,
	MIN_CLOSES_MINUTES,
	buildQuestionComponents,
	buildQuestionEmbed,
	castVote,
	createQuestion,
	formatDuration,
	getQuestion,
	getSettings,
	parseDuration,
	setQuestionMessage,
	tally,
	voterHash,
	type Choice,
	type Question,
} from './quorum.js';
import { canViewChannel, type GuildRole, type Overwrite } from './channel-access.js';
import type { TokenClaims } from './activity.js';

const DISCORD_API = 'https://discord.com/api/v10';
const QUESTION_MAX = 240;
const OPEN_LIMIT = 25;
const SETTLED_LIMIT = 5;

export class QuorumAccessError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
	}
}

type FetchLike = (url: string, init?: any) => Promise<Response>;

const unix = (iso: string | null) => (iso ? Math.floor(new Date(iso).getTime() / 1000) : null);

export interface QuorumItem {
	id: number;
	question: string;
	channel_id: string;
	channel_name: string | null;
	closes_at: number | null;
	quorum: number;
	yes: number;
	no: number;
	abstain: number;
	total: number;
	reached: boolean;
	my_vote: Choice | null;
	status: Question['status'];
	result: Question['result'];
	asked_by_me: boolean;
}

export interface QuorumView {
	/** The channel a question asked from here would go to: the one the Activity opened in. */
	ask_channel_id: string | null;
	can_ask: boolean;
	min_closes: string;
	max_closes: string;
	default_closes: string;
	open: QuorumItem[];
	settled: QuorumItem[];
}

interface Deps {
	db: any;
	discord: any;
	botToken: string | null;
	fetchImpl?: FetchLike;
}

async function authorize(db: any, claims: TokenClaims, guildId: unknown): Promise<string> {
	if (typeof guildId !== 'string' || !claims.g.includes(guildId)) {
		throw new QuorumAccessError(403, 'That server is not part of this session.');
	}
	if (!(await getCommandByName(db, 'quorum', guildId))) {
		throw new QuorumAccessError(403, 'Quorum is not turned on in this server.');
	}
	return guildId;
}

/**
 * A `canSee(channelId)` for one viewer in one server. Fetches the server's
 * roles and the viewer's member once, and each channel the first time it is asked.
 * Fails closed: anything Discord will not tell us is "cannot see".
 */
function viewerChannels(deps: Deps, guildId: string, userId: string) {
	const f: FetchLike = deps.fetchImpl ?? fetch;
	const auth = { Authorization: `Bot ${deps.botToken}` };
	const get = async (path: string) => {
		if (!deps.botToken) return null;
		const res = await f(`${DISCORD_API}${path}`, { headers: auth });
		return res.ok ? res.json() : null;
	};

	let guild: Promise<{ roles: GuildRole[]; ownerId: string | null } | null> | null = null;
	let member: Promise<string[] | null> | null = null;
	const channels = new Map<string, Promise<any>>();

	const loadGuild = () =>
		(guild ??= get(`/guilds/${guildId}`).then((g) =>
			g ? { roles: g.roles ?? [], ownerId: g.owner_id ?? null } : null
		));
	const loadMember = () =>
		(member ??= get(`/guilds/${guildId}/members/${userId}`).then((m) =>
			m ? (m.roles ?? []) : null
		));
	const loadChannel = (id: string) => {
		let c = channels.get(id);
		if (!c) channels.set(id, (c = get(`/channels/${id}`)));
		return c;
	};

	const info = async (channelId: string) => {
		const [g, roles, ch] = await Promise.all([
			loadGuild(),
			loadMember(),
			loadChannel(channelId),
		]);
		if (!g || !roles || !ch || ch.guild_id !== guildId) return { visible: false, name: null };
		const overwrites: Overwrite[] = ch.permission_overwrites ?? [];
		const visible = canViewChannel({
			guildId,
			ownerId: g.ownerId,
			userId,
			guildRoles: g.roles,
			memberRoles: roles,
			overwrites,
		});
		return { visible, name: (ch.name as string) ?? null };
	};
	return { info };
}

async function itemFor(
	db: any,
	q: Question,
	userId: string,
	name: string | null
): Promise<QuorumItem> {
	const t = tally(q);
	let myVote: Choice | null = null;
	if (q.status === 'open' && q.salt) {
		const hash = await voterHash(q.salt, userId);
		const row = await db
			.prepare(`SELECT choice FROM quorum_votes WHERE question_id = ? AND voter_hash = ?`)
			.bind(q.id, hash)
			.first();
		if (row && CHOICES.includes(row.choice)) myVote = row.choice;
	}
	return {
		id: q.id,
		question: q.question,
		channel_id: q.channel_id,
		channel_name: name,
		closes_at: unix(q.closes_at),
		quorum: q.quorum,
		yes: q.yes_count,
		no: q.no_count,
		abstain: q.abstain_count,
		total: t.total,
		reached: t.reached,
		my_vote: myVote,
		status: q.status,
		result: q.result,
		asked_by_me: q.asker_id === userId,
	};
}

export async function quorumViewForViewer(
	deps: Deps,
	claims: TokenClaims,
	guildId: unknown
): Promise<QuorumView> {
	const gid = await authorize(deps.db, claims, guildId);
	const see = viewerChannels(deps, gid, claims.u);

	const rows = async (sql: string, ...binds: unknown[]) =>
		(
			await deps.db
				.prepare(sql)
				.bind(...binds)
				.all()
		)?.results ?? [];
	const open: Question[] = await rows(
		`SELECT * FROM quorum_questions WHERE guild_id = ? AND status = 'open'
		 ORDER BY closes_at ASC LIMIT ?`,
		gid,
		OPEN_LIMIT
	);
	const settled: Question[] = await rows(
		`SELECT * FROM quorum_questions WHERE guild_id = ? AND status != 'open'
		 ORDER BY closed_at DESC, id DESC LIMIT ?`,
		gid,
		SETTLED_LIMIT * 4
	);

	const keep = async (list: Question[], max: number) => {
		const out: QuorumItem[] = [];
		for (const q of list) {
			if (out.length >= max) break;
			const { visible, name } = await see.info(q.channel_id);
			if (visible) out.push(await itemFor(deps.db, q, claims.u, name));
		}
		return out;
	};

	const askChannel = claims.c ?? null;
	const settings = askChannel ? await getSettings(deps.db, gid, askChannel) : null;
	const canAsk = askChannel ? (await see.info(askChannel)).visible : false;
	return {
		ask_channel_id: canAsk ? askChannel : null,
		can_ask: canAsk,
		min_closes: formatDuration(MIN_CLOSES_MINUTES),
		max_closes: formatDuration(MAX_CLOSES_MINUTES),
		default_closes: formatDuration(settings?.closes_minutes ?? DEFAULTS.closesMinutes),
		open: await keep(open, OPEN_LIMIT),
		settled: await keep(settled, SETTLED_LIMIT),
	};
}

export type QuorumMove =
	| { action: 'vote'; question_id: number; choice: string }
	| { action: 'ask'; question: string; closes?: string };

async function retireOrRefreshCard(discord: any, q: Question) {
	if (!discord || !q.message_id) return;
	await discord.channels
		.editMessage(q.channel_id, q.message_id, {
			embeds: [buildQuestionEmbed(q)],
			components: buildQuestionComponents(q),
			allowed_mentions: { parse: [] },
		})
		.catch(() => {});
}

export async function quorumAct(
	deps: Deps,
	claims: TokenClaims,
	guildId: unknown,
	move: any
): Promise<{ ok: true; id?: number } | { error: string }> {
	const gid = await authorize(deps.db, claims, guildId);
	const see = viewerChannels(deps, gid, claims.u);

	if (move?.action === 'vote') {
		const id = Number(move.question_id);
		if (!Number.isInteger(id)) return { error: 'Unknown question.' };
		if (!CHOICES.includes(move.choice)) return { error: 'Unknown choice.' };
		const q = await getQuestion(deps.db, id);
		// The same answer for "not here" and "not yours to see": no probing ids.
		if (!q || q.guild_id !== gid || !(await see.info(q.channel_id)).visible) {
			return { error: 'That question is gone.' };
		}
		if (q.status !== 'open') return { error: 'Voting has closed on that one.' };
		const fresh = await castVote(deps.db, q, claims.u, move.choice as Choice);
		if (!fresh) return { error: 'Voting has closed on that one.' };
		await retireOrRefreshCard(deps.discord, fresh);
		return { ok: true, id };
	}

	if (move?.action === 'ask') {
		const channelId = claims.c;
		if (!channelId || !(await see.info(channelId)).visible) {
			return { error: 'Open the Activity in a voice channel to ask a question there.' };
		}
		const text = String(move.question ?? '')
			.replace(/\s+/g, ' ')
			.trim();
		if (!text) return { error: 'Ask a question that can be answered yes or no.' };
		if (text.length > QUESTION_MAX) {
			return { error: `Keep it under ${QUESTION_MAX} characters.` };
		}
		const settings = await getSettings(deps.db, gid, channelId);
		let closesMinutes = settings.closes_minutes;
		if (move.closes !== undefined && String(move.closes).trim() !== '') {
			const parsed = parseDuration(move.closes);
			if (parsed === null) return { error: 'Closes looks like 24h, 90m or 2d.' };
			closesMinutes = parsed;
		}
		if (closesMinutes < MIN_CLOSES_MINUTES || closesMinutes > MAX_CLOSES_MINUTES) {
			return {
				error: `A question stays open between ${formatDuration(MIN_CLOSES_MINUTES)} and ${formatDuration(MAX_CLOSES_MINUTES)}.`,
			};
		}
		if (!deps.discord) return { error: 'The bot is not connected right now.' };

		const q = await createQuestion(deps.db, {
			guild_id: gid,
			channel_id: channelId,
			asker_id: claims.u,
			question: text,
			class: null,
			quorum: settings.quorum,
			closes_minutes: closesMinutes,
			due_minutes: DEFAULTS.dueMinutes,
			owner_kind: 'user',
			owner_id: claims.u,
		});
		try {
			const msg = await deps.discord.channels.send(channelId, {
				embeds: [buildQuestionEmbed(q)],
				components: buildQuestionComponents(q),
				allowed_mentions: { parse: [] },
			});
			if (msg?.id) {
				await setQuestionMessage(deps.db, q.id, msg.id);
				await deps.discord.channels
					.pin(channelId, msg.id, `Quorum question #${q.id}`)
					.catch(() => {});
			}
		} catch {
			// No card, no question: nobody can vote on one they cannot see.
			await deps.db.prepare(`DELETE FROM quorum_questions WHERE id = ?`).bind(q.id).run();
			return { error: "I couldn't post the question in this channel." };
		}
		return { ok: true, id: q.id };
	}

	return { error: 'Unknown move.' };
}
