/**
 * Shiritori — the game around the rules in shiritori.ts. Plan:
 * planning/SHIRITORI_PLAN.md, docs/shiritori.md.
 *
 * Two modes share one dictionary and one judge:
 *
 *  - **Chain**: a channel a server marks as the Shiritori channel. Anyone posts
 *    the next word; a good word gets a ✅ and a bad one a ❌ and breaks the chain. A word counts only when
 *    the message mentions the bot ("@SpaceBot apple"), so the channel can also hold chat.
 *  - **Round**: `/game shiritori` opens a lobby in the channel; players take
 *    turns against a clock, and a miss puts you out. The last one in wins.
 *
 * Words reach this module as a message the gateway forwards (`handleMessage`),
 * and the clock reaches it as a tick (`tickRounds`) or the minute sweep. All
 * state is D1 and every transition is a guarded write, so two messages that race
 * cannot both count. Discord is only ever written to through the REST client.
 */

import { log } from '../log.js';
import { getGameDisplay } from './game-display.js';
import { PERMISSION_FLAGS, getCommandByName } from '../db/commands.js';
import { getGuildSettings } from '../db/settings.js';
import { memberHasCommandPermission } from '../discord/command-permissions.js';
import { flattenInteractionOptions } from '../discord/interaction-options.js';
import { RESPOND_MESSAGE, RESPOND_UPDATE, isCrew } from './game.js';
import { consumeQuota } from './rate-limit.js';
import { lookupDefinition, lookupSimilar } from './word-commands.js';
import { voiceChannelOf } from './timebox.js';
import {
	DEAD_LETTERS,
	MIN_WORD_LENGTH,
	drawDeadLetter,
	judgeMove,
	lemmaOf,
	requiredStart,
	wordToken,
	type MoveCode,
} from './shiritori.js';
import { isBlocked as baseBlocked, isWord as baseWord, seedWord } from './shiritori-dict.js';

const EPHEMERAL = 64;
type Db = any;
type Discord = any;

// --- settings -----------------------------------------------------------------

export const DEFAULTS = {
	enabled: false,
	chainChannelId: null as string | null,
	turnSeconds: 15,
	hardMode: false,
	deadLetters: DEAD_LETTERS.join(''),
	allowWords: '',
	blockWords: '',
};

export const LIMITS = {
	turnSeconds: [5, 60],
	wordList: 4000,
} as const;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 12;
/** The clock never runs below this, however many laps a round has had. */
export const MIN_TURN_SECONDS = 5;
/** A lobby nobody starts is closed after this long. */
export const LOBBY_TTL_MS = 30 * 60 * 1000;
/** The gateway learns of a new round by polling, so the first turn gets this much extra. */
export const START_GRACE_SECONDS = 10;
/**
 * In a voice chat, a player who is not in the call is skipped at once, and put out
 * if they are still gone after this long. A reconnect inside it costs nothing.
 */
export const AWAY_GRACE_MS = 20_000;
/** A turn is not timed out until it is this far past its deadline, for message latency. */
export const TURN_SLACK_MS = 2000;
/** Word rows of a finished game are pruned after this long; the summaries stay. */
export const WORD_RETENTION_DAYS = 90;

export type Settings = typeof DEFAULTS;

export async function getSettings(db: Db, guildId: string): Promise<Settings> {
	const row = await db
		.prepare(`SELECT * FROM shiritori_settings WHERE guild_id = ?`)
		.bind(guildId)
		.first();
	if (!row) return { ...DEFAULTS };
	return {
		enabled: Boolean(row.enabled),
		chainChannelId: row.chain_channel_id ?? null,
		turnSeconds: row.turn_seconds ?? DEFAULTS.turnSeconds,
		hardMode: Boolean(row.hard_mode),
		deadLetters: row.dead_letters || DEFAULTS.deadLetters,
		allowWords: row.allow_words ?? '',
		blockWords: row.block_words ?? '',
	};
}

export async function upsertSettings(db: Db, guildId: string, s: Settings) {
	await db
		.prepare(
			`INSERT INTO shiritori_settings
			   (guild_id, enabled, chain_channel_id, turn_seconds, hard_mode, dead_letters,
			    allow_words, block_words, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
			 ON CONFLICT(guild_id) DO UPDATE SET
			   enabled = excluded.enabled, chain_channel_id = excluded.chain_channel_id,
			   turn_seconds = excluded.turn_seconds, hard_mode = excluded.hard_mode,
			   dead_letters = excluded.dead_letters, allow_words = excluded.allow_words,
			   block_words = excluded.block_words, updated_at = datetime('now'),
			   last_error = NULL, last_error_at = NULL`
		)
		.bind(
			guildId,
			s.enabled ? 1 : 0,
			s.chainChannelId,
			s.turnSeconds,
			s.hardMode ? 1 : 0,
			s.deadLetters,
			s.allowWords,
			s.blockWords
		)
		.run();
}

/** One word per line (commas and spaces work too): lower-case a-z, three letters or more. */
export function parseWordList(text: string): Set<string> {
	const out = new Set<string>();
	for (const raw of text.split(/[\s,]+/)) {
		const w = raw.trim().toLowerCase();
		if (/^[a-z]+$/.test(w) && w.length >= MIN_WORD_LENGTH) out.add(w);
	}
	return out;
}

/** The server's view of the dictionary: the base list plus its allow and block lists. */
export function guildDictionary(s: Settings) {
	const allow = parseWordList(s.allowWords);
	const block = parseWordList(s.blockWords);
	const isWord = (w: string) => baseWord(w) || allow.has(w);
	return {
		isWord,
		// A server's own block list wins over its allow list, and over the base list.
		isBlocked: (w: string) => block.has(w) || (baseBlocked(w) && !allow.has(w)),
		lemma: (w: string) => lemmaOf(w, isWord),
	};
}

export const deadLetterPool = (s: Settings) => [...s.deadLetters];

export { wordToken };

// --- shared bits -----------------------------------------------------------------

const fail = (error: string) => ({ error });
export type Fail = { error: string };
export const isFail = (v: unknown): v is Fail =>
	Boolean(v && typeof v === 'object' && 'error' in v);

const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);

const REASON_TEXT: Record<
	MoveCode | 'dead_letter' | 'timeout' | 'left' | 'left_call' | 'reset',
	string
> = {
	too_short: 'too short',
	not_a_word: 'not in the dictionary',
	bad_start: 'it did not start with the right letter',
	repeat: 'already used',
	blocked: 'not allowed here',
	dead_letter: 'it ended in the dead letter',
	timeout: 'out of time',
	left: 'left the round',
	left_call: 'left the call',
	reset: 'reset by Crew',
};

async function safely<T>(label: string, work: () => Promise<T>): Promise<T | null> {
	try {
		return await work();
	} catch (err: any) {
		log.warn(`[Shiritori] ${label}: ${err?.message}`);
		return null;
	}
}

const react = (discord: Discord, channelId: string, messageId: string, emoji: string) =>
	discord && messageId
		? safely('react', async () => {
				await discord.channels.react(channelId, messageId, emoji);
				return true;
			})
		: null;

const reply = (discord: Discord, channelId: string, messageId: string | null, content: string) =>
	discord
		? safely('reply', () =>
				discord.channels.send(channelId, {
					content,
					allowed_mentions: { parse: [] },
					...(messageId
						? {
								message_reference: {
									message_id: messageId,
									fail_if_not_exists: false,
								},
							}
						: {}),
				})
			)
		: null;

/** Whether a failed post is worth telling the server's admins about, and what to tell them. */
export interface Health {
	status: number | null;
	channelId: string | null;
	message: string;
	at: string;
	hint: string;
}

const HINTS: Record<number, string> = {
	401: 'The bot token is not accepted.',
	403: 'Give SpaceBot View Channel, Send Messages, Add Reactions and Read Message History there.',
	404: 'The channel or message is gone.',
};

/**
 * Remember that SpaceBot could not post or react, so the dashboard can say so. The
 * bot losing a permission otherwise fails silently: a chain breaks, or a word gets
 * no reaction, and nothing says why. One write a minute at most, per server.
 */
async function recordFailure(db: Db, guildId: string, channelId: string | null, err: any) {
	try {
		const now = new Date();
		await db
			.prepare(
				`UPDATE shiritori_settings SET last_error = ?, last_error_at = ?
				  WHERE guild_id = ? AND (last_error_at IS NULL OR last_error_at < ?)`
			)
			.bind(
				JSON.stringify({
					status: typeof err?.status === 'number' ? err.status : null,
					channelId,
					message: String(err?.message ?? err).slice(0, 200),
				}),
				now.toISOString(),
				guildId,
				new Date(now.getTime() - 60_000).toISOString()
			)
			.run();
	} catch {
		// Recording a problem must never be a problem.
	}
}

/**
 * The Discord client, with every post, edit and reaction watched: a failure is
 * recorded for the dashboard and then thrown on, so callers behave as before.
 */
function watched(db: Db, guildId: string, discord: Discord): Discord {
	if (!discord?.channels) return discord;
	const watch =
		(fn: (...args: any[]) => Promise<any>) =>
		async (channelId: string, ...rest: any[]) => {
			try {
				return await fn(channelId, ...rest);
			} catch (err) {
				await recordFailure(db, guildId, channelId, err);
				throw err;
			}
		};
	const { send, editMessage, react, deleteMessage } = discord.channels;
	return {
		...discord,
		channels: {
			...discord.channels,
			send: watch(send),
			editMessage: watch(editMessage),
			react: watch(react),
			...(deleteMessage ? { deleteMessage: watch(deleteMessage) } : {}),
		},
	};
}

