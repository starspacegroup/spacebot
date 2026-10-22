import { describe, expect, it } from 'vitest';
import { load } from '../routes/admin/[serverId]/stats/vc-activity/+page.server.js';

const run = (query: string) => {
	try {
		load({
			params: { serverId: '1477001961042870467' },
			url: new URL(
				`https://spacebot.test/admin/1477001961042870467/stats/vc-activity${query}`
			),
		} as any);
	} catch (thrown: any) {
		return thrown;
	}
	throw new Error('expected a redirect');
};

describe('the old VC activity URL', () => {
	it('redirects to the Voice tab of the Statistics page', () => {
		const r = run('');
		expect(r.status).toBe(301);
		expect(r.location).toBe('/admin/1477001961042870467/stats?tab=voice');
	});

	it('keeps a shared filtered view', () => {
		const r = run('?search=riker&eventType=join&startDate=2026-10-01');
		expect(r.status).toBe(301);
		const target = new URL(r.location, 'https://spacebot.test');
		expect(target.pathname).toBe('/admin/1477001961042870467/stats');
		expect(target.searchParams.get('tab')).toBe('voice');
		expect(target.searchParams.get('search')).toBe('riker');
		expect(target.searchParams.get('eventType')).toBe('join');
		expect(target.searchParams.get('startDate')).toBe('2026-10-01');
	});

	it('does not let a query string choose another tab', () => {
		expect(run('?tab=automations').location).toContain('tab=voice');
	});
});
