/**
 * /define and /synonym: two small built-in commands a server can switch on.
 *
 * Both are looked up live from a free public service, with no key:
 *  - /define   Wiktionary's REST API (en.wiktionary.org, CC BY-SA). It answers in well under a
 *              second and handles short phrases. dictionaryapi.dev was tried first and was
 *              returning 502s and taking four seconds, so it is not used.
 *  - /synonym  Datamuse (api.datamuse.com)
 *
 * The interactions route calls `handleWordCommand` on the edge and Discord wants an answer in
 * three seconds, so each fetch is cut off after `LOOKUP_TIMEOUT_MS` and the member is told to
 * try again. Nothing is stored: not the word, not who asked. A per-member limit
 * (`consumeQuota`) keeps one person from hammering the upstream services through us.
 *
 * Everything that comes back is third-party text. It is only ever put in an embed with every
 * mention turned off, stripped of markup, and cut to Discord's limits.
 */

import { getCommandByName } from '../db/commands.js';
import { consumeQuota } from './rate-limit.js';

type Db = any;
type Fetcher = (url: string, init?: any) => Promise<Response>;

const RESPOND_MESSAGE = 4;
const EPHEMERAL = 64;
export const LOOKUP_TIMEOUT_MS = 2200;
/** Lookups per member per minute. */
export const LOOKUP_LIMIT = { max: 12, windowSeconds: 60 };
/** One word, or a short phrase: letters, spaces, hyphens and apostrophes only. */
const WORD = /^[\p{L}][\p{L}' -]{0,39}$/u;
const EMBED_COLOR = 0x5865f2;

export const WORD_COMMANDS = ['define', 'synonym'] as const;
export type WordCommand = (typeof WORD_COMMANDS)[number];
export const isWordCommand = (name: unknown): name is WordCommand =>
	WORD_COMMANDS.includes(name as WordCommand);

const say = (content: string) => ({
	type: RESPOND_MESSAGE,
	data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } },
});

const embed = (e: Record<string, unknown>) => ({
	type: RESPOND_MESSAGE,
	data: { embeds: [{ color: EMBED_COLOR, ...e }], allowed_mentions: { parse: [] } },
});

const cut = (text: string, max: number) =>
	text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

/** What the member typed, tidied: trimmed, one space between words, lower-cased. */
export function cleanWord(raw: unknown): string | null {
	const word = String(raw ?? '')
		.trim()
		.replace(/\s+/g, ' ')
		.toLowerCase();
	return WORD.test(word) ? word : null;
}

async function getJson(fetcher: Fetcher, url: string) {
	const res = await fetcher(url, {
		headers: {
			accept: 'application/json',
			'user-agent': 'SpaceBot (spacebot.starspace.group)',
		},
		signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
		// Cloudflare's edge may serve a repeat word from its own cache for a day.
		cf: { cacheTtl: 86_400, cacheEverything: true },
	});
	return { status: res.status, body: res.ok ? await res.json().catch(() => null) : null };
}

// --- /define ------------------------------------------------------------------------------

const ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
};

/** Wiktionary sends definitions as HTML. Keep the words, drop the markup and decode entities. */
export function stripHtml(html: unknown): string {
	return String(html ?? '')
		.replace(/<[^>]*>/g, '')
		.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
			if (code[0] === '#') {
				const n =
					code[1].toLowerCase() === 'x'
						? parseInt(code.slice(2), 16)
						: Number(code.slice(1));
				return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
			}
			return ENTITIES[code.toLowerCase()] ?? whole;
		})
		.replace(/\s+/g, ' ')
		.trim();
}

const COMMON_PARTS = [
	'noun',
	'verb',
	'adjective',
	'adverb',
	'pronoun',
	'preposition',
	'conjunction',
	'interjection',
];

export interface Meaning {
	partOfSpeech: string;
	definitions: { definition: string; example?: string }[];
}

/** The English entries of a Wiktionary answer, as plain text. Pure, so it tests without a network. */
export function parseWiktionary(body: any): Meaning[] {
	const entries = body?.en;
	if (!Array.isArray(entries)) return [];
	const meanings: Meaning[] = [];
	for (const entry of entries) {
		const definitions = (entry?.definitions ?? [])
			.map((d: any) => {
				const definition = stripHtml(d?.definition);
				const example = stripHtml(Array.isArray(d?.examples) ? d.examples[0] : '');
				return definition ? { definition, example: example || undefined } : null;
			})
			.filter(Boolean) as Meaning['definitions'];
		const part = stripHtml(entry?.partOfSpeech);
		if (part && definitions.length) meanings.push({ partOfSpeech: part, definitions });
	}
	return meanings;
}

