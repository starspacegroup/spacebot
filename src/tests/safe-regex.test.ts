import { describe, expect, it } from 'vitest';
import {
	compileSafeRegex,
	safeRegexTest,
	MAX_PATTERN_LENGTH,
} from '../lib/automation/safe-regex.js';

const CATASTROPHIC = [
	'(a+)+$',
	'(a*)*b',
	'(a|a)*$',
	'(a|aa)+$',
	'(.*a){12}',
	'a*a*a*a*b',
	'(\\w+\\s?)+$',
];

describe('tenant regex filters run in linear time', () => {
	it.each(CATASTROPHIC)('%s on hostile input finishes quickly', (pattern) => {
		const start = performance.now();
		safeRegexTest(pattern, 'a'.repeat(4000) + '!');
		safeRegexTest(pattern, 'a '.repeat(2000) + '!');
		expect(performance.now() - start).toBeLessThan(500);
	});

	it.each(['(a)\\1', '(?=a)a', '(?<!a)b', '(unclosed', 'x'.repeat(MAX_PATTERN_LENGTH + 1)])(
		'unsupported or oversized pattern %s never matches',
		(pattern) => {
			expect(compileSafeRegex(pattern)).toBeNull();
			expect(safeRegexTest(pattern, 'aaa')).toBe(false);
		}
	);

	it('common filters behave as before (case-insensitive, unanchored)', () => {
		expect(safeRegexTest('^hello', 'HELLO there')).toBe(true);
		expect(safeRegexTest('discord\\.gg/\\w+', 'join discord.gg/abc now')).toBe(true);
		expect(safeRegexTest('spam|scam', 'not this')).toBe(false);
	});

	it('caps input length', () => {
		expect(safeRegexTest('needle$', 'x'.repeat(10000) + 'needle')).toBe(false);
	});
});
