import { describe, it, expect } from 'vitest';
import { intParam } from '$lib/server/query-params';

const u = (q: string) => new URL(`http://x/?${q}`);

describe('intParam', () => {
	it('uses the fallback for missing or junk values', () => {
		expect(intParam(u(''), 'limit', 50, 1, 100)).toBe(50);
		expect(intParam(u('limit=abc'), 'limit', 50, 1, 100)).toBe(50);
	});
	it('clamps below the minimum and above the maximum', () => {
		expect(intParam(u('limit=-1'), 'limit', 50, 1, 100)).toBe(1);
		expect(intParam(u('limit=0'), 'limit', 50, 1, 100)).toBe(1);
		expect(intParam(u('limit=9999'), 'limit', 50, 1, 100)).toBe(100);
		expect(intParam(u('offset=-5'), 'offset', 0, 0)).toBe(0);
	});
	it('passes valid values through', () => {
		expect(intParam(u('limit=25'), 'limit', 50, 1, 100)).toBe(25);
	});
});