/** The embed for a definition: up to three parts of speech, two senses each. */
export function defineEmbed(word: string, meanings: Meaning[]) {
	// The everyday parts of speech first: Wiktionary lists "Symbol" (a language code) before the verb for "run".
	const rank = (m: Meaning) => {
		const i = COMMON_PARTS.indexOf(m.partOfSpeech.toLowerCase());
		return i === -1 ? COMMON_PARTS.length : i;
	};
	const ordered = [...meanings].sort((a, b) => rank(a) - rank(b));
	const fields = ordered.slice(0, 3).map((m) => {
		const lines = m.definitions.slice(0, 2).map((d, i) => {
			const example = d.example ? `\n   *“${cut(d.example, 160)}”*` : '';
			return `${i + 1}. ${cut(d.definition, 300)}${example}`;
		});
		return { name: cut(m.partOfSpeech, 50), value: cut(lines.join('\n'), 1000) };
	});
	return embed({
		title: cut(word, 250),
		url: `https://en.wiktionary.org/wiki/${encodeURIComponent(word.replace(/ /g, '_'))}`,
		fields,
		footer: { text: 'Definitions from Wiktionary, CC BY-SA' },
	});
}

// --- /synonym -------------------------------------------------------------------------------

/**
 * Datamuse answers `[{ word, score }]`, best first. Keeps distinct words other than the query.
 * Phrases and names ("western fence lizard", "jonathan swift") are left out when the query is
 * one word: they are real results, but not what someone asking for a synonym wants.
 */
export function parseDatamuse(body: any, query: string, limit = 20): string[] {
	if (!Array.isArray(body)) return [];
	const single = !query.includes(' ');
	const seen = new Set<string>([query]);
	const out: string[] = [];
	for (const row of body) {
		const w = typeof row?.word === 'string' ? row.word.trim().toLowerCase() : '';
		if (!w || seen.has(w) || !WORD.test(w) || (single && w.includes(' '))) continue;
		seen.add(w);
		out.push(w);
		if (out.length >= limit) break;
	}
	return out;
}

export function synonymEmbed(word: string, words: string[], similar: boolean) {
	return embed({
		title: `${similar ? 'Words like' : 'Synonyms for'} “${word}”`,
		description: cut(words.join(', '), 3800),
		footer: { text: 'Word data from Datamuse' },
	});
}

// --- the handler ----------------------------------------------------------------------------

/** The word option's value. */
const wordOption = (body: any) =>
	(body.data?.options ?? []).find((o: any) => o.name === 'word')?.value;

export async function handleWordCommand(
	kind: WordCommand,
	body: any,
	db: Db,
	fetcher: Fetcher = fetch
) {
	const guildId = body.guild_id;
	if (!guildId) return say(`/${kind} only works inside a server.`);
	if (!db) return say('The database is not available right now.');
	// A server that has not switched it on, or has since switched it off.
	if (!(await getCommandByName(db, kind, guildId))) {
		return say(`/${kind} is not turned on in this server.`);
	}

	const word = cleanWord(wordOption(body));
	if (!word) return say('Give me one word, or a short phrase, made of letters.');
	const who = body.member?.user?.id ?? body.user?.id ?? 'anonymous';
	if (!(await consumeQuota(db, 'word-lookup', String(who), LOOKUP_LIMIT))) {
		return say('Easy, that is a lot of lookups. Try again in a minute.');
	}

	try {
		if (kind === 'define') {
			const title = encodeURIComponent(word.replace(/ /g, '_'));
			const { status, body: json } = await getJson(
				fetcher,
				`https://en.wiktionary.org/api/rest_v1/page/definition/${title}`
			);
			if (status === 404)
				return say(`No definition found for **${word}**. Check the spelling.`);
			if (status >= 400)
				return say('The dictionary is having trouble. Try again in a moment.');
			const meanings = parseWiktionary(json);
			return meanings.length
				? defineEmbed(word, meanings)
				: say(`No English definition found for **${word}**.`);
		}

		const q = encodeURIComponent(word);
		const syn = await getJson(fetcher, `https://api.datamuse.com/words?rel_syn=${q}&max=30`);
		let words = parseDatamuse(syn.body, word);
		let similar = false;
		if (words.length === 0) {
			// Few words have listed synonyms; fall back to "means like" and say so.
			const near = await getJson(fetcher, `https://api.datamuse.com/words?ml=${q}&max=30`);
			words = parseDatamuse(near.body, word);
			similar = words.length > 0;
		}
		return words.length
			? synonymEmbed(word, words, similar)
			: say(`No synonyms found for **${word}**.`);
	} catch {
		// A timeout, a network failure or a service that is down.
		return say('The word service did not answer in time. Try again in a moment.');
	}
}
