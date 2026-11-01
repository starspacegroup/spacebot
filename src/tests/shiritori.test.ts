import { describe, expect, it } from 'vitest';
import {
	DEAD_LETTERS,
	drawDeadLetter,
	judgeMove,
	lemmaOf,
	normalizeWord,
	requiredStart,
} from '../lib/server/shiritori.js';
import {
	dictionarySize,
	isBlocked,
	isWord,
	lemma,
	seedWord,
} from '../lib/server/shiritori-dict.js';

const ctx = (over: Partial<Parameters<typeof judgeMove>[1]> = {}) => ({
	prev: null,
	used: new Set<string>(),
	deadLetter: 'x',
	isWord,
	isBlocked,
	...over,
});

describe('normalizeWord', () => {
	it('keeps one lower-case word of three letters or more', () => {
		expect(normalizeWord('  Star ')).toBe('star');
		expect(normalizeWord('to')).toBeNull();
		expect(normalizeWord('two words')).toBeNull();
		expect(normalizeWord("don't")).toBeNull();
		expect(normalizeWord('star9')).toBeNull();
		expect(normalizeWord('https://x.io')).toBeNull();
	});
});

describe('requiredStart', () => {
	it('is the last letter, or the last two in hard mode', () => {
		expect(requiredStart('star')).toBe('r');
		expect(requiredStart('star', true)).toBe('ar');
	});
});

describe('dictionary', () => {
	it('holds a real word list', () => {
		expect(dictionarySize()).toBeGreaterThan(70000);
		expect(isWord('galaxy')).toBe(true);
		expect(isWord('zzzqq')).toBe(false);
	});

	it('holds no proper nouns or contractions', () => {
		expect(isWord('london')).toBe(false);
		expect(isWord("don't")).toBe(false);
	});

	it('blocks strong words and their forms', () => {
		expect(isBlocked('fucking')).toBe(true);
		expect(isBlocked('galaxy')).toBe(false);
	});

	it('draws a clean seed word that is not a trap', () => {
		for (let i = 0; i < 50; i++) {
			const w = seedWord('x');
			expect(isWord(w)).toBe(true);
			expect(isBlocked(w)).toBe(false);
			expect(w.endsWith('x')).toBe(false);
			expect(w.length).toBeGreaterThanOrEqual(4);
		}
	});
});

describe('lemmaOf', () => {
	it('folds plurals and simple inflections onto the base word', () => {
		expect(lemma('stars')).toBe('star');
		expect(lemma('ponies')).toBe('pony');
		expect(lemma('boxes')).toBe('box');
		expect(lemma('stopped')).toBe('stop');
		expect(lemma('making')).toBe('make');
		expect(lemma('wolves')).toBe('wolf');
	});

	it('leaves a word whose stem is not a word alone', () => {
		expect(lemma('bus')).toBe('bus');
		expect(lemma('glass')).toBe('glass');
		expect(lemmaOf('xyzs', () => false)).toBe('xyzs');
	});
});

describe('judgeMove', () => {
	it('accepts the first word of a game with no letter rule', () => {
		const m = judgeMove('Galaxy', ctx());
		expect(m).toMatchObject({ ok: true, word: 'galaxy', endsDead: false });
	});

	it('refuses a word that does not start with the last letter', () => {
		const m = judgeMove('apple', ctx({ prev: 'star' }));
		expect(m).toMatchObject({ ok: false, code: 'bad_start' });
	});

	it('uses two letters in hard mode', () => {
		expect(judgeMove('rocket', ctx({ prev: 'star', hard: true }))).toMatchObject({
			ok: false,
			code: 'bad_start',
		});
		expect(judgeMove('arrow', ctx({ prev: 'star', hard: true }))).toMatchObject({ ok: true });
	});

	it('refuses repeats, including inflections', () => {
		const used = new Set(['star']);
		expect(judgeMove('stars', ctx({ used }))).toMatchObject({ ok: false, code: 'repeat' });
		expect(judgeMove('star', ctx({ used }))).toMatchObject({ ok: false, code: 'repeat' });
	});

	it('refuses non-words, short words and blocked words', () => {
		expect(judgeMove('qwzzt', ctx())).toMatchObject({ ok: false, code: 'not_a_word' });
		expect(judgeMove('ab', ctx())).toMatchObject({ ok: false, code: 'too_short' });
		expect(judgeMove('fucking', ctx())).toMatchObject({ ok: false, code: 'blocked' });
	});

	it('flags a word that ends in the dead letter, and still accepts it', () => {
		const m = judgeMove('relax', ctx({ prev: 'star' }));
		expect(m).toMatchObject({ ok: true, word: 'relax', endsDead: true });
	});
});

describe('drawDeadLetter', () => {
	it('draws from the hard enders by default', () => {
		for (let i = 0; i < 30; i++) expect(DEAD_LETTERS).toContain(drawDeadLetter());
	});

	it('honours a custom pool and falls back when it is empty', () => {
		expect(drawDeadLetter(['k'], () => 0.5)).toBe('k');
		expect(DEAD_LETTERS).toContain(drawDeadLetter(['!!'], () => 0));
	});
});
