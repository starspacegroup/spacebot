import { describe, expect, it } from 'vitest';
import {
	ANALYTICS_SCRIPT_HOSTS,
	applySecurityHeaders,
	buildContentSecurityPolicy,
	isPublicMarketingPath,
	pageCacheControl,
} from '../lib/server/security-headers.js';

const html = () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } });

describe('HSTS', () => {
	it('is sent on pages for a year, without includeSubDomains or preload', () => {
		const res = applySecurityHeaders(html());
		expect(res.headers.get('Strict-Transport-Security')).toBe('max-age=31536000');
	});
	it('is not added to JSON or other non-page responses', () => {
		const res = applySecurityHeaders(
			new Response('{}', { headers: { 'content-type': 'application/json' } })
		);
		expect(res.headers.has('Strict-Transport-Security')).toBe(false);
	});
});

describe('the content-security policy', () => {
	const csp = buildContentSecurityPolicy();
	it('lets the two analytics scripts run (they were blocked when it was only reporting)', () => {
		const script = csp.split('; ').find((d) => d.startsWith('script-src'))!;
		for (const host of ANALYTICS_SCRIPT_HOSTS.split(' ')) expect(script).toContain(host);
	});
	it('never allows eval or a wildcard script source', () => {
		const script = csp.split('; ').find((d) => d.startsWith('script-src'))!;
		expect(script).not.toContain('unsafe-eval');
		expect(script).not.toMatch(/\s\*(\s|$)/);
	});
	it('is enforced on public pages and only reports on the rest', () => {
		const enforced = applySecurityHeaders(html(), { cspReportOnly: false });
		expect(enforced.headers.has('Content-Security-Policy')).toBe(true);
		expect(enforced.headers.has('Content-Security-Policy-Report-Only')).toBe(false);
		const reporting = applySecurityHeaders(html(), { cspReportOnly: true });
		expect(reporting.headers.has('Content-Security-Policy-Report-Only')).toBe(true);
		expect(reporting.headers.has('Content-Security-Policy')).toBe(false);
	});
});

describe('which pages are public marketing pages', () => {
	it('lists the pages anyone can open', () => {
		for (const p of [
			'/',
			'/status',
			'/status/',
			'/servers',
			'/servers/1009583217948491928',
			'/docs',
			'/docs/dev',
			'/docs/dev/architecture',
			'/support',
			'/vote',
			'/invite',
			'/privacy',
			'/terms',
			'/ideas',
			'/leaderboards',
		]) {
			expect(isPublicMarketingPath(p), p).toBe(true);
		}
	});
	it('leaves out everything that needs a login, runs a flow or is an API', () => {
		for (const p of [
			'/admin',
			'/admin/123/stats',
			'/account',
			'/activity',
			'/login',
			'/connect',
			'/profile/1/2',
			'/api/status',
			'/install-bot',
			'/servers/1/extra',
			'/statusx',
			'/docsx',
		]) {
			expect(isPublicMarketingPath(p), p).toBe(false);
		}
	});
});

describe('page caching', () => {
	const base = { method: 'GET', status: 200, pathname: '/status', loggedIn: false, html: true };
	it('lets a signed-out visitor keep a public page for the back button, but must revalidate', () => {
		expect(pageCacheControl(base)).toBe('private, no-cache');
	});
	it('keeps everything else no-store', () => {
		const strict = 'no-cache, no-store, must-revalidate';
		expect(pageCacheControl({ ...base, loggedIn: true })).toBe(strict);
		expect(pageCacheControl({ ...base, method: 'POST' })).toBe(strict);
		expect(pageCacheControl({ ...base, status: 404 })).toBe(strict);
		expect(pageCacheControl({ ...base, status: 302 })).toBe(strict);
		expect(pageCacheControl({ ...base, pathname: '/admin' })).toBe(strict);
		expect(pageCacheControl({ ...base, pathname: '/account' })).toBe(strict);
		expect(pageCacheControl({ ...base, html: false })).toBe(strict);
	});
	it('never lets a shared cache keep a page', () => {
		expect(pageCacheControl(base)).toContain('private');
		expect(pageCacheControl(base)).not.toContain('public');
		expect(pageCacheControl(base)).not.toMatch(/max-age|s-maxage/);
	});
});
