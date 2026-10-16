/**
 * Time-window filter for automation triggers: "only between 8am and 10pm",
 * "only Tue/Thu evenings", "not during quiet hours".
 *
 * Pure and runtime-neutral (Workers and the Node gateway both import it).
 * Windows resolve through a named IANA zone at evaluation time, so a
 * 19:00-23:00 window stays 19:00-23:00 local across DST changes.
 */
import { parseUTCDate } from '../timezone.js';

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export interface TimeWindow {
	days?: string[];
	start: string;
	end: string;
}

export interface TimeWindowsFilter {
	mode?: 'include' | 'exclude';
	timezone?: string | null;
	windows: TimeWindow[];
}

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function toMinutes(value: string): number | null {
	const m = HHMM.exec(String(value ?? '').trim());
	return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * A stored zone must be a Region/City name (or UTC). `EST`, `MST`, `EST5EDT`
 * are accepted by Intl but never follow DST, so they are refused.
 */
export function isValidZone(zone: unknown): zone is string {
	if (typeof zone !== 'string') return false;
	if (zone !== 'UTC' && !zone.includes('/')) return false;
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: zone });
		return true;
	} catch {
		return false;
	}
}

/** Parse a filter value (object, or the JSON string the editor submits). */
export function parseTimeWindows(value: unknown): TimeWindowsFilter | null {
	let parsed: any = value;
	if (typeof value === 'string') {
		try {
			parsed = JSON.parse(value);
		} catch {
			return null;
		}
	}
	if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.windows)) return null;
	return parsed as TimeWindowsFilter;
}

/** Day-of-week index (0 = Sunday) and minutes since midnight in `zone`. */
function localParts(date: Date, zone: string): { day: number; minutes: number } {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: zone,
		weekday: 'short',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
	}).formatToParts(date);
	const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
	return {
		day: WEEKDAYS.indexOf(
			get('weekday').toLowerCase().slice(0, 3) as (typeof WEEKDAYS)[number]
		),
		minutes: Number(get('hour')) * 60 + Number(get('minute')),
	};
}

/**
 * Does `date` fall inside any window? A window's `days` name the day it
 * STARTS on, so a Saturday 22:00-02:00 window still matches Sunday 01:00.
 * Omitted `days` means every day. start === end means the whole day.
 * Windows with unreadable times are ignored.
 */
export function isInsideWindows(filter: TimeWindowsFilter, date: Date, zone: string): boolean {
	const { day, minutes } = localParts(date, zone);
	for (const w of filter.windows) {
		const start = toMinutes(w.start);
		const end = toMinutes(w.end);
		if (start === null || end === null) continue;
		const days =
			Array.isArray(w.days) && w.days.length > 0
				? w.days.map((d) => String(d).toLowerCase().slice(0, 3))
				: null;
		const runsOn = (d: number) => !days || days.includes(WEEKDAYS[d]);

		if (start === end) {
			if (runsOn(day)) return true;
		} else if (start < end) {
			if (minutes >= start && minutes < end && runsOn(day)) return true;
		} else if (minutes >= start) {
			if (runsOn(day)) return true;
		} else if (minutes < end && runsOn((day + 6) % 7)) {
			return true;
		}
	}
	return false;
}

/**
 * Decide whether an event passes the filter. The clock is the event's own
 * `created_at` when it has one, else now. The zone is the automation's
 * override, then the guild zone, then UTC.
 */
export function matchesTimeWindows(
	value: unknown,
	event: { created_at?: string | null } | null | undefined,
	guildTimezone?: string | null,
	now: Date = new Date()
): boolean {
	const filter = parseTimeWindows(value);
	if (!filter || filter.windows.length === 0) return true; // nothing configured: no restriction
	const zone = [filter.timezone, guildTimezone].find(isValidZone) ?? 'UTC';
	const when = (event?.created_at && parseUTCDate(event.created_at)) || now;
	const inside = isInsideWindows(filter, when, zone);
	return filter.mode === 'exclude' ? !inside : inside;
}
