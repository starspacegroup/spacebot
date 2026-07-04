/**
 * Shared client-side helpers for the superadmin workflows UI: schedule
 * cadence ↔ cron conversion, option lists, and small formatters. Ported
 * unchanged from the original monolithic workflows page.
 */

export const WEEKDAY_OPTIONS = [
	{ id: 0, label: 'Sunday' },
	{ id: 1, label: 'Monday' },
	{ id: 2, label: 'Tuesday' },
	{ id: 3, label: 'Wednesday' },
	{ id: 4, label: 'Thursday' },
	{ id: 5, label: 'Friday' },
	{ id: 6, label: 'Saturday' },
];

export const BRANCH_OPERATORS = [
	{ id: 'equals', label: 'equals' },
	{ id: 'not_equals', label: 'does not equal' },
	{ id: 'contains', label: 'contains' },
	{ id: 'starts_with', label: 'starts with' },
	{ id: 'ends_with', label: 'ends with' },
	{ id: 'gt', label: 'greater than' },
	{ id: 'gte', label: 'greater or equal' },
	{ id: 'lt', label: 'less than' },
	{ id: 'lte', label: 'less or equal' },
];

export const JOB_TYPE_SUGGESTIONS = ['shell_command', 'system_profile', 'screenshot_capture', 'dm'];

export const RUN_STATUSES = [
	'queued',
	'running',
	'sleeping',
	'waiting_approval',
	'completed',
	'failed',
	'cancelled',
];

export function pad2(value) {
	return String(value).padStart(2, '0');
}

export function clampNumber(value, min, max, fallback) {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.max(min, Math.min(max, Math.trunc(n)));
}

export function normalizeWeekday(value, fallback = 1) {
	const n = Number(value);
	return Number.isInteger(n) && n >= 0 && n <= 6 ? n : fallback;
}

