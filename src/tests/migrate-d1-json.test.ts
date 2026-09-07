/**
 * A production build re-applied 37 migrations and said nothing about why.
 *
 * The runner found applied migrations by regex-scraping Wrangler's console
 * output inside a `try {} catch {}` with an empty body. A failed read and an
 * empty tracking table produced the same answer — "nothing is applied" — so
 * every migration ran again, taking minutes and touching the live schema.
 *
 * The read is JSON now, and unreadable output raises instead of resolving to
 * an empty set. These tests hold that distinction.
 */
import { describe, expect, it } from 'vitest';
import { columnValues, parseD1Rows } from '../../scripts/lib/d1-json';

const wranglerResponse = JSON.stringify([
	{
		results: [{ name: '0001_create_event_logs.sql' }, { name: '0002_create_automations.sql' }],
		success: true,
		meta: { duration: 0 },
	},
]);

describe('parseD1Rows', () => {
	it('reads the rows out of a normal response', () => {
		expect(parseD1Rows(wranglerResponse)).toEqual([
			{ name: '0001_create_event_logs.sql' },
			{ name: '0002_create_automations.sql' },
		]);
	});

	it('accepts the unwrapped object shape too', () => {
		expect(parseD1Rows(JSON.stringify({ results: [{ n: 3 }] }))).toEqual([{ n: 3 }]);
	});

	it('returns an empty list for an empty table', () => {
		// A fact, not a failure — nothing is recorded yet.
		expect(parseD1Rows(JSON.stringify([{ results: [], success: true }]))).toEqual([]);
	});

	it('raises rather than reporting an empty table when the output is not JSON', () => {
		// The whole bug: this used to be indistinguishable from "no migrations
		// are applied", and the caller swallowed it.
		expect(() => parseD1Rows('✘ [ERROR] The given account is not valid')).toThrow(/not JSON/);
	});

	it('raises when the response carries no result set', () => {
		expect(() => parseD1Rows(JSON.stringify([{ success: false, error: 'nope' }]))).toThrow(
			/no result set/
		);
	});

	it('raises on an empty response', () => {
		expect(() => parseD1Rows('')).toThrow(/Empty response/);
		expect(() => parseD1Rows('   ')).toThrow(/Empty response/);
	});
});

describe('columnValues', () => {
	it('pulls one column from every row', () => {
		expect(columnValues(parseD1Rows(wranglerResponse), 'name')).toEqual([
			'0001_create_event_logs.sql',
			'0002_create_automations.sql',
		]);
	});

	it('skips rows with no value for the column', () => {
		expect(columnValues([{ name: 'a' }, {}, { name: null }, { name: 'b' }], 'name')).toEqual([
			'a',
			'b',
		]);
	});

	it('stringifies non-string values', () => {
		expect(columnValues([{ n: 65 }], 'n')).toEqual(['65']);
	});
});