/** The last problem posting for a server, if any, for the dashboard. */
export async function getHealth(db: Db, guildId: string): Promise<Health | null> {
	const row = await db
		.prepare(`SELECT last_error, last_error_at FROM shiritori_settings WHERE guild_id = ?`)
		.bind(guildId)
		.first();
	if (!row?.last_error) return null;
	try {
		const e = JSON.parse(row.last_error);
		return {
			status: e.status ?? null,
			channelId: e.channelId ?? null,
			message: e.message ?? '',
			at: row.last_error_at,
			hint: HINTS[e.status as number] ?? '',
		};
	} catch {
		return null;
	}
}

const isUnique = (err: any) => /UNIQUE|constraint/i.test(String(err?.message));

// --- stats ---------------------------------------------------------------------------

type StatBump = Partial<{
	wordsAdded: number;
	chainsBroken: number;
	roundsPlayed: number;
	roundsWon: number;
	longestWord: string;
}>;

async function bumpStats(db: Db, guildId: string, userId: string, b: StatBump) {
	await db
		.prepare(
			`INSERT INTO shiritori_member_stats
			   (guild_id, user_id, words_added, chains_broken, rounds_played, rounds_won, longest_word)
			 VALUES (?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(guild_id, user_id) DO UPDATE SET
			   words_added = words_added + excluded.words_added,
			   chains_broken = chains_broken + excluded.chains_broken,
			   rounds_played = rounds_played + excluded.rounds_played,
			   rounds_won = rounds_won + excluded.rounds_won,
			   longest_word = CASE
			     WHEN excluded.longest_word IS NOT NULL
			      AND (longest_word IS NULL OR length(excluded.longest_word) > length(longest_word))
			     THEN excluded.longest_word ELSE longest_word END`
		)
		.bind(
			guildId,
			userId,
			b.wordsAdded ?? 0,
			b.chainsBroken ?? 0,
			b.roundsPlayed ?? 0,
			b.roundsWon ?? 0,
			b.longestWord ?? null
		)
		.run();
}

export async function getLeaderboard(db: Db, guildId: string, limit = 10) {
	const { results } = await db
		.prepare(
			`SELECT user_id, words_added, chains_broken, rounds_played, rounds_won, longest_word
			   FROM shiritori_member_stats WHERE guild_id = ?
			  ORDER BY words_added DESC, rounds_won DESC LIMIT ?`
		)
		.bind(guildId, limit)
		.all();
	return results as {
		user_id: string;
		words_added: number;
		chains_broken: number;
		rounds_played: number;
		rounds_won: number;
		longest_word: string | null;
	}[];
}

/** The longest chain the server has finished, or 0. */
export async function chainRecord(db: Db, guildId: string, exceptId = 0): Promise<number> {
	const row = await db
		.prepare(
			`SELECT COALESCE(MAX(length), 0) AS best FROM shiritori_chains
			  WHERE guild_id = ? AND ended_at IS NOT NULL AND id != ?`
		)
		.bind(guildId, exceptId)
		.first();
	return row?.best ?? 0;
}

// --- Chain mode --------------------------------------------------------------------

export interface Chain {
	id: number;
	guild_id: string;
	channel_id: string;
	dead_letter: string;
	hard_mode: number;
	seed_word: string;
	length: number;
	last_word: string;
	last_user_id: string | null;
	started_at: string;
	ended_at: string | null;
	broken_by: string | null;
	reason: string | null;
}

export async function getOpenChain(db: Db, guildId: string, channelId: string) {
	return (await db
		.prepare(
			`SELECT * FROM shiritori_chains WHERE guild_id = ? AND channel_id = ? AND ended_at IS NULL`
		)
		.bind(guildId, channelId)
		.first()) as Chain | null;
}