export function slugify(value) {
	return String(value || '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80);
}

export interface ScheduleDraft {
	scheduleMode: string;
	minute: number;
	hour: number;
	everyHours: number;
	weekday: number;
	monthday: number;
	unsupported: boolean;
}

export function cronFromSchedule(s: ScheduleDraft): string {
	const mode = s.scheduleMode;
	const minute = clampNumber(s.minute, 0, 59, 0);
	const hour = clampNumber(s.hour, 0, 23, 9);
	const everyHours = clampNumber(s.everyHours, 1, 23, 6);
	const weekday = normalizeWeekday(s.weekday, 1);
	const monthday = clampNumber(s.monthday, 1, 31, 1);
	if (mode === 'hourly') return `${minute} * * * *`;
	if (mode === 'every_n_hours') return `${minute} */${everyHours} * * *`;
	if (mode === 'daily') return `${minute} ${hour} * * *`;
	if (mode === 'weekly') return `${minute} ${hour} * * ${weekday}`;
	if (mode === 'monthly') return `${minute} ${hour} ${monthday} * *`;
	return '';
}

export function scheduleFromCron(scheduleType, cronExpression): ScheduleDraft {
	const base: ScheduleDraft = {
		scheduleMode: 'manual',
		minute: 0,
		hour: 9,
		everyHours: 6,
		weekday: 1,
		monthday: 1,
		unsupported: false,
	};
	const expression = String(cronExpression || '').trim();
	if (scheduleType !== 'cron' || !expression) return base;

	const parts = expression.split(/\s+/);
	if (parts.length !== 5) return { ...base, scheduleMode: 'daily', unsupported: true };

	const [minutePart, hourPart, dayOfMonthPart, monthPart, dayOfWeekPart] = parts;
	const minute = Number(minutePart);
	const hour = Number(hourPart);
	const dayOfMonth = Number(dayOfMonthPart);
	const dayOfWeek = Number(dayOfWeekPart);

	if (
		Number.isInteger(minute) &&
		hourPart === '*' &&
		dayOfMonthPart === '*' &&
		monthPart === '*' &&
		dayOfWeekPart === '*'
	) {
		return { ...base, scheduleMode: 'hourly', minute: clampNumber(minute, 0, 59, 0) };
	}
	const everyMatch = /^\*\/(\d{1,2})$/.exec(hourPart);
	if (
		Number.isInteger(minute) &&
		everyMatch &&
		dayOfMonthPart === '*' &&
		monthPart === '*' &&
		dayOfWeekPart === '*'
	) {
		return {
			...base,
			scheduleMode: 'every_n_hours',
			minute: clampNumber(minute, 0, 59, 0),
			everyHours: clampNumber(Number(everyMatch[1]), 1, 23, 6),
		};
	}
	if (
		Number.isInteger(minute) &&
		Number.isInteger(hour) &&
		dayOfMonthPart === '*' &&
		monthPart === '*' &&
		dayOfWeekPart === '*'
	) {
		return {
			...base,
			scheduleMode: 'daily',
			minute: clampNumber(minute, 0, 59, 0),
			hour: clampNumber(hour, 0, 23, 9),
		};
	}
	if (
		Number.isInteger(minute) &&
		Number.isInteger(hour) &&
		dayOfMonthPart === '*' &&
		monthPart === '*' &&
		Number.isInteger(dayOfWeek)
	) {
		return {
			...base,
			scheduleMode: 'weekly',
			minute: clampNumber(minute, 0, 59, 0),
			hour: clampNumber(hour, 0, 23, 9),
			weekday: normalizeWeekday(dayOfWeek, 1),
		};
	}
	if (
		Number.isInteger(minute) &&
		Number.isInteger(hour) &&
		Number.isInteger(dayOfMonth) &&
		monthPart === '*' &&
		dayOfWeekPart === '*'
	) {
		return {
			...base,
			scheduleMode: 'monthly',
			minute: clampNumber(minute, 0, 59, 0),
			hour: clampNumber(hour, 0, 23, 9),
			monthday: clampNumber(dayOfMonth, 1, 31, 1),
		};
	}
	return {
		...base,
		scheduleMode: 'daily',
		minute: Number.isInteger(minute) ? minute : 0,
		hour: Number.isInteger(hour) ? hour : 9,
		unsupported: true,
	};
}

export function scheduleLabel(s: ScheduleDraft): string {
	const mode = s.scheduleMode;
	const timeLabel = `${pad2(clampNumber(s.hour, 0, 23, 9))}:${pad2(clampNumber(s.minute, 0, 59, 0))} UTC`;
	if (s.unsupported) return 'Legacy custom schedule';
	if (mode === 'hourly') return `Every hour at minute ${pad2(clampNumber(s.minute, 0, 59, 0))}`;
	if (mode === 'every_n_hours')
		return `Every ${clampNumber(s.everyHours, 1, 23, 6)} hours at minute ${pad2(clampNumber(s.minute, 0, 59, 0))}`;
	if (mode === 'daily') return `Daily at ${timeLabel}`;
	if (mode === 'weekly')
		return `Weekly on ${WEEKDAY_OPTIONS.find((o) => o.id === normalizeWeekday(s.weekday))?.label} at ${timeLabel}`;
	if (mode === 'monthly')
		return `Monthly on day ${clampNumber(s.monthday, 1, 31, 1)} at ${timeLabel}`;
	return 'Manual only';
}

export function statusBadgeClass(status) {
	if (status === 'completed') return 'badge-success';
	if (status === 'failed' || status === 'cancelled') return 'badge-danger';
	if (status === 'running' || status === 'queued' || status === 'sleeping') return 'badge-info';
	if (status === 'waiting_approval') return 'badge-warning';
	return 'badge-neutral';
}

export function isTerminalRunStatus(status) {
	return ['completed', 'failed', 'cancelled'].includes(String(status));
}

export function formatDuration(ms) {
	if (ms == null) return '—';
	const n = Number(ms);
	if (!Number.isFinite(n)) return '—';
	if (n < 1000) return `${n}ms`;
	if (n < 60_000) return `${(n / 1000).toFixed(1)}s`;
	return `${Math.floor(n / 60_000)}m ${Math.round((n % 60_000) / 1000)}s`;
}

/** Field-level summary of what changed between two version snapshots. */
export function versionDiffSummary(newer, older): string[] {
	if (!newer || !older) return [];
	const changes: string[] = [];
	const simpleFields = [
		'name',
		'description',
		'category',
		'schedule_type',
		'cron_expression',
		'execution_backend',
		'legacy_job_name',
	];
	for (const field of simpleFields) {
		const a = older[field] ?? null;
		const b = newer[field] ?? null;
		if (String(a ?? '') !== String(b ?? '')) changes.push(field.replace(/_/g, ' '));
	}
	const nodesA = older.node_count ?? (older.canvas_json?.nodes?.length || 0);
	const nodesB = newer.node_count ?? (newer.canvas_json?.nodes?.length || 0);
	if (nodesA !== nodesB) {
		changes.push(`steps ${nodesA} → ${nodesB}`);
	} else if (
		older.canvas_json &&
		newer.canvas_json &&
		JSON.stringify(older.canvas_json) !== JSON.stringify(newer.canvas_json)
	) {
		changes.push('step configuration');
	}
	return changes;
}
