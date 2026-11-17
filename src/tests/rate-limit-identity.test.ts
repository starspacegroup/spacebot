/**
 * Security review 2026-11-05: the limiter identity must not come from a
 * cookie the client sets.
 */
import { describe, expect, it } from 'vitest';
import { rateLimitIdentity } from '../lib/server/rate-limit.js';

describe('rateLimitIdentity', () => {
	const ev = (
		headers: Record<string, string>,
		locals: any = {},
		cookie: string | null = null
	) => ({
		request: new Request('https://x.test/api/x', { headers }),
		cookies: { get: () => cookie },
		locals,
	});

	it('ignores the client-set discord_user_id cookie', () => {
		expect(rateLimitIdentity(ev({ 'cf-connecting-ip': '1.2.3.4' }, {}, 'spoofed-id'))).toBe(
			'ip:1.2.3.4'
		);
	});

	it('uses the verified session user, then the edge IP', () => {
		expect(rateLimitIdentity(ev({ 'cf-connecting-ip': '1.2.3.4' }, { userId: '42' }))).toBe(
			'user:42'
		);
		expect(rateLimitIdentity(ev({}))).toBe('anonymous');
	});

	it('keeps the bearer prefix bucket first', () => {
		expect(
			rateLimitIdentity(
				ev({ authorization: 'Bearer sb_live_abcdefghijklmnop' }, { userId: '42' })
			)
		).toBe('bearer:sb_live_abcdefgh');
	});
});