/** Open a fresh chain from a random seed word. Returns the chain, or the open one if it lost a race. */
export async function startChain(
	db: Db,
	s: Settings,
	guildId: string,
	channelId: string,
	rand = Math.random,
	now = new Date()
): Promise<Chain> {
	const dead = drawDeadLetter(deadLetterPool(s), rand);
	const seed = seedWord(dead, rand);
	try {
		await db
			.prepare(
				`INSERT INTO shiritori_chains
				   (guild_id, channel_id, dead_letter, hard_mode, seed_word, last_word, started_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(guildId, channelId, dead, s.hardMode ? 1 : 0, seed, seed, now.toISOString())
			.run();
	} catch (err: any) {
		if (!isUnique(err)) throw err;
	}
	return (await getOpenChain(db, guildId, channelId)) as Chain;
}

function startAnnouncement(c: Chain) {
	const need = requiredStart(c.last_word, Boolean(c.hard_mode));
	return (
		`🔗 **New chain.** The word is **${c.seed_word}**.\n` +
		`The next word starts with **${need}**. Dead letter: **${c.dead_letter}**.\n` +
		`Mention me with your word to play: **@SpaceBot ${need}…**. Anything else is just chat.\n` +
		`One word at a time, and no one goes twice in a row.`
	);
}

/** Close a chain. Returns false when something else already closed it. */
async function endChain(
	db: Db,
	chain: Chain,
	reason: string,
	brokenBy: string | null,
	now: Date
): Promise<boolean> {
	const res = await db
		.prepare(
			`UPDATE shiritori_chains SET ended_at = ?, reason = ?, broken_by = ?
			  WHERE id = ? AND ended_at IS NULL`
		)
		.bind(now.toISOString(), reason, brokenBy, chain.id)
		.run();
	return res.meta.changes === 1;
}

async function chainSummary(db: Db, chain: Chain, headline: string): Promise<string> {
	const longest = await db
		.prepare(
			`SELECT word FROM shiritori_words WHERE chain_id = ? ORDER BY length(word) DESC, seq LIMIT 1`
		)
		.bind(chain.id)
		.first();
	const record = await chainRecord(db, chain.guild_id, chain.id);
	const length = chain.length;
	const parts = [headline, `The chain reached **${length}** word${length === 1 ? '' : 's'}.`];
	if (longest?.word) parts.push(`Longest word: **${longest.word}**.`);
	parts.push(
		length > record && length > 0
			? `🏆 A new server record (was ${record}).`
			: `Server record: **${record}**.`
	);
	return parts.join(' ');
}

export interface ChannelMessage {
	guildId: string;
	channelId: string;
	messageId: string;
	userId: string;
	userName?: string;
	content: string;
	/** The message started by mentioning the bot (the gateway strips the mention). A Chain word needs it. */
	addressed?: boolean;
	isBot?: boolean;
	/** When the member sent it; a late-processed word still counts if it was in time. */
	sentAt?: string;
}

export type Outcome =
	| { action: 'ignore' }
	| { action: 'started' }
	| { action: 'accepted' }
	| { action: 'refused' }
	| { action: 'broken'; reason: string }
	| { action: 'ended'; reason: string };

const IGNORE: Outcome = { action: 'ignore' };

async function handleChainMessage(
	db: Db,
	discord: Discord,
	s: Settings,
	msg: ChannelMessage,
	now: Date,
	rand: () => number
): Promise<Outcome> {
	// The channel is also for talking: only a message that mentions the bot is a move.
	if (!msg.addressed) return IGNORE;
	const token = wordToken(msg.content);
	if (!token || token.length < MIN_WORD_LENGTH) return IGNORE;

	let chain = await getOpenChain(db, msg.guildId, msg.channelId);
	if (!chain) {
		// The first word after the feature is switched on, or after a restart: open a
		// chain and say what the word is. The member has not seen it, so their post waits.
		chain = await startChain(db, s, msg.guildId, msg.channelId, rand, now);
		await safely('announce', () =>
			discord.channels.send(msg.channelId, {
				content: startAnnouncement(chain as Chain),
				allowed_mentions: { parse: [] },
			})
		);
		return { action: 'started' };
	}

	const dict = guildDictionary(s);
	const lemma = dict.lemma(token);
	const seen = await db
		.prepare(`SELECT lemma FROM shiritori_words WHERE chain_id = ? AND lemma = ?`)
		.bind(chain.id, lemma)
		.first();
	const used = new Set<string>();
	if (seen) used.add(lemma);
	used.add(dict.lemma(chain.seed_word));

	const move = judgeMove(token, {
		prev: chain.last_word,
		used,
		deadLetter: chain.dead_letter,
		hard: Boolean(chain.hard_mode),
		isWord: dict.isWord,
		isBlocked: dict.isBlocked,
	});

	if (chain.last_user_id === msg.userId) {
		await react(discord, msg.channelId, msg.messageId, '❌');
		await reply(discord, msg.channelId, msg.messageId, 'Let someone else add a word first.');
		return { action: 'refused' };
	}

	if (move.ok === false) {
		if (move.code === 'too_short') return IGNORE;
		if (move.code === 'blocked') return refuseWord(discord, msg, move.message);
		return breakChain(db, discord, chain, msg, move.code, move.message, now, rand, s);
	}

	// The seq is the position: two words that race for the same one cannot both land.
	const seq = chain.length + 1;
	try {
		await db
			.prepare(
				`INSERT INTO shiritori_words (chain_id, seq, word, lemma, user_id, message_id, at)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(
				chain.id,
				seq,
				move.word,
				move.lemma,
				msg.userId,
				msg.messageId,
				now.toISOString()
			)
			.run();
	} catch (err: any) {
		if (!isUnique(err)) throw err;
		await react(discord, msg.channelId, msg.messageId, '❌');
		await reply(
			discord,
			msg.channelId,
			msg.messageId,
			'Someone beat you to it. Try the next word.'
		);
		return { action: 'refused' };
	}
	await db
		.prepare(
			`UPDATE shiritori_chains SET length = ?, last_word = ?, last_user_id = ?
			  WHERE id = ? AND ended_at IS NULL AND length < ?`
		)
		.bind(seq, move.word, msg.userId, chain.id, seq)
		.run();
	await bumpStats(db, msg.guildId, msg.userId, { wordsAdded: 1, longestWord: move.word });
	// No ✅ without Add Reactions. Say it in words, so a permission slip does not look like
	// the game ignoring people. (A dead-letter word posts its own summary below.)
	if (
		!(await react(discord, msg.channelId, msg.messageId, move.endsDead ? '☠️' : '✅')) &&
		!move.endsDead
	) {
		await reply(
			discord,
			msg.channelId,
			msg.messageId,
			`✅ **${move.word}**. The next word starts with **${requiredStart(move.word, Boolean(chain.hard_mode))}**.`
		);
	}

	if (move.endsDead) {
		const ended = { ...chain, length: seq, last_word: move.word };
		if (await endChain(db, ended, 'dead_letter', msg.userId, now)) {
			const text = await chainSummary(
				db,
				ended,
				`☠️ <@${msg.userId}> played **${move.word}**, which ends in the dead letter **${chain.dead_letter}**. The chain ends here.`
			);
			await postNewChain(db, discord, s, msg, text, rand, now);
		}
		return { action: 'ended', reason: 'dead_letter' };
	}
	return { action: 'accepted' };
}

/**
 * A word on the block list is turned away, and nothing else happens: no break,
 * no one put out. A block list matches stems, so it will catch an innocent word
 * now and then, and one member must not be able to end a chain on purpose by
 * typing something the filter refuses.
 */
async function refuseWord(discord: Discord, msg: ChannelMessage, why: string): Promise<Outcome> {
	await react(discord, msg.channelId, msg.messageId, '❌');
	await reply(discord, msg.channelId, msg.messageId, `${why[0].toUpperCase()}${why.slice(1)}.`);
	return { action: 'refused' };
}

async function breakChain(
	db: Db,
	discord: Discord,
	chain: Chain,
	msg: ChannelMessage,
	code: string,
	why: string,
	now: Date,
	rand: () => number,
	s: Settings
): Promise<Outcome> {
	await react(discord, msg.channelId, msg.messageId, '❌');
	await reply(discord, msg.channelId, msg.messageId, `${why[0].toUpperCase()}${why.slice(1)}.`);
	if (await endChain(db, chain, code, msg.userId, now)) {
		await bumpStats(db, msg.guildId, msg.userId, { chainsBroken: 1 });
		const text = await chainSummary(db, chain, `💥 <@${msg.userId}> broke the chain: ${why}.`);
		await postNewChain(db, discord, s, msg, text, rand, now);
	}
	return { action: 'broken', reason: code };
}

async function postNewChain(
	db: Db,
	discord: Discord,
	s: Settings,
	msg: ChannelMessage,
	summary: string,
	rand: () => number,
	now: Date
) {
	const next = await startChain(db, s, msg.guildId, msg.channelId, rand, now);
	await safely('summary', () =>
		discord.channels.send(msg.channelId, {
			content: `${summary}\n\n${startAnnouncement(next)}`,
			allowed_mentions: { parse: [] },
		})
	);
}

// --- ❓ on a word: its definition, or what was probably meant ------------------------------

export interface ReactionInput {
	guildId: string;
	channelId: string;
	messageId: string;
	/** Who reacted. */
	userId: string;
	/** Who wrote the message the reaction is on, and what it said (the bot mention stripped). */
	authorId?: string;
	content?: string;
	addressed?: boolean;
}

/** The accepted word that came in on this message, in a chain or a round. */
async function wordOfMessage(db: Db, guildId: string, messageId: string) {
	const chain: any = await db
		.prepare(
			`SELECT w.word AS word FROM shiritori_words w
			   JOIN shiritori_chains c ON c.id = w.chain_id
			  WHERE c.guild_id = ? AND w.message_id = ?`
		)
		.bind(guildId, messageId)
		.first();
	if (chain) return chain;
	return await db
		.prepare(
			`SELECT w.word AS word FROM shiritori_round_words w
			   JOIN shiritori_rounds r ON r.id = w.round_id
			  WHERE r.guild_id = ? AND w.message_id = ?`
		)
		.bind(guildId, messageId)
		.first();
}

/**
 * Whether this message was part of the game. In the Chain channel, a word addressed to the
 * bot. In a channel that has hosted a round, a word from someone who played in it (the round
 * may be over: the game's messages stay game messages).
 */
async function isGameMessage(db: Db, s: Settings, input: ReactionInput) {
	if (s.chainChannelId && s.chainChannelId === input.channelId) return Boolean(input.addressed);
	if (!input.authorId) return false;
	const row = await db
		.prepare(
			`SELECT 1 AS hit FROM shiritori_players p
			   JOIN shiritori_rounds r ON r.id = p.round_id
			  WHERE r.guild_id = ? AND r.channel_id = ? AND p.user_id = ? LIMIT 1`
		)
		.bind(input.guildId, input.channelId, input.authorId)
		.first();
	return Boolean(row);
}

/**
 * Someone reacted ❓ to a message. If it is a word that belonged to the game, reply to it:
 * the definition when it is a word, or "maybe this was meant" with close spellings when it
 * is not in the dictionary. A message is answered once per ten minutes, and a person gets a
 * handful a minute, so a pile of ❓ cannot make the bot spam or hammer the word services.
 *
 * The gateway sends every ❓ it sees, so the cheap checks come first and a reaction on
 * anything that was not a game word returns before any request goes out.
 */
export async function handleDefineReaction(
	db: Db,
	discord: Discord,
	input: ReactionInput,
	fetcher?: Parameters<typeof lookupDefinition>[1]
): Promise<Outcome> {
	const s = await getSettings(db, input.guildId);
	if (!s.enabled || !discord?.channels?.send) return IGNORE;

	// What word is this? The game's own record of an accepted word, else what was typed.
	const stored = await safely('word of message', () =>
		wordOfMessage(db, input.guildId, input.messageId)
	);
	let word: string | null = stored?.word ? String(stored.word) : null;
	if (!word) {
		const typed = wordToken(input.content ?? '');
		if (!typed || typed.length < MIN_WORD_LENGTH) return IGNORE;
		if (!(await safely('game message', () => isGameMessage(db, s, input)))) return IGNORE;
		word = typed;
	}

	if (
		!(await consumeQuota(db, 'shiritori-define-user', input.userId, {
			max: 8,
			windowSeconds: 60,
		}))
	) {
		return IGNORE;
	}
	if (
		!(await consumeQuota(db, 'shiritori-define-msg', input.messageId, {
			max: 1,
			windowSeconds: 600,
		}))
	) {
		return IGNORE;
	}

	const dict = guildDictionary(s);
	const send = watched(db, input.guildId, discord).channels.send;
	const reply = (payload: Record<string, unknown>) =>
		safely('definition', () =>
			send(input.channelId, {
				...payload,
				message_reference: { message_id: input.messageId, fail_if_not_exists: false },
				allowed_mentions: { parse: [], replied_user: false },
			})
		);

	// Not a word the game knows: say what was probably meant.
	if (!stored?.word && !dict.isWord(word)) {
		const near = await lookupSimilar(word, fetcher);
		if (near === null) {
			// Say so in the log: from the outside this looks like the reaction was ignored.
			log.warn(
				`[Shiritori] Spelling service gave no answer for a ❓ on "${word}" in ${input.guildId}`
			);
			return IGNORE;
		}
		const maybe = near.filter((w) => dict.isWord(w) && !dict.isBlocked(w)).slice(0, 5);
		await reply({
			content: maybe.length
				? `**${word}** is not in the dictionary. Maybe this was meant: ${maybe.map((w) => `**${w}**`).join(', ')}?`
				: `**${word}** is not in the dictionary, and I could not find a close word.`,
		});
		return { action: 'accepted' };
	}

	let found = await lookupDefinition(word, fetcher);
	// "tigers" may have no page of its own; try the base word too.
	const base = dict.lemma(word);
	if (found.kind === 'none' && base !== word) found = await lookupDefinition(base, fetcher);
	if (found.kind === 'down') return IGNORE;
	await reply(
		found.kind === 'found'
			? { embeds: [found.embed] }
			: { content: `No definition found for **${word}**.` }
	);
	return { action: 'accepted' };
}

/** Crew: end the open chain here and start a fresh one (the dashboard's reset). */
export async function resetChain(
	db: Db,
	discord: Discord,
	guildId: string,
	now = new Date(),
	rand = Math.random
): Promise<boolean> {
	const s = await getSettings(db, guildId);
	if (!s.chainChannelId) return false;
	const plainClient = discord;
	discord = watched(db, guildId, discord);
	const open = await getOpenChain(db, guildId, s.chainChannelId);
	if (open) await endChain(db, open, 'reset', null, now);
	const next = await startChain(db, s, guildId, s.chainChannelId, rand, now);
	if (discord) {
		await safely('reset', () =>
			discord.channels.send(s.chainChannelId, {
				content: `🔄 The chain was reset by Crew.\n\n${startAnnouncement(next)}`,
				allowed_mentions: { parse: [] },
			})
		);
		await refreshRules(db, plainClient, guildId, now);
	}
	return true;
}

// --- Round mode --------------------------------------------------------------------

export type RoundStatus = 'lobby' | 'running' | 'ended';
export type RoundResult = 'winner' | 'cancelled' | 'abandoned';

export interface Round {
	id: number;
	guild_id: string;
	channel_id: string;
	starter_id: string;
	status: RoundStatus;
	dead_letter: string;
	hard_mode: number;
	base_turn_seconds: number;
	turn_seconds: number;
	lap: number;
	turn_no: number;
	current_user_id: string | null;
	prev_word: string | null;
	turn_ends_at: string | null;
	message_id: string | null;
	voice: number;
	turn_message_id: string | null;
	created_at: string;
	started_at: string | null;
	ended_at: string | null;
	result: RoundResult | null;
	winner_id: string | null;
}

export interface Player {
	round_id: number;
	user_id: string;
	name: string;
	seat: number | null;
	state: 'in' | 'out';
	out_reason: string | null;
	words: number;
	away_since: string | null;
}

export const getRound = async (db: Db, id: number) =>
	(await db
		.prepare(`SELECT * FROM shiritori_rounds WHERE id = ?`)
		.bind(id)
		.first()) as Round | null;

export const liveRoundIn = async (db: Db, guildId: string, channelId: string) =>
	(await db
		.prepare(
			`SELECT * FROM shiritori_rounds
			  WHERE guild_id = ? AND channel_id = ? AND status IN ('lobby', 'running')`
		)
		.bind(guildId, channelId)
		.first()) as Round | null;

export async function getPlayers(db: Db, roundId: number): Promise<Player[]> {
	const { results } = await db
		.prepare(
			`SELECT * FROM shiritori_players WHERE round_id = ? ORDER BY COALESCE(seat, 999), joined_at`
		)
		.bind(roundId)
		.all();
	return results;
}

export async function roundWords(db: Db, roundId: number) {
	const { results } = await db
		.prepare(
			`SELECT seq, word, user_id FROM shiritori_round_words WHERE round_id = ? ORDER BY seq`
		)
		.bind(roundId)
		.all();
	return results as { seq: number; word: string; user_id: string }[];
}

/** Who plays after `seat`: the next player still in, wrapping round. `lapped` when it wrapped. */
export function nextSeat(
	players: Player[],
	seat: number
): { player: Player; lapped: boolean } | null {
	const live = players.filter((p) => p.state === 'in' && p.seat !== null);
	if (!live.length) return null;
	const after = live.find((p) => (p.seat as number) > seat);
	if (after) return { player: after, lapped: false };
	return { player: live[0], lapped: true };
}

/** The clock for a lap: it drops one second a lap, to a floor. */
export const clockFor = (base: number, lap: number) => Math.max(MIN_TURN_SECONDS, base - lap);

export function shuffle<T>(items: T[], rand = Math.random): T[] {
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

export async function openRound(
	db: Db,
	discord: Discord,
	ctx: {
		guildId: string;
		channelId: string;
		starterId: string;
		starterName: string;
		/** The round is in a voice channel's chat: only people in the call play. */
		voice?: boolean;
	},
	rand = Math.random,
	now = new Date()
): Promise<Round | Fail> {
	const s = await getSettings(db, ctx.guildId);
	if (!s.enabled) {
		const { name } = await getGameDisplay(db, ctx.guildId, 'shiritori');
		return fail(`${name} is not turned on in this server.`);
	}
	if (s.chainChannelId === ctx.channelId) {
		return fail('This is the Chain channel. Start a round in another channel.');
	}
	const dead = drawDeadLetter(deadLetterPool(s), rand);
	let id: number;
	try {
		id = await db
			.prepare(
				`INSERT INTO shiritori_rounds
				   (guild_id, channel_id, starter_id, dead_letter, hard_mode, base_turn_seconds,
				    turn_seconds, voice, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
			)
			.bind(
				ctx.guildId,
				ctx.channelId,
				ctx.starterId,
				dead,
				s.hardMode ? 1 : 0,
				s.turnSeconds,
				s.turnSeconds,
				ctx.voice ? 1 : 0,
				now.toISOString()
			)
			.first()
			.then((r: any) => r?.id as number);
	} catch (err: any) {
		if (isUnique(err)) return fail('There is already a Shiritori round in this channel.');
		throw err;
	}
	await db
		.prepare(
			`INSERT INTO shiritori_players (round_id, user_id, name, joined_at) VALUES (?, ?, ?, ?)`
		)
		.bind(id, ctx.starterId, ctx.starterName, now.toISOString())
		.run();
	const round = (await getRound(db, id)) as Round;
	if (discord) {
		const msg = await safely('lobby card', async () =>
			discord.channels.send(round.channel_id, await roundMessage(db, round))
		);
		if (msg?.id) {
			await db
				.prepare(`UPDATE shiritori_rounds SET message_id = ? WHERE id = ?`)
				.bind(msg.id, id)
				.run();
			round.message_id = msg.id;
		}
	}
	return round;
}

export async function joinRound(
	db: Db,
	discord: Discord,
	roundId: number,
	user: { id: string; name: string },
	now = new Date()
): Promise<Round | Fail> {
	const round = await getRound(db, roundId);
	if (!round || round.status !== 'lobby') return fail('That lobby is closed.');
	const players = await getPlayers(db, roundId);
	if (players.some((p) => p.user_id === user.id)) return round;
	if (round.voice && (await voiceChannelOf(db, round.guild_id, user.id)) !== round.channel_id) {
		return fail('Join the voice channel this round is in first.');
	}
	if (players.length >= MAX_PLAYERS) return fail(`A round holds ${MAX_PLAYERS} players.`);
	await db
		.prepare(
			`INSERT OR IGNORE INTO shiritori_players (round_id, user_id, name, joined_at) VALUES (?, ?, ?, ?)`
		)
		.bind(roundId, user.id, user.name, now.toISOString())
		.run();
	await refreshCard(db, discord, round);
	return round;
}

export async function leaveRound(
	db: Db,
	discord: Discord,
	roundId: number,
	userId: string,
	now = new Date()
) {
	const round = await getRound(db, roundId);
	if (!round || round.status === 'ended') return fail('That round is over.');
	const players = await getPlayers(db, roundId);
	if (!players.some((p) => p.user_id === userId)) return fail('You are not in this round.');
	if (round.status === 'lobby') {
		await db
			.prepare(`DELETE FROM shiritori_players WHERE round_id = ? AND user_id = ?`)
			.bind(roundId, userId)
			.run();
		const left = players.filter((p) => p.user_id !== userId);
		if (!left.length)
			return (await endRound(db, discord, round, 'cancelled', null, now)) ?? round;
		if (round.starter_id === userId) {
			await db
				.prepare(`UPDATE shiritori_rounds SET starter_id = ? WHERE id = ?`)
				.bind(left[0].user_id, roundId)
				.run();
		}
		await refreshCard(db, discord, round);
		return (await getRound(db, roundId)) as Round;
	}
	return (await eliminate(db, discord, round, userId, 'left', now)) ?? round;
}

export async function startRound(
	db: Db,
	discord: Discord,
	roundId: number,
	by: { by: string; byCrew: boolean },
	rand = Math.random,
	now = new Date()
): Promise<Round | Fail> {
	const round = await getRound(db, roundId);
	if (!round || round.status !== 'lobby') return fail('That lobby is closed.');
	if (round.starter_id !== by.by && !by.byCrew)
		return fail('Only the starter or Crew can start it.');
	let players = await getPlayers(db, roundId);
	if (round.voice) {
		// Joined, but left the call since: not dealt in.
		const present = new Set(await humansInCall(db, round.guild_id, round.channel_id));
		const here = players.filter((p) => present.has(p.user_id));
		if (here.length < MIN_PLAYERS) {
			return fail(`It needs ${MIN_PLAYERS} players who joined and are in the call.`);
		}
		for (const gone of players.filter((p) => !present.has(p.user_id))) {
			await db
				.prepare(`DELETE FROM shiritori_players WHERE round_id = ? AND user_id = ?`)
				.bind(roundId, gone.user_id)
				.run();
		}
		players = here;
	}
	if (players.length < MIN_PLAYERS) return fail(`It needs ${MIN_PLAYERS} players to start.`);

	const order = shuffle(players, rand);
	for (const [i, p] of order.entries()) {
		await db
			.prepare(`UPDATE shiritori_players SET seat = ? WHERE round_id = ? AND user_id = ?`)
			.bind(i, roundId, p.user_id)
			.run();
	}
	// A guarded write: two Start clicks cannot both deal.
	const deadline = new Date(now.getTime() + (round.turn_seconds + START_GRACE_SECONDS) * 1000);
	const res = await db
		.prepare(
			`UPDATE shiritori_rounds
			    SET status = 'running', started_at = ?, current_user_id = ?, turn_ends_at = ?
			  WHERE id = ? AND status = 'lobby'`
		)
		.bind(now.toISOString(), order[0].user_id, deadline.toISOString(), roundId)
		.run();
	if (res.meta.changes !== 1) return fail('That round already started.');
	await refreshCard(db, discord, round);
	await announceTurn(db, discord, roundId);
	return (await getRound(db, roundId)) as Round;
}

/**
 * Put a player out and pass the turn. The word stays: the next player continues
 * from the same letter. Ends the round when one player is left.
 */
export async function eliminate(
	db: Db,
	discord: Discord,
	round: Round,
	userId: string,
	reason: string,
	now = new Date()
): Promise<Round | null> {
	const players = await getPlayers(db, round.id);
	const player = players.find((p) => p.user_id === userId && p.state === 'in');
	if (!player) return null;
	const res = await db
		.prepare(
			`UPDATE shiritori_players SET state = 'out', out_reason = ?, out_at = ?
			  WHERE round_id = ? AND user_id = ? AND state = 'in'`
		)
		.bind(reason, now.toISOString(), round.id, userId)
		.run();
	if (res.meta.changes !== 1) return null;

	const left = players.filter((p) => p.state === 'in' && p.user_id !== userId);
	if (left.length <= 1) {
		return endRound(db, discord, round, 'winner', left[0]?.user_id ?? null, now, {
			note: `<@${userId}> is out: ${REASON_TEXT[reason as keyof typeof REASON_TEXT] ?? reason}.`,
		});
	}
	// Only the current player's elimination moves the turn.
	let moved = false;
	if (round.current_user_id === userId) {
		moved = await passTurn(
			db,
			round,
			left.map((p) => ({ ...p, state: 'in' as const })),
			player.seat ?? 0,
			userId,
			now
		);
	}
	await refreshCard(db, discord, round, {
		note: `<@${userId}> is out: ${REASON_TEXT[reason as keyof typeof REASON_TEXT] ?? reason}.`,
	});
	if (moved) await announceTurn(db, discord, round.id);
	return getRound(db, round.id);
}

/**
 * Hand the turn to the next player in the order and restart the clock. Guarded on
 * who holds the turn: a word and a timeout that race both try to pass it, and the
 * second must not skip a player.
 */
async function passTurn(
	db: Db,
	round: Round,
	live: Player[],
	fromSeat: number,
	fromUserId: string,
	now: Date
): Promise<boolean> {
	// In a voice chat, hand the turn to someone who is actually in the call.
	const present = await presentIn(db, round);
	const here = present ? live.filter((p) => present.has(p.user_id)) : live;
	const next = nextSeat(here.length ? here : live, fromSeat);
	if (!next) return false;
	const lap = round.lap + (next.lapped ? 1 : 0);
	const seconds = clockFor(round.base_turn_seconds, lap);
	const res = await db
		.prepare(
			`UPDATE shiritori_rounds
			    SET current_user_id = ?, lap = ?, turn_seconds = ?, turn_ends_at = ?
			  WHERE id = ? AND status = 'running' AND current_user_id = ?`
		)
		.bind(
			next.player.user_id,
			lap,
			seconds,
			new Date(now.getTime() + seconds * 1000).toISOString(),
			round.id,
			fromUserId
		)
		.run();
	return res.meta.changes === 1;
}

export async function endRound(
	db: Db,
	discord: Discord,
	round: Round,
	result: RoundResult,
	winnerId: string | null = null,
	now = new Date(),
	extra: { note?: string } = {}
): Promise<Round | null> {
	const res = await db
		.prepare(
			`UPDATE shiritori_rounds SET status = 'ended', ended_at = ?, result = ?, winner_id = ?
			  WHERE id = ? AND status != 'ended'`
		)
		.bind(now.toISOString(), result, winnerId, round.id)
		.run();
	if (res.meta.changes !== 1) return null;
	if (round.status === 'running') {
		const players = await getPlayers(db, round.id);
		for (const p of players) {
			await bumpStats(db, round.guild_id, p.user_id, {
				roundsPlayed: 1,
				roundsWon: p.user_id === winnerId ? 1 : 0,
			});
		}
	}
	await refreshCard(db, discord, round, extra);
	const fresh = await getRound(db, round.id);
	await clearTurnPrompt(discord, fresh);
	return fresh;
}

/** The words, longest word and busiest starting letter of a round, for the result card. */
export function roundStats(words: { word: string }[]) {
	const longest = words.reduce<string | null>(
		(best, w) => (best === null || w.word.length > best.length ? w.word : best),
		null
	);
	const counts = new Map<string, number>();
	for (const { word } of words) counts.set(word[0], (counts.get(word[0]) ?? 0) + 1);
	let letter: string | null = null;
	let top = 0;
	for (const [l, n] of counts) if (n > top) [letter, top] = [l, n];
	return { longest, letter, letterCount: top };
}

// --- the call ----------------------------------------------------------------------

/**
 * Everyone (not a bot) in a voice channel right now. Not `humansInChannel`, which stops
 * at 20 for mention lists: past that, people in a big call would look as if they had left.
 */
async function humansInCall(db: Db, guildId: string, channelId: string): Promise<string[]> {
	const { results } = await db
		.prepare(
			`SELECT user_id FROM live_voice_states WHERE guild_id = ? AND channel_id = ? AND is_bot = 0`
		)
		.bind(guildId, channelId)
		.all();
	return (results || []).map((r: any) => String(r.user_id));
}

/** Who is in the round's voice channel right now, or null for a round that is not in one. */
async function presentIn(db: Db, round: Round): Promise<Set<string> | null> {
	if (!round.voice) return null;
	return new Set(await humansInCall(db, round.guild_id, round.channel_id));
}

/**
 * Keep a voice round in step with the call. Someone who has left it is skipped when
 * their turn comes (or at once, if it is their turn), and put out if they are still
 * gone after the grace. If the call empties the round is closed. Returns the round as
 * it is now, and whether anything changed.
 */
export async function syncPresence(
	db: Db,
	discord: Discord,
	round: Round,
	now = new Date()
): Promise<{ round: Round; acted: boolean }> {
	if (round.status !== 'running' || !round.voice) return { round, acted: false };
	const present = (await presentIn(db, round)) as Set<string>;
	const players = (await getPlayers(db, round.id)).filter((p) => p.state === 'in');
	let acted = false;

	for (const p of players) {
		if (present.has(p.user_id)) {
			if (p.away_since) {
				await db
					.prepare(
						`UPDATE shiritori_players SET away_since = NULL WHERE round_id = ? AND user_id = ?`
					)
					.bind(round.id, p.user_id)
					.run();
			}
		} else if (!p.away_since) {
			await db
				.prepare(
					`UPDATE shiritori_players SET away_since = ? WHERE round_id = ? AND user_id = ? AND away_since IS NULL`
				)
				.bind(now.toISOString(), round.id, p.user_id)
				.run();
			p.away_since = now.toISOString();
		}
	}

	const here = players.filter((p) => present.has(p.user_id));
	if (!here.length) {
		const ended = await endRound(db, discord, round, 'abandoned', null, now, {
			note: 'Everyone left the call.',
		});
		return { round: ended ?? round, acted: true };
	}

	for (const p of players) {
		if (present.has(p.user_id) || !p.away_since) continue;
		if (now.getTime() - Date.parse(p.away_since) >= AWAY_GRACE_MS) {
			const after = await eliminate(db, discord, round, p.user_id, 'left_call', now);
			if (after) round = after;
			acted = true;
			if (round.status !== 'running') return { round, acted };
		}
	}

	// Their turn, and they are not here: move on without waiting for the clock.
	const fresh = (await getRound(db, round.id)) as Round;
	const holder = fresh.current_user_id;
	if (fresh.status === 'running' && holder && !present.has(holder)) {
		const live = (await getPlayers(db, round.id)).filter((p) => p.state === 'in');
		const seat = live.find((p) => p.user_id === holder)?.seat ?? 0;
		if (await passTurn(db, fresh, live, seat, holder, now)) {
			await announceTurn(db, discord, round.id);
			acted = true;
		}
	}
	return { round: (await getRound(db, round.id)) as Round, acted };
}

// --- the turn prompt ---------------------------------------------------------------

/**
 * One short message at the bottom of the chat for whoever is on the clock, replacing
 * the last one. The round card is edited in place, so in a busy channel (a voice
 * chat above all) it scrolls out of sight; this stays where people are looking, and
 * it pings the player.
 */
export function turnPrompt(round: Round, words: { word: string }[]) {
	const hard = Boolean(round.hard_mode);
	const need = round.prev_word ? requiredStart(round.prev_word, hard) : null;
	const last = words.slice(-3).map((w) => w.word);
	return (
		`${round.voice ? '🎙️' : '🔗'} <@${round.current_user_id}> — ` +
		`${need ? `a word starting with **${need}**` : 'any word to start'} · ` +
		`<t:${unix(round.turn_ends_at as string)}:R> · dead letter **${round.dead_letter}**` +
		(last.length ? `\n${last.join(' → ')}` : '')
	);
}

async function announceTurn(db: Db, discord: Discord, roundId: number) {
	if (!discord) return;
	const round = await getRound(db, roundId);
	if (!round || round.status !== 'running' || !round.current_user_id) return;
	const sent = await safely('turn prompt', async () =>
		discord.channels.send(round.channel_id, {
			content: turnPrompt(round, await roundWords(db, round.id)),
			allowed_mentions: { users: [round.current_user_id] },
		})
	);
	if (sent?.id) {
		await db
			.prepare(`UPDATE shiritori_rounds SET turn_message_id = ? WHERE id = ?`)
			.bind(sent.id, roundId)
			.run();
	}
	if (round.turn_message_id) await deletePrompt(discord, round.channel_id, round.turn_message_id);
}

const deletePrompt = (discord: Discord, channelId: string, messageId: string) =>
	discord?.channels?.deleteMessage
		? safely('delete prompt', () => discord.channels.deleteMessage(channelId, messageId))
		: null;

async function clearTurnPrompt(discord: Discord, round: Round | null) {
	if (round?.turn_message_id)
		await deletePrompt(discord, round.channel_id, round.turn_message_id);
}

// --- the card ---------------------------------------------------------------------

export async function roundMessage(db: Db, round: Round, extra: { note?: string } = {}) {
	const players = await getPlayers(db, round.id);
	const mention = (p: Player) => `<@${p.user_id}>`;
	const note = extra.note ? `\n${extra.note}` : '';
	// The server's own name and icon for the game, when it set them.
	const shown = await getGameDisplay(db, round.guild_id, 'shiritori');
	const name = shown.name;
	const mark = (fallback: string) => (shown.custom.icon ? shown.icon : fallback);
	let content: string;
	let components: any[] = [];
	const hard = Boolean(round.hard_mode);

	if (round.status === 'lobby') {
		let callLine = '';
		if (round.voice) {
			const joined = new Set(players.map((p) => p.user_id));
			const waiting = (await humansInCall(db, round.guild_id, round.channel_id)).filter(
				(id) => !joined.has(id)
			);
			callLine =
				`Only people in this call can play, and anyone who leaves it is skipped.` +
				(waiting.length
					? `\nIn the call, not joined: ${waiting.map((id) => `<@${id}>`).join(', ')}. Press **Join** to play.`
					: '') +
				'\n';
		}
		content =
			`${mark(round.voice ? '🎙️' : '🔗')} **${name} — ${round.voice ? 'voice chat ' : ''}lobby**\n` +
			`Players (${players.length}): ${players.map(mention).join(', ') || '_nobody yet_'}\n` +
			callLine +
			`Each word must start with the last letter of the one before${hard ? ' (hard mode: the last two)' : ''}. ` +
			`No repeats. A word that ends in **${round.dead_letter}** puts you out. ` +
			`${round.turn_seconds} seconds a turn, and the clock drops a second every lap. Needs ${MIN_PLAYERS}+ to start.`;
		components = [
			{
				type: 1,
				components: [
					{ type: 2, style: 3, label: 'Join', custom_id: `shiritori:join:${round.id}` },
					{ type: 2, style: 2, label: 'Leave', custom_id: `shiritori:leave:${round.id}` },
					{ type: 2, style: 1, label: 'Start', custom_id: `shiritori:start:${round.id}` },
					{ type: 2, style: 4, label: 'Cancel', custom_id: `shiritori:stop:${round.id}` },
				],
			},
		];
	} else if (round.status === 'running') {
		// The turn itself is the prompt at the bottom of the chat; this card holds who is
		// in and out, so it only needs editing when that changes.
		const alive = players.filter((p) => p.state === 'in');
		const out = players.filter((p) => p.state === 'out');
		content =
			`${mark(round.voice ? '🎙️' : '🔗')} **${name}${round.voice ? ' — voice chat' : ''}**\n` +
			`Dead letter **${round.dead_letter}** · ${round.turn_seconds}s a turn (lap ${round.lap + 1})\n` +
			`In (${alive.length}): ${alive.map(mention).join(', ')}` +
			(out.length
				? `\nOut: ${out
						.map(
							(p) =>
								`<@${p.user_id}> (${REASON_TEXT[p.out_reason as keyof typeof REASON_TEXT] ?? p.out_reason ?? 'out'})`
						)
						.join(', ')}`
				: '') +
			note;
		components = [
			{
				type: 1,
				components: [
					{
						type: 2,
						style: 4,
						label: 'End round',
						custom_id: `shiritori:stop:${round.id}`,
					},
				],
			},
		];
	} else {
		const words = await roundWords(db, round.id);
		const st = roundStats(words);
		const head =
			round.result === 'winner' && round.winner_id
				? `🏆 <@${round.winner_id}> wins!`
				: round.result === 'abandoned'
					? 'The round was closed: nobody finished it.'
					: 'The round was cancelled.';
		content =
			`${mark('🔗')} **${name} — over**\n${head}${note}\n` +
			(words.length
				? `${words.length} word${words.length === 1 ? '' : 's'}` +
					(st.longest ? ` · longest **${st.longest}**` : '') +
					(st.letter ? ` · most used start **${st.letter}** (${st.letterCount})` : '') +
					`\n${words.map((w) => w.word).join(' → ')}`.slice(0, 1500)
				: 'No words were played.');
	}
	return { content, components, allowed_mentions: { parse: [] } };
}

async function refreshCard(db: Db, discord: Discord, round: Round, extra: { note?: string } = {}) {
	if (!discord) return;
	const fresh = (await getRound(db, round.id)) as Round;
	const body = await roundMessage(db, fresh, extra);
	if (fresh.message_id) {
		await safely('edit card', () =>
			discord.channels.editMessage(fresh.channel_id, fresh.message_id, body)
		);
	} else {
		await safely('post card', () => discord.channels.send(fresh.channel_id, body));
	}
}

// --- a typed word in a Round -------------------------------------------------------

/** Time out the player on the clock if it ran out. Returns true when it acted. */
export async function resolveOverdue(
	db: Db,
	discord: Discord,
	round: Round,
	now = new Date()
): Promise<boolean> {
	if (round.status !== 'running' || !round.turn_ends_at || !round.current_user_id) return false;
	if (now.getTime() <= Date.parse(round.turn_ends_at) + TURN_SLACK_MS) return false;
	return Boolean(await eliminate(db, discord, round, round.current_user_id, 'timeout', now));
}

async function handleRoundMessage(
	db: Db,
	discord: Discord,
	s: Settings,
	round: Round,
	msg: ChannelMessage,
	now: Date
): Promise<Outcome> {
	if (round.status !== 'running') return IGNORE;
	// Who is still in the call, first: someone who left is skipped before a word is read.
	if (round.voice) {
		const synced = await syncPresence(db, discord, round, now);
		if (synced.round.status !== 'running') return IGNORE;
		round = synced.round;
	}
	// The clock next: a player who was too slow is out before their word is read.
	if (await resolveOverdue(db, discord, round, now)) {
		const fresh = await getRound(db, round.id);
		if (!fresh || fresh.status !== 'running') return IGNORE;
		round = fresh;
	}
	if (round.current_user_id !== msg.userId) return IGNORE;
	const token = wordToken(msg.content);
	if (!token || token.length < MIN_WORD_LENGTH) return IGNORE;

	const dict = guildDictionary(s);
	const lemma = dict.lemma(token);
	const seen = await db
		.prepare(`SELECT 1 AS hit FROM shiritori_round_words WHERE round_id = ? AND lemma = ?`)
		.bind(round.id, lemma)
		.first();
	const move = judgeMove(token, {
		prev: round.prev_word,
		used: new Set(seen ? [lemma] : []),
		deadLetter: round.dead_letter,
		hard: Boolean(round.hard_mode),
		isWord: dict.isWord,
		isBlocked: dict.isBlocked,
	});

	if (move.ok === false) {
		if (move.code === 'too_short') return IGNORE;
		if (move.code === 'blocked') return refuseWord(discord, msg, move.message);
		await react(discord, msg.channelId, msg.messageId, '❌');
		await reply(
			discord,
			msg.channelId,
			msg.messageId,
			`${move.message[0].toUpperCase()}${move.message.slice(1)}.`
		);
		await eliminate(db, discord, round, msg.userId, move.code, now);
		return { action: 'broken', reason: move.code };
	}

	const seq = round.turn_no + 1;
	try {
		await db
			.prepare(
				`INSERT INTO shiritori_round_words (round_id, seq, word, lemma, user_id, at, message_id) VALUES (?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(
				round.id,
				seq,
				move.word,
				move.lemma,
				msg.userId,
				now.toISOString(),
				msg.messageId
			)
			.run();
	} catch (err: any) {
		if (!isUnique(err)) throw err;
		return IGNORE;
	}
	await db
		.prepare(
			`UPDATE shiritori_players SET words = words + 1 WHERE round_id = ? AND user_id = ?`
		)
		.bind(round.id, msg.userId)
		.run();
	await bumpStats(db, msg.guildId, msg.userId, { wordsAdded: 1, longestWord: move.word });
	await react(discord, msg.channelId, msg.messageId, move.endsDead ? '☠️' : '✅');

	// The word lands first, so a word that ends in the dead letter still counts.
	await db
		.prepare(
			`UPDATE shiritori_rounds SET turn_no = ?, prev_word = ? WHERE id = ? AND status = 'running'`
		)
		.bind(seq, move.word, round.id)
		.run();
	const players = await getPlayers(db, round.id);
	const me = players.find((p) => p.user_id === msg.userId);
	const landed = (await getRound(db, round.id)) as Round;

	if (move.endsDead) {
		await eliminate(db, discord, landed, msg.userId, 'dead_letter', now);
		return { action: 'ended', reason: 'dead_letter' };
	}
	if (await passTurn(db, landed, players, me?.seat ?? 0, msg.userId, now)) {
		await announceTurn(db, discord, round.id);
	}
	return { action: 'accepted' };
}

/**
 * When the member sent it: used to judge a word against the clock, so a word that
 * was in time still counts if it was processed late. A missing, unparseable or
 * future timestamp (clock skew) falls back to now, so it can never stretch a turn.
 */
export function sentTime(sentAt: string | undefined, now: Date): Date {
	const sent = sentAt ? new Date(sentAt) : now;
	return Number.isNaN(sent.getTime()) || sent > now ? now : sent;
}

// --- the entry points ---------------------------------------------------------------

/** A message the gateway saw in a channel Shiritori listens to. */
export async function handleMessage(
	db: Db,
	discord: Discord,
	msg: ChannelMessage,
	now = new Date(),
	rand = Math.random
): Promise<Outcome> {
	if (msg.isBot) return IGNORE;
	const s = await getSettings(db, msg.guildId);
	if (!s.enabled) return IGNORE;
	const plain = discord;
	discord = watched(db, msg.guildId, discord);
	if (s.chainChannelId === msg.channelId) {
		const out = await handleChainMessage(db, discord, s, msg, now, rand);
		// A word landed, the chain broke or ended: bring the kept rules message up to date.
		if (out.action !== 'ignore' && out.action !== 'refused') {
			await refreshRules(db, plain, msg.guildId, now);
		}
		return out;
	}
	const round = await liveRoundIn(db, msg.guildId, msg.channelId);
	if (!round) return IGNORE;
	return handleRoundMessage(db, discord, s, round, msg, sentTime(msg.sentAt, now));
}

/** What the gateway should forward: Chain channels, and the channels of running rounds. */
export async function listActive(db: Db) {
	// One statement, so an idle poll is a single read, and the partial index on the
	// settings keeps it to the servers that actually have a Chain channel.
	const { results } = await db
		.prepare(
			`SELECT 'chain' AS kind, guild_id, chain_channel_id AS channel_id, NULL AS status, NULL AS turn_ends_at, NULL AS voice
			   FROM shiritori_settings WHERE enabled = 1 AND chain_channel_id IS NOT NULL
			 UNION ALL
			 SELECT 'round', guild_id, channel_id, status, turn_ends_at, voice
			   FROM shiritori_rounds WHERE status IN ('lobby', 'running')`
		)
		.all();
	return {
		chains: results
			.filter((r: any) => r.kind === 'chain')
			.map((r: any) => ({ guildId: r.guild_id, channelId: r.channel_id })),
		rounds: results
			.filter((r: any) => r.kind === 'round')
			.map((r: any) => ({
				guildId: r.guild_id,
				channelId: r.channel_id,
				status: r.status as 'lobby' | 'running',
				turnEndsAt: r.turn_ends_at as string | null,
				voice: Boolean(r.voice),
			})),
	};
}

/** The clock: time out every running round whose turn is overdue. */
export async function tickRounds(db: Db, discord: Discord, now = new Date()): Promise<number> {
	const { results } = await db
		.prepare(
			`SELECT * FROM shiritori_rounds WHERE status = 'running' AND (voice = 1 OR turn_ends_at < ?)`
		)
		.bind(new Date(now.getTime() - TURN_SLACK_MS).toISOString())
		.all();
	let n = 0;
	for (let round of results as Round[]) {
		const io = watched(db, round.guild_id, discord);
		if (round.voice) {
			round = (await syncPresence(db, io, round, now)).round;
			if (round.status !== 'running') continue;
		}
		if (await resolveOverdue(db, io, round, now)) n++;
	}
	return n;
}

/**
 * The minute sweep: overdue turns, lobbies nobody started, and (once an hour) old
 * word rows. An idle minute is one read: the rounds still in play, of which there
 * are usually none.
 */
export async function sweepShiritori(
	db: Db,
	discord: Discord,
	now = new Date(),
	pruneNow = now.getUTCMinutes() === 0
) {
	const { results } = await db
		.prepare(`SELECT * FROM shiritori_rounds WHERE status IN ('lobby', 'running')`)
		.all();
	const staleBefore = new Date(now.getTime() - LOBBY_TTL_MS).toISOString();
	let timedOut = 0;
	let closedLobbies = 0;
	for (let round of results as Round[]) {
		const io = watched(db, round.guild_id, discord);
		if (round.status === 'running') {
			if (round.voice) {
				round = (await syncPresence(db, io, round, now)).round;
				if (round.status !== 'running') continue;
			}
			if (await resolveOverdue(db, io, round, now)) timedOut++;
		} else if (round.created_at < staleBefore) {
			await endRound(db, io, round, 'abandoned', null, now);
			closedLobbies++;
		}
	}
	if (pruneNow) await pruneOldWords(db, now);
	return { timedOut, closedLobbies };
}

async function pruneOldWords(db: Db, now: Date) {
	const cutoff = new Date(now.getTime() - WORD_RETENTION_DAYS * 86_400_000).toISOString();
	await db
		.prepare(
			`DELETE FROM shiritori_words WHERE at < ?
			   AND chain_id IN (SELECT id FROM shiritori_chains WHERE ended_at IS NOT NULL)`
		)
		.bind(cutoff)
		.run();
	await db
		.prepare(
			`DELETE FROM shiritori_round_words WHERE at < ?
			   AND round_id IN (SELECT id FROM shiritori_rounds WHERE status = 'ended')`
		)
		.bind(cutoff)
		.run();
}

// --- the command and its buttons -----------------------------------------------------

type Interaction = Record<string, any>;

const ephemeral = (content: string) => ({
	type: RESPOND_MESSAGE,
	data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } },
});

function userOf(body: Interaction) {
	const u = body.member?.user || body.user;
	return {
		id: u?.id as string | undefined,
		name: String(body.member?.nick || u?.global_name || u?.username || 'Player').slice(0, 40),
	};
}

/** True when `/game help` was invoked. */
export const isGameHelpCommand = (body: Interaction) =>
	flattenInteractionOptions(body.data).subcommand === 'help';

/**
 * `/game help`: the games' rules, for anyone, private to whoever asked. Shiritori's rules are
 * the same text the manager pins (with this server's settings and the chain as it stands),
 * plus how to start a round and the hidden-agent game in a line.
 */
export async function handleGameHelp(body: Interaction, db: Db) {
	const guildId = body.guild_id;
	if (!guildId) return ephemeral('/game only works inside a server.');
	if (!db) return ephemeral('The database is not available right now.');
	const s = await getSettings(db, guildId);
	const note = s.enabled
		? ''
		: '*Shiritori is not turned on in this server yet. A server manager can switch it on under Activity in the dashboard.*\n\n';
	const rules = rulesText(s, s.enabled ? await rulesStatus(db, guildId, s) : '');
	// Discord allows 2000 characters. The rules and the status come first; the extras are
	// dropped, last one first, until it fits.
	const extras = [
		'🕵️ **Hidden agent** (voice): join a voice channel and run **/game start**. All but one player get a secret word; the agent does not. Talk, vote, eject who you think it is. Played in the Activity.',
		'`/game stop` ends a round, `/game status` shows it. `/define` and `/synonym` look words up where a server has them on.',
	];
	const head = `${note}${rules}`;
	let text = [head, ...extras].join('\n\n');
	while (text.length > 2000 && extras.length > 0) {
		extras.pop();
		text = [head, ...extras].join('\n\n');
	}
	return ephemeral(text.slice(0, 2000));
}

/** True when `/game shiritori` was invoked, so the route can send it here. */
export const isShiritoriCommand = (body: Interaction) =>
	flattenInteractionOptions(body.data).subcommand === 'shiritori';

/** Voice or stage channel, from the synced channel list. Unknown counts as no. */
async function isVoiceChannel(db: Db, guildId: string, channelId: string) {
	const row: any = await safely('channel type', () =>
		db
			.prepare(`SELECT type FROM guild_channels WHERE guild_id = ? AND channel_id = ?`)
			.bind(guildId, channelId)
			.first()
	);
	return row?.type === 2 || row?.type === 13;
}

/** The rules message, from the server's own settings. */
export function rulesText(s: Settings, status = '') {
	const dead = [...new Set(s.deadLetters.toUpperCase().split(''))].join(', ');
	const start = s.hardMode ? 'the last **two** letters' : 'the last letter';
	return (
		'🔗 **Shiritori: the word chain**\n' +
		`To play, mention me with one word: **@SpaceBot eagle**. Anything without the mention is just chat.\n\n` +
		`• Each word starts with ${start} of the word before it.\n` +
		'• Real English words only, at least 3 letters. Plurals and other forms of a used word count as used.\n' +
		'• A word that was already used, or does not fit, **breaks the chain** and a new one starts.\n' +
		'• No one goes twice in a row.\n' +
		`• Each chain has a dead letter (one of ${dead}). A word that ends in it ends the chain.\n` +
		'• A word on this server’s block list gets a ❌ and nothing else.\n' +
		'• React ❓ to a word and I will post its definition. On a word that is not in the dictionary I will suggest what was meant.\n\n' +
		`For a timed game with turns (${s.turnSeconds} seconds each), run **/game shiritori** in any other text channel.` +
		(status ? `\n\n${status}` : '')
	);
}

/** Where the rules message the bot keeps up to date is, or null. */
async function getRulesMessage(db: Db, guildId: string) {
	const row: any = await safely('rules message', () =>
		db
			.prepare(
				`SELECT rules_channel_id AS channelId, rules_message_id AS messageId
				   FROM shiritori_settings WHERE guild_id = ?`
			)
			.bind(guildId)
			.first()
	);
	return row?.channelId && row?.messageId
		? { channelId: String(row.channelId), messageId: String(row.messageId) }
		: null;
}

async function setRulesMessage(
	db: Db,
	guildId: string,
	channelId: string | null,
	messageId: string | null
) {
	await db
		.prepare(
			`INSERT INTO shiritori_settings (guild_id, rules_channel_id, rules_message_id) VALUES (?, ?, ?)
			 ON CONFLICT(guild_id) DO UPDATE SET
			   rules_channel_id = excluded.rules_channel_id, rules_message_id = excluded.rules_message_id`
		)
		.bind(guildId, channelId, messageId)
		.run();
}

/** The "Right now" section of the rules message: the chain as it stands. */
export async function rulesStatus(db: Db, guildId: string, s: Settings, now = new Date()) {
	const stamp = `<t:${Math.floor(now.getTime() / 1000)}:R>`;
	if (!s.enabled || !s.chainChannelId) {
		return `**Right now** (updated ${stamp})\nThe always-on chain is off.`;
	}
	const chain = await getOpenChain(db, guildId, s.chainChannelId);
	const record = await chainRecord(db, guildId, chain?.id ?? 0);
	const best = record ? `\nLongest chain so far: **${record}** words.` : '';
	if (!chain) {
		return (
			`**Right now** (updated ${stamp})\nNo chain is running in <#${s.chainChannelId}>. ` +
			`Mention me with a word to start one.${best}`
		);
	}
	const need = requiredStart(chain.last_word, Boolean(chain.hard_mode));
	const by = chain.length > 0 && chain.last_user_id ? ` by <@${chain.last_user_id}>` : '';
	return (
		`**Right now** (updated ${stamp})\n` +
		`Chain in <#${s.chainChannelId}>: **${chain.length}** ${chain.length === 1 ? 'word' : 'words'}. ` +
		`Last word: **${chain.last_word}**${by}.\n` +
		`The next word starts with **${need}**. Dead letter: **${chain.dead_letter}**.${best}`
	);
}

/**
 * Edit the kept rules message so its status matches the chain. Failures are quiet: the game
 * does not depend on it, and a message that was deleted just stops being tracked. Pass the
 * plain client, not the watched one, so this never lands in the dashboard's health notice.
 */
export async function refreshRules(db: Db, discord: Discord, guildId: string, now = new Date()) {
	if (!discord?.channels?.editMessage) return false;
	const where = await getRulesMessage(db, guildId);
	if (!where) return false;
	const s = await getSettings(db, guildId);
	try {
		await discord.channels.editMessage(where.channelId, where.messageId, {
			content: rulesText(s, await rulesStatus(db, guildId, s, now)),
			allowed_mentions: { parse: [] },
		});
		return true;
	} catch (err: any) {
		if (err?.status === 404)
			await safely('forget rules', () => setRulesMessage(db, guildId, null, null));
		else
			log.warn(
				`[Shiritori] Could not update the rules message in ${guildId}: ${err?.message}`
			);
		return false;
	}
}

/** `/game shiritori rules:True`: post the rules here and pin them. Managers only. */
async function postRules(
	body: Interaction,
	db: Db,
	guildId: string,
	channelId: string,
	discord: Discord
) {
	if (!(await maySetChainChannel(db, guildId, body.member))) {
		return {
			response: ephemeral(
				'Only people who can manage this bot’s commands can post the rules. Ask a server manager.'
			),
		};
	}
	if (!discord?.channels?.send) return { response: ephemeral('I can’t post right now.') };
	const settings = await getSettings(db, guildId);
	const text = rulesText(settings, await rulesStatus(db, guildId, settings));
	// Already posted and kept up to date: refresh that message instead of posting a second.
	const kept = await getRulesMessage(db, guildId);
	// Asked in another channel than the one the message is in (the chain moved): post a new one
	// here, so the people playing in this channel have the rules.
	if (kept && kept.channelId === channelId && (await refreshRules(db, discord, guildId))) {
		return {
			response: ephemeral(
				`The rules message in <#${kept.channelId}> is up to date. ` +
					'It keeps its "Right now" section current as the chain moves.'
			),
		};
	}
	const posted: any = await safely('rules', () =>
		discord.channels.send(channelId, { content: text, allowed_mentions: { parse: [] } })
	);
	if (!posted?.id) {
		return {
			response: ephemeral(
				'I couldn’t post here. Check that I can send messages in this channel.'
			),
		};
	}
	await safely('track rules', () => setRulesMessage(db, guildId, channelId, String(posted.id)));
	// The old message stops updating, so say where the rules went rather than leave it stale.
	if (kept && kept.channelId !== channelId && discord.channels.editMessage) {
		await safely('retire old rules', () =>
			discord.channels.editMessage(kept.channelId, kept.messageId, {
				content: `The Shiritori rules moved to <#${channelId}>.`,
				allowed_mentions: { parse: [] },
			})
		);
	}
	const pinned = discord.channels.pin
		? await safely('pin rules', () => discord.channels.pin(channelId, posted.id))
		: null;
	return {
		response: ephemeral(
			pinned !== null
				? 'Posted and pinned the rules. Its "Right now" section updates as the chain moves.'
				: 'Posted the rules, but I couldn’t pin them. Give me the Pin Messages permission, or pin the message yourself. Its "Right now" section still updates.'
		),
	};
}

/**
 * Who may point the chain at a channel with `/game shiritori channel:`. It is the
 * dashboard's "manage commands" permission: Manage Server by default, or the level
 * set on the Settings page (roles saved in the database count, but no dashboard form writes
 * them). Administrators always pass. A member
 * object with no permissions fails closed.
 */
export async function maySetChainChannel(
	db: Db,
	guildId: string,
	member: { permissions?: unknown; roles?: unknown } | null | undefined
) {
	const rule = (await getGuildSettings(db, guildId))?.permission_settings?.manageCommands;
	const name = String(rule?.permission || 'MANAGE_GUILD');
	const required = (PERMISSION_FLAGS as Record<string, { value: string }>)[name]?.value ?? '32';
	if (memberHasCommandPermission(member?.permissions, required)) return true;
	const held = new Set(Array.isArray(member?.roles) ? member!.roles.map(String) : []);
	return (Array.isArray(rule?.roles) ? rule.roles : []).some((id: unknown) =>
		held.has(String(id))
	);
}

/** Whether a rules message exists in some channel other than this one. */
async function rulesElsewhere(db: Db, guildId: string, channelId: string) {
	const kept = await safely('rules message', () => getRulesMessage(db, guildId));
	return Boolean(kept && kept.channelId !== channelId);
}

/**
 * `/game shiritori channel:#name` makes that channel the always-on chain;
 * `/game shiritori off:True` stops it. Managers only (see `maySetChainChannel`).
 */
async function setChainChannel(
	body: Interaction,
	db: Db,
	guildId: string,
	channelId: string | null,
	discord: Discord
) {
	if (!(await maySetChainChannel(db, guildId, body.member))) {
		return {
			response: ephemeral(
				'Only people who can manage this bot’s commands can change the chain channel. Ask a server manager.'
			),
		};
	}
	const settings = await getSettings(db, guildId);
	if (channelId === null) {
		if (!settings.chainChannelId) {
			return { response: ephemeral('There is no always-on chain to turn off.') };
		}
		await upsertSettings(db, guildId, { ...settings, chainChannelId: null });
		log.info(`[Shiritori] chain channel cleared in ${guildId} by ${userOf(body).id}`);
		await refreshRules(db, discord, guildId);
		return {
			response: ephemeral(
				'The always-on chain is off. `/game shiritori` rounds still work. ' +
					'Set a channel again any time.'
			),
		};
	}
	const known: any = await safely('channel', () =>
		db
			.prepare(`SELECT type FROM guild_channels WHERE guild_id = ? AND channel_id = ?`)
			.bind(guildId, channelId)
			.first()
	);
	if (known && known.type !== 0 && known.type !== 5) {
		return { response: ephemeral('Pick a text channel for the chain.') };
	}
	await upsertSettings(db, guildId, { ...settings, enabled: true, chainChannelId: channelId });
	await refreshRules(db, discord, guildId);
	log.info(`[Shiritori] chain channel set to ${channelId} in ${guildId} by ${userOf(body).id}`);
	return {
		response: ephemeral(
			`Done. <#${channelId}> is now the Shiritori chain: anyone can post a word there. ` +
				'Change the rules or turn it off under Activity in the dashboard, or with `/game shiritori off:True`.' +
				((await rulesElsewhere(db, guildId, channelId))
					? ' The rules message is still in another channel: run `/game shiritori rules:True` in the chain channel to post it there.'
					: '')
		),
	};
}

export async function handleShiritoriCommand(body: Interaction, db: Db, discord: Discord) {
	const guildId = body.guild_id;
	const channelId = body.channel_id;
	const user = userOf(body);
	if (!guildId || !channelId || !user.id) {
		return { response: ephemeral('Shiritori only works inside a server channel.') };
	}
	if (!db) return { response: ephemeral('The database is not available right now.') };
	if (!(await getCommandByName(db, 'game', guildId))) {
		return { response: ephemeral('Game is not turned on in this server.') };
	}
	const leaves = flattenInteractionOptions(body.data).leaves;
	const picked = leaves.find((o) => o.name === 'channel')?.value;
	const off = leaves.find((o) => o.name === 'off')?.value === true;
	const rules = leaves.find((o) => o.name === 'rules')?.value === true;
	if ([Boolean(picked), off, rules].filter(Boolean).length > 1) {
		return { response: ephemeral('Use one of channel, off or rules at a time.') };
	}
	if (rules) return postRules(body, db, guildId, channelId, watched(db, guildId, discord));
	if (picked) return setChainChannel(body, db, guildId, String(picked), discord);
	if (off) return setChainChannel(body, db, guildId, null, discord);
	discord = watched(db, guildId, discord);
	const inCall = (await voiceChannelOf(db, guildId, user.id)) === channelId;
	const live = await liveRoundIn(db, guildId, channelId);
	if (live) {
		const msg = await roundMessage(db, live);
		return { response: { type: RESPOND_MESSAGE, data: { ...msg, flags: EPHEMERAL } } };
	}
	// A voice channel's chat belongs to its call: you have to be in it to open a round there.
	if (!inCall && (await isVoiceChannel(db, guildId, channelId))) {
		return {
			response: ephemeral(
				'Join this voice channel first, then run /game shiritori in its chat.'
			),
		};
	}
	const opened = await openRound(db, discord, {
		guildId,
		channelId,
		starterId: user.id,
		starterName: user.name,
		voice: inCall,
	});
	if (isFail(opened)) return { response: ephemeral(opened.error) };
	return {
		response: ephemeral(
			inCall
				? 'Lobby opened. Anyone in the call can press Join to play.'
				: 'Lobby opened. Others join with the button.'
		),
	};
}

export async function handleShiritoriComponent(body: Interaction, db: Db, discord: Discord) {
	const [, action, idText] = String(body.data?.custom_id || '').split(':');
	const id = Number(idText);
	const user = userOf(body);
	if (!db || !Number.isInteger(id) || !user.id) {
		return { response: ephemeral('That button has expired.') };
	}
	const round = await getRound(db, id);
	if (!round) return { response: ephemeral('That round is gone.') };
	if (round.status === 'ended') return { response: ephemeral('That round is over.') };
	discord = watched(db, round.guild_id, discord);

	const card = async () => ({
		type: RESPOND_UPDATE,
		data: await roundMessage(db, (await getRound(db, id)) as Round),
	});

	if (action === 'join') {
		const out = await joinRound(db, discord, id, { id: user.id, name: user.name });
		return isFail(out) ? { response: ephemeral(out.error) } : { response: await card() };
	}
	if (action === 'leave') {
		const out = await leaveRound(db, discord, id, user.id);
		return isFail(out) ? { response: ephemeral(out.error) } : { response: await card() };
	}
	if (action === 'start') {
		const out = await startRound(db, discord, id, {
			by: user.id,
			byCrew: isCrew(body.member?.permissions),
		});
		return isFail(out) ? { response: ephemeral(out.error) } : { response: await card() };
	}
	if (action === 'stop') {
		if (round.starter_id !== user.id && !isCrew(body.member?.permissions)) {
			return { response: ephemeral('Only the starter or Crew can end the round.') };
		}
		await endRound(db, discord, round, 'cancelled');
		return { response: await card() };
	}
	return { response: ephemeral('Unknown button.') };
}
