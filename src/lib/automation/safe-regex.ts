/**
 * Tenant-supplied regex filters (security review 2026-10-20, #10).
 *
 * Patterns run on the shared event loop, so a backtracking engine lets one
 * guild's `(a+)+$` stall every guild. Filters run on RE2 (re2js, pure JS,
 * linear time in the input), which has no backreferences or lookaround —
 * patterns using them fail to compile and never match. Pattern and input
 * lengths are capped as well.
 */

import { RE2JS } from 're2js';

export const MAX_PATTERN_LENGTH = 500;
export const MAX_INPUT_LENGTH = 4000;

const cache = new Map<string, RE2JS | null>();

export function compileSafeRegex(pattern: unknown): RE2JS | null {
	if (typeof pattern !== 'string' || !pattern || pattern.length > MAX_PATTERN_LENGTH) return null;
	if (cache.has(pattern)) return cache.get(pattern)!;
	let compiled: RE2JS | null = null;
	try {
		compiled = RE2JS.compile(pattern, RE2JS.CASE_INSENSITIVE);
	} catch {
		compiled = null;
	}
	if (cache.size > 500) cache.clear();
	cache.set(pattern, compiled);
	return compiled;
}

export function safeRegexTest(pattern: unknown, input: unknown): boolean {
	const regex = compileSafeRegex(pattern);
	if (!regex) return false;
	return regex.matcher(String(input ?? '').slice(0, MAX_INPUT_LENGTH)).find();
}
