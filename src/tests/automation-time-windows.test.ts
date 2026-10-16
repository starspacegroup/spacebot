import { describe, it, expect } from 'vitest';
import { matchesFilters } from '../lib/automation/engine.js';
import { matchesTimeWindows, isValidZone } from '../lib/automation/time-windows.js';
import { FILTER_TYPES, filterAppliesToEvent } from '../lib/db/automations.js';
import { clearFilterReferences } from '../lib/import-export.js';

const PHX = 'America/Phoenix'; // UTC-7, no DST
const NY = 'America/New_York'; // UTC-5 / UTC-4 with DST

const at = (created_at: string) => ({ created_at });
const win = (windows: any[], extra: Record<string, unknown> = {}) => ({ windows, ...extra });

describe('time_windows filter', () => {
	it('matches inside a plain window and not outside it', () => {
		const f = win([{ start: '08:00', end: '22:00' }]);
		// 15:00 UTC = 08:00 Phoenix
		expect(matchesTimeWindows(f, at('2026-03-10T15:00:00Z'), PHX)).toBe(true);
		// 14:59 UTC = 07:59 Phoenix
		expect(matchesTimeWindows(f, at('2026-03-10T14:59:00Z'), PHX)).toBe(false);
		// end is exclusive: 05:00 UTC next day = 22:00 Phoenix
		expect(matchesTimeWindows(f, at('2026-03-11T05:00:00Z'), PHX)).toBe(false);
	});

	it('evaluates in the guild zone, not the runtime zone', () => {
		const f = win([{ start: '19:00', end: '23:00' }]);
		expect(matchesTimeWindows(f, at('2026-03-11T02:00:00Z'), PHX)).toBe(true); // 19:00 Phoenix
		expect(matchesTimeWindows(f, at('2026-03-11T02:00:00Z'), 'UTC')).toBe(false);
	});

	it('handles a window that crosses midnight', () => {
		const f = win([{ start: '22:00', end: '02:00' }]);
		expect(matchesTimeWindows(f, at('2026-03-10T23:30:00Z'), 'UTC')).toBe(true);
		expect(matchesTimeWindows(f, at('2026-03-11T01:00:00Z'), 'UTC')).toBe(true);
		expect(matchesTimeWindows(f, at('2026-03-10T12:00:00Z'), 'UTC')).toBe(false);
		expect(matchesTimeWindows(f, at('2026-03-11T02:00:00Z'), 'UTC')).toBe(false);
	});

	it('keeps 19:00-23:00 local on both sides of the DST change', () => {
		const f = win([{ start: '19:00', end: '23:00' }]);
		// New York springs forward 2026-03-08. 19:00 local is 00:00Z before, 23:00Z after.
		expect(matchesTimeWindows(f, at('2026-03-08T00:30:00Z'), NY)).toBe(true); // 19:30 EST (Mar 7)
		expect(matchesTimeWindows(f, at('2026-03-09T23:30:00Z'), NY)).toBe(true); // 19:30 EDT
		expect(matchesTimeWindows(f, at('2026-03-09T22:30:00Z'), NY)).toBe(false); // 18:30 EDT
		expect(matchesTimeWindows(f, at('2026-03-09T03:30:00Z'), NY)).toBe(false); // 23:30 EDT, past the end
	});

	it('applies days per window; no days means every day', () => {
		const f = win([{ days: ['tue', 'thu'], start: '19:00', end: '23:00' }]);
		expect(matchesTimeWindows(f, at('2026-03-10T20:00:00Z'), 'UTC')).toBe(true); // Tue
		expect(matchesTimeWindows(f, at('2026-03-11T20:00:00Z'), 'UTC')).toBe(false); // Wed
		const any = win([{ start: '19:00', end: '23:00' }]);
		expect(matchesTimeWindows(any, at('2026-03-11T20:00:00Z'), 'UTC')).toBe(true);
	});

	it('attributes the after-midnight part of a window to the day it started', () => {
		const f = win([{ days: ['sat'], start: '22:00', end: '02:00' }]);
		expect(matchesTimeWindows(f, at('2026-03-15T01:00:00Z'), 'UTC')).toBe(true); // Sun 01:00
		expect(matchesTimeWindows(f, at('2026-03-14T01:00:00Z'), 'UTC')).toBe(false); // Sat 01:00
	});

	it('exclude mode inverts the result', () => {
		const f = win([{ start: '00:00', end: '06:00' }], { mode: 'exclude' });
		expect(matchesTimeWindows(f, at('2026-03-10T03:00:00Z'), 'UTC')).toBe(false);
		expect(matchesTimeWindows(f, at('2026-03-10T12:00:00Z'), 'UTC')).toBe(true);
	});

	it('any one of several windows is enough', () => {
		const f = win([
			{ days: ['tue'], start: '19:00', end: '23:00' },
			{ days: ['sat', 'sun'], start: '10:00', end: '14:00' },
		]);
		expect(matchesTimeWindows(f, at('2026-03-14T11:00:00Z'), 'UTC')).toBe(true); // Sat
		expect(matchesTimeWindows(f, at('2026-03-13T11:00:00Z'), 'UTC')).toBe(false); // Fri
	});

	it('per-automation timezone wins over the guild zone', () => {
		const f = win([{ start: '19:00', end: '23:00' }], { timezone: PHX });
		expect(matchesTimeWindows(f, at('2026-03-11T02:00:00Z'), 'UTC')).toBe(true);
	});

	it('refuses fixed-offset zone names and falls back to UTC', () => {
		expect(isValidZone('EST5EDT')).toBe(false);
		expect(isValidZone('MST')).toBe(false);
		expect(isValidZone('America/Phoenix')).toBe(true);
		const f = win([{ start: '19:00', end: '23:00' }]);
		// 02:00Z is outside in UTC; a bad zone must not shift it
		expect(matchesTimeWindows(f, at('2026-03-11T02:00:00Z'), 'MST')).toBe(false);
	});

	it('uses the clock passed in when the event has no created_at', () => {
		const f = win([{ start: '08:00', end: '09:00' }]);
		expect(matchesTimeWindows(f, {}, 'UTC', new Date('2026-03-10T08:30:00Z'))).toBe(true);
		expect(matchesTimeWindows(f, {}, 'UTC', new Date('2026-03-10T12:00:00Z'))).toBe(false);
	});

	it('accepts the JSON string the editor submits, and ignores empty or broken values', () => {
		const json = JSON.stringify(win([{ start: '08:00', end: '09:00' }]));
		expect(matchesTimeWindows(json, at('2026-03-10T08:30:00Z'), 'UTC')).toBe(true);
		expect(matchesTimeWindows(json, at('2026-03-10T12:00:00Z'), 'UTC')).toBe(false);
		expect(matchesTimeWindows('not json', at('2026-03-10T12:00:00Z'), 'UTC')).toBe(true);
		expect(matchesTimeWindows(win([]), at('2026-03-10T12:00:00Z'), 'UTC')).toBe(true);
	});
});

