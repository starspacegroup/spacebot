/**
 * The Shiritori dictionary: offline, deterministic, no LLM. Built from SCOWL
 * size 60 (shiritori-words.generated.ts). The Set is built on first use and
 * kept for the life of the isolate or process.
 */
import { SHIRITORI_WORDS } from './shiritori-words.generated.js';
import { lemmaOf } from './shiritori.js';

let words: Set<string> | null = null;
let byLetter: Map<string, string[]> | null = null;

function load() {
	if (!words) {
		const list = SHIRITORI_WORDS.split('\n');
		words = new Set(list);
		byLetter = new Map();
		for (const w of list) {
			const bucket = byLetter.get(w[0]);
			if (bucket) bucket.push(w);
			else byLetter.set(w[0], [w]);
		}
	}
	return { words: words as Set<string>, byLetter: byLetter as Map<string, string[]> };
}

export const isWord = (w: string) => load().words.has(w);
export const lemma = (w: string) => lemmaOf(w, isWord);
export const dictionarySize = () => load().words.size;

/**
 * Words and their forms that never go on the board. SCOWL carries the strong
 * ones, so a prefix match on the stem also catches `-ing`, `-er` and `-s`.
 */
const BLOCKED_STEMS = ['fuck', 'cunt', 'shit', 'nigg', 'fagg', 'whore', 'bitch', 'rape', 'twat'];

export const isBlocked = (w: string) => BLOCKED_STEMS.some((s) => w.startsWith(s));

/**
 * A word to start a chain: four to seven letters, clean, and not ending in the
 * dead letter, so the first move is never a trap.
 */
export function seedWord(deadLetter: string, rand = Math.random): string {
	const { byLetter } = load();
	const letters = [...byLetter.keys()];
	for (let i = 0; i < 200; i++) {
		const bucket = byLetter.get(letters[Math.floor(rand() * letters.length)]) as string[];
		const w = bucket[Math.floor(rand() * bucket.length)];
		if (
			w.length >= 4 &&
			w.length <= 7 &&
			!w.endsWith(deadLetter) &&
			!isBlocked(w) &&
			lemma(w) === w
		) {
			return w;
		}
	}
	return 'galaxy';
}
