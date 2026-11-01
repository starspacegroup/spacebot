/**
 * Shiritori, the English word chain. The pure rules: no I/O, no dictionary. A
 * move is judged with a word predicate passed in, so the same code serves the
 * Chain channel, a Round, and the tests. Plan: planning/SHIRITORI_PLAN.md.
 */

/** The hard enders. One is drawn per game and shown up front. */
export const DEAD_LETTERS = ['x', 'q', 'j', 'z'] as const;
export type DeadLetter = (typeof DEAD_LETTERS)[number];

export const MIN_WORD_LENGTH = 3;

export function drawDeadLetter(pool: readonly string[] = DEAD_LETTERS, rand = Math.random) {
	const letters = pool.filter((l) => /^[a-z]$/.test(l));
	const from = letters.length ? letters : [...DEAD_LETTERS];
	return from[Math.floor(rand() * from.length)] as string;
}

/** One lower-case a-z word of three letters or more, or null. */
export function normalizeWord(raw: string): string | null {
	const word = raw.trim().toLowerCase();
	return /^[a-z]+$/.test(word) && word.length >= MIN_WORD_LENGTH ? word : null;
}

/**
 * A typed word: one run of letters, lower-cased. Anything else is talk and is
 * ignored: several words, links, emoji, numbers, and a line that starts with `//`.
 */
export function wordToken(content: string): string | null {
	const text = content.trim();
	if (!text || text.startsWith('//')) return null;
	return /^[A-Za-z]+$/.test(text) ? text.toLowerCase() : null;
}

/**
 * Whether a message could be a move at all. The gateway asks this before it
 * forwards anything, so chat in a Chain channel costs no request.
 */
export const couldBeAMove = (content: string) =>
	(wordToken(content)?.length ?? 0) >= MIN_WORD_LENGTH;

/** What the next word must start with: the last letter, or the last two in hard mode. */
export function requiredStart(prev: string, hard = false): string {
	return prev.slice(hard ? -2 : -1);
}

/**
 * The base form of a word, for the no-repeat rule: `stars` and `star` are the
 * same word. A candidate stem counts only when the dictionary knows it, so
 * `bus` is not read as `bu`. Returns the word itself when nothing matches.
 */
export function lemmaOf(word: string, isWord: (w: string) => boolean): string {
	const stems: string[] = [];
	const add = (stem: string) => {
		if (stem.length >= MIN_WORD_LENGTH && stem !== word) stems.push(stem);
	};
	if (word.endsWith('ies')) add(word.slice(0, -3) + 'y');
	if (word.endsWith('ves')) {
		add(word.slice(0, -3) + 'f');
		add(word.slice(0, -3) + 'fe');
	}
	if (word.endsWith('es')) add(word.slice(0, -2));
	if (word.endsWith('s') && !word.endsWith('ss')) add(word.slice(0, -1));
	for (const suffix of ['ing', 'ed']) {
		if (!word.endsWith(suffix)) continue;
		const base = word.slice(0, -suffix.length);
		add(base);
		add(base + 'e');
		if (base.length > 2 && base.at(-1) === base.at(-2)) add(base.slice(0, -1));
		if (base.endsWith('i') && suffix === 'ed') add(base.slice(0, -1) + 'y');
	}
	if (word.endsWith('er') || word.endsWith('est')) {
		const base = word.slice(0, word.endsWith('er') ? -2 : -3);
		add(base);
		add(base + 'e');
		if (base.length > 2 && base.at(-1) === base.at(-2)) add(base.slice(0, -1));
	}
	return stems.find(isWord) ?? word;
}

export type MoveCode = 'too_short' | 'not_a_word' | 'bad_start' | 'repeat' | 'blocked';

export type Move =
	| { ok: true; word: string; lemma: string; endsDead: boolean }
	| { ok: false; code: MoveCode; message: string };

export interface MoveContext {
	/** The previous word, or null for the first word of a game. */
	prev: string | null;
	/** Lemmas already played in this game. */
	used: ReadonlySet<string>;
	deadLetter: string;
	hard?: boolean;
	isWord: (w: string) => boolean;
	isBlocked?: (w: string) => boolean;
}

/**
 * Judge one typed word. A word that ends in the dead letter is legal: the
 * caller decides what that costs (a lost turn in a Round, the end of the
 * chain in Chain mode).
 */
export function judgeMove(raw: string, ctx: MoveContext): Move {
	const word = normalizeWord(raw);
	if (!word) {
		return {
			ok: false,
			code: 'too_short',
			message: `a word is letters only, at least ${MIN_WORD_LENGTH} long`,
		};
	}
	if (!ctx.isWord(word)) {
		return { ok: false, code: 'not_a_word', message: `**${word}** is not in the dictionary` };
	}
	if (ctx.isBlocked?.(word)) {
		return { ok: false, code: 'blocked', message: `**${word}** is not allowed here` };
	}
	if (ctx.prev) {
		const need = requiredStart(ctx.prev, ctx.hard);
		if (!word.startsWith(need)) {
			return { ok: false, code: 'bad_start', message: `must start with **${need}**` };
		}
	}
	const lemma = lemmaOf(word, ctx.isWord);
	if (ctx.used.has(lemma) || ctx.used.has(word)) {
		return { ok: false, code: 'repeat', message: `**${word}** was already used` };
	}
	return { ok: true, word, lemma, endsDead: word.endsWith(ctx.deadLetter) };
}