describe('time_windows in matchesFilters', () => {
	const event = {
		guild_id: '1',
		event_type: 'MEMBER_JOIN',
		actor_id: '2',
		created_at: '2026-03-11T02:00:00Z',
	};
	const filters = { time_windows: win([{ start: '19:00', end: '23:00' }]) };

	it('reads the zone from the filter context', () => {
		expect(matchesFilters(event, filters, { timezone: PHX })).toBe(true);
		expect(matchesFilters(event, filters, { timezone: 'UTC' })).toBe(false);
		expect(matchesFilters(event, filters)).toBe(false); // no zone: UTC
	});

	it('combines with other filters', () => {
		expect(matchesFilters(event, { ...filters, actor_id: '999' }, { timezone: PHX })).toBe(
			false
		);
	});

	it('leaves automations without the filter untouched', () => {
		expect(matchesFilters(event, {})).toBe(true);
	});
});

describe('time_windows registration', () => {
	it('applies to every event', () => {
		expect(FILTER_TYPES.time_windows.type).toBe('time_windows');
		expect(filterAppliesToEvent(FILTER_TYPES.time_windows, 'MEMBER_JOIN')).toBe(true);
		expect(filterAppliesToEvent(FILTER_TYPES.time_windows, 'GITHUB_STAR')).toBe(true);
	});

	it('survives export/import: it holds no server ids, so nothing is cleared', () => {
		const filters = { time_windows: win([{ days: ['tue'], start: '19:00', end: '23:00' }]) };
		const { cleaned, cleared } = clearFilterReferences(filters);
		expect(cleared).toEqual([]);
		expect(cleaned).toEqual(filters);
	});
});
