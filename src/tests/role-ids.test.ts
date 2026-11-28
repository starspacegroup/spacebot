import { describe, it, expect } from 'vitest';
import { parseRoleIds } from '$lib/server/role-ids';

describe('parseRoleIds', () => {
	it('keeps real role ids and drops junk and repeats', () => {
		const a = '123456789012345678';
		const b = '223456789012345678';
		expect(parseRoleIds(` ${a}, nope,${b},${a},12 `)).toEqual([a, b]);
	});
	it('answers an empty list for nothing', () => {
		expect(parseRoleIds(null)).toEqual([]);
		expect(parseRoleIds('')).toEqual([]);
	});
	it('stops at 50', () => {
		const many = Array.from({ length: 80 }, (_, i) =>
			String(100000000000000000n + BigInt(i))
		).join(',');
		expect(parseRoleIds(many)).toHaveLength(50);
	});
});
