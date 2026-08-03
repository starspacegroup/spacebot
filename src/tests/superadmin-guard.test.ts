/**
 * The superadmin allowlist check.
 *
 * This was previously copy-pasted into ~36 route files. Those copies were
 * behaviourally identical but all carried a bare `process.env` fallback, which
 * is a ReferenceError on the Workers runtime whenever the platform binding is
 * absent — exactly one copy had ever been given the `typeof process` guard.
 * They now all call this, so it is worth pinning the behaviour down.
 */
import { describe, expect, it } from 'vitest';
import { checkIsSuperAdmin } from '../lib/server/superadmin-guard.js';

/** A Workers-style platform object. `{}` means the binding is missing. */
const platform = (adminUserIds?: string) => ({
	env: adminUserIds === undefined ? {} : { ADMIN_USER_IDS: adminUserIds },
});

describe('checkIsSuperAdmin', () => {
	it('admits an id present in the allowlist', () => {
		expect(checkIsSuperAdmin('111', platform('111'))).toBe(true);
		expect(checkIsSuperAdmin('222', platform('111,222,333'))).toBe(true);
	});

	it('tolerates whitespace around entries', () => {
		expect(checkIsSuperAdmin('222', platform(' 111 , 222 , 333 '))).toBe(true);
	});

	it('rejects an id that is not listed', () => {
		expect(checkIsSuperAdmin('333', platform('111,222'))).toBe(false);
	});

	it('does not treat a substring as a match', () => {
		// The check must be exact per entry, not a prefix/contains test —
		// otherwise "111" would authorise against an allowlist of "1112".
		expect(checkIsSuperAdmin('111', platform('1112'))).toBe(false);
		expect(checkIsSuperAdmin('1112', platform('111'))).toBe(false);
	});

	it('rejects when the allowlist is empty or unset', () => {
		expect(checkIsSuperAdmin('111', platform(''))).toBe(false);
		expect(checkIsSuperAdmin('111', platform(undefined))).toBe(false);
		expect(checkIsSuperAdmin('111', {} as any)).toBe(false);
		expect(checkIsSuperAdmin('111', null as any)).toBe(false);
	});

	it('rejects when there is no user id', () => {
		expect(checkIsSuperAdmin(undefined, platform('111'))).toBe(false);
		expect(checkIsSuperAdmin('', platform('111'))).toBe(false);
		expect(checkIsSuperAdmin(null as any, platform('111'))).toBe(false);
	});

	it('does not throw when the platform binding is missing', () => {
		// The reason for consolidating: a bare `process.env` fallback throws
		// ReferenceError on Workers, which took down a settings page during
		// development when the env var was not bound.
		expect(() => checkIsSuperAdmin('111', {} as any)).not.toThrow();
		expect(() => checkIsSuperAdmin('111', undefined as any)).not.toThrow();
	});

	it('ignores empty entries produced by stray commas', () => {
		expect(checkIsSuperAdmin('', platform('111,,222'))).toBe(false);
		expect(checkIsSuperAdmin('222', platform('111,,222'))).toBe(true);
	});
});
