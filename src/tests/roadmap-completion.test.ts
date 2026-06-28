import { describe, expect, it } from 'vitest';
import { buildInviteUrl, externalLinkState } from '$lib/community.js';
import { mergeBranding, validateBranding } from '$lib/db/branding.js';
import { deriveBadges } from '$lib/db/profiles.js';
import { normalizeLocale, resolveLocale, t } from '$lib/i18n.js';
import { getRouteGroup, isRateLimitExempt, rateLimitIdentity } from '$lib/server/rate-limit.js';
import { statsExportToCsv } from '$lib/server/stats-export.js';

describe('i18n locale resolution', () => {
	it('prefers explicit cookie locale and falls back to English', () => {
		expect(resolveLocale({ cookie: 'es', acceptLanguage: 'en-US' })).toBe('es');
		expect(normalizeLocale('fr')).toBe('en');
		expect(t('es', 'nav.invite')).toBe('Invitar');
	});
});

describe('branding validation', () => {
	it('accepts safe image URLs and hex colors', () => {
		const result = validateBranding({
			display_name: 'Orbit Guild',
			accent_color: '#5865f2',
			logo_url: '/logo.webp',
			banner_url: 'https://example.com/banner.avif',
		});
		expect(result.ok).toBe(true);
		expect(result.value.display_name).toBe('Orbit Guild');
	});

	it('rejects unsafe branding values and merges defaults', () => {
		expect(
			validateBranding({ accent_color: 'purple', logo_url: 'javascript:alert(1)' }).ok
		).toBe(false);
		expect(mergeBranding(null).display_name).toBe('SpaceBot');
	});
});

describe('stats export formats', () => {
	it('renders CSV with section labels and escaped values', () => {
		const csv = statsExportToCsv({
			server_stats: [{ member_count: 10, recorded_at: 'now' }],
			aggregated_stats: [{ period_type: 'daily', message_count: 3 }],
			voice_sessions: [{ user_id: 'u1', channel_name: 'General, Voice' }],
		});
		expect(csv).toContain('section,member_count,recorded_at');
		expect(csv).toContain('"General, Voice"');
	});
});

describe('rate-limit policies', () => {
	it('classifies route groups and exempts signed/realtime paths', () => {
		expect(getRouteGroup('/api/v1/stats')).toBe('external-api');
		expect(getRouteGroup('/api/discord/interactions')).toBe('discord-interactions');
		expect(
			isRateLimitExempt(
				new Request('https://x.test/api/discord/interactions'),
				'/api/discord/interactions'
			)
		).toBe(true);
		expect(
			isRateLimitExempt(
				new Request('https://x.test/api/runner/ws', { headers: { upgrade: 'websocket' } }),
				'/api/runner/ws'
			)
		).toBe(true);
	});

	it('keys by bearer prefix before IP/cookie fallback', () => {
		const event = {
			request: new Request('https://x.test/api/v1/stats', {
				headers: { authorization: 'Bearer sb_live_abcdefghijklmnop' },
			}),
			cookies: { get: () => null },
		};
		expect(rateLimitIdentity(event)).toBe('bearer:sb_live_abcdefgh');
	});
});

describe('community pages', () => {
	it('builds Discord invite URLs only when configured', () => {
		expect(buildInviteUrl(undefined)).toBeNull();
		expect(buildInviteUrl('123', '32')).toContain('client_id=123');
		expect(externalLinkState('', 'PUBLIC_SUPPORT_DISCORD_URL').enabled).toBe(false);
	});
});

describe('profile badges', () => {
	it('derives badges from aggregate activity', () => {
		expect(deriveBadges({ command_count: 120, voice_seconds: 40000 })).toEqual([
			'Command regular',
			'Voice regular',
		]);
	});
});
