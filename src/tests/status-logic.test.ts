import { describe, expect, it } from 'vitest';
import {
	CONFIRM_BETTER,
	CONFIRM_WORSE,
	HEARTBEAT_STALE_SECONDS,
	advance,
	ageSeconds,
	dayLevel,
	lastDays,
	overall,
	describeAgo,
	readBot,
	staleAfterSeconds,
	readDatabase,
	readWebsite,
	uptimePercent,
	type ComponentState,
	type Status,
} from '../lib/status/logic.js';

const NOW = new Date('2026-11-17T12:00:00Z');
const ago = (s: number) =>
	new Date(NOW.getTime() - s * 1000).toISOString().slice(0, 19).replace('T', ' ');
const fresh = (over: any = {}) => ({
	recordedAt: ago(30),
	status: 'connected',
	latencyMs: 40,
	...over,
});

describe('reading a check', () => {
	it('website: up, slow, down, and no probe means up', () => {
		expect(readWebsite({ ok: true, ms: 120 }).status).toBe('operational');
		expect(readWebsite({ ok: true, ms: 4000 }).status).toBe('degraded');
		expect(readWebsite({ ok: false, ms: null }).status).toBe('down');
		expect(readWebsite(null).status).toBe('operational');
	});

	it('database: up, slow, down', () => {
		expect(readDatabase({ ok: true, ms: 20 }).status).toBe('operational');
		expect(readDatabase({ ok: true, ms: 2000 }).status).toBe('degraded');
		expect(readDatabase({ ok: false, ms: null }).status).toBe('down');
	});

	it('bot: a recent connected heartbeat is up', () => {
		const r = readBot(fresh(), NOW);
		expect(r.host.status).toBe('operational');
		expect(r.discord.status).toBe('operational');
		expect(r.discord.latencyMs).toBe(40);
	});

	it('bot: slow heartbeat is degraded', () => {
		expect(readBot(fresh({ latencyMs: 2500 }), NOW).discord.status).toBe('degraded');
	});

	it('bot: reports arriving but not connected means the host is fine and Discord is not', () => {
		const r = readBot(fresh({ status: 'reconnecting', latencyMs: null }), NOW);
		expect(r.host.status).toBe('operational');
		expect(r.discord.status).toBe('down');
		expect(r.discord.detail).toMatch(/lost its connection/);
	});

	it('bot: no recent report means the host is down, and so is the connection', () => {
		for (const hb of [
			null,
			fresh({ recordedAt: ago(HEARTBEAT_STALE_SECONDS + 60) }),
			{ recordedAt: null, status: null, latencyMs: null },
		]) {
			const r = readBot(hb as any, NOW);
			expect(r.host.status).toBe('down');
			expect(r.discord.status).toBe('down');
		}
		expect(
			readBot(fresh({ recordedAt: ago(HEARTBEAT_STALE_SECONDS - 5) }), NOW).host.status
		).toBe('operational');
	});

	it('never leaks an address or an error into the public detail text', () => {
		const texts = [
			readWebsite({ ok: false, ms: null }).detail,
			readDatabase({ ok: false, ms: null }).detail,
			readBot(null, NOW).host.detail,
			readBot(fresh({ recordedAt: ago(9999) }), NOW).host.detail,
		];
		for (const t of texts) expect(t).not.toMatch(/\d+\.\d+\.\d+|exception|stack|SQLITE|at \//i);
	});

	it('ageSeconds reads SQL time as UTC and survives junk', () => {
		expect(ageSeconds('2026-11-17 11:59:00', NOW)).toBe(60);
		expect(ageSeconds('junk', NOW)).toBe(Infinity);
		expect(ageSeconds('2026-11-17 12:05:00', NOW)).toBe(0); // clock skew never goes negative
	});
});

const start = (status: Status = 'operational'): ComponentState => ({
	status,
	since: '2026-11-17 00:00:00',
	pendingStatus: null,
	pendingCount: 0,
	pendingSince: null,
});

function run(initial: ComponentState, readings: Status[]) {
	let state = initial;
	const changes: { at: number; to: Status; since: string }[] = [];
	readings.forEach((r, i) => {
		const step = advance(state, r, `2026-11-17 12:${String(i).padStart(2, '0')}:00`);
		state = step.state;
		if (step.changed) changes.push({ at: i, to: state.status, since: state.since });
	});
	return { state, changes };
}

describe('confirming a change', () => {
	it('one bad check does nothing', () => {
		expect(run(start(), ['down', 'operational', 'operational']).changes).toEqual([]);
	});

	it('needs the same new status in a row, then changes, dated to the first bad check', () => {
		const { changes } = run(start(), ['operational', 'down', 'down', 'down']);
		expect(changes).toHaveLength(1);
		expect(changes[0].to).toBe('down');
		expect(changes[0].at).toBe(CONFIRM_WORSE); // index 1 + (CONFIRM_WORSE - 1)
		expect(changes[0].since).toBe('2026-11-17 12:01:00');
	});

	it('flapping between two bad statuses never confirms', () => {
		expect(run(start(), ['down', 'degraded', 'down', 'degraded', 'down']).changes).toEqual([]);
	});

	it('recovery needs its own run of good checks and is dated to when it was confirmed', () => {
		const { changes, state } = run(start('down'), ['operational', 'operational']);
		expect(CONFIRM_BETTER).toBe(2);
		expect(changes).toEqual([{ at: 1, to: 'operational', since: '2026-11-17 12:01:00' }]);
		expect(state.status).toBe('operational');
	});

	it('a good check in the middle of a bad run clears the run', () => {
		expect(run(start(), ['down', 'operational', 'down']).changes).toEqual([]);
	});

	it('degraded then down escalates through the same rules', () => {
		const { changes } = run(start(), ['degraded', 'degraded', 'down', 'down']);
		expect(changes.map((c) => c.to)).toEqual(['degraded', 'down']);
	});

	it('randomised: the confirmed status only ever moves after enough agreeing checks', () => {
		let seed = 42;
		const rand = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
		const all: Status[] = ['operational', 'degraded', 'down'];
		for (let trial = 0; trial < 300; trial++) {
			let state = start(all[Math.floor(rand() * 3)]);
			let streakStatus: Status | null = null;
			let streak = 0;
			for (let i = 0; i < 40; i++) {
				const r = all[Math.floor(rand() * 3)];
				const before = state.status;
				if (r === streakStatus) streak++;
				else {
					streakStatus = r;
					streak = 1;
				}
				const step = advance(state, r, `2026-11-17 12:00:${String(i).padStart(2, '0')}`);
				state = step.state;
				if (step.changed) {
					expect(state.status).toBe(r);
					expect(streak).toBeGreaterThanOrEqual(2);
					expect(before).not.toBe(r);
				} else {
					expect(state.status).toBe(before);
				}
			}
		}
	});
});

describe('history', () => {
	const d = (over: any = {}) => ({
		day: '2026-11-16',
		checks: 1440,
		operational: 1440,
		degraded: 0,
		down: 0,
		...over,
	});

	it('colours a day', () => {
		expect(dayLevel(undefined)).toBe('none');
		expect(dayLevel(d({ checks: 0 }))).toBe('none');
		expect(dayLevel(d())).toBe('operational');
		expect(dayLevel(d({ degraded: 3, operational: 1437 }))).toBe('degraded');
		expect(dayLevel(d({ down: 2, operational: 1438 }))).toBe('degraded');
		expect(dayLevel(d({ down: 30, operational: 1410 }))).toBe('down');
	});

	it('uptime is cut, never rounded up, and an outage never reads 100', () => {
		expect(uptimePercent([])).toBeNull();
		expect(uptimePercent([d()])).toBe(100);
		expect(uptimePercent([d({ down: 1, operational: 1439 })])).toBe(99.93);
		expect(uptimePercent([d({ checks: 1_000_000, operational: 999_999, down: 1 })])).toBe(
			99.99
		);
		expect(uptimePercent([d({ checks: 100, operational: 50, down: 50 })])).toBe(50);
	});

	it('lists the last days oldest first', () => {
		expect(lastDays('2026-11-17', 3)).toEqual(['2026-11-15', '2026-11-16', '2026-11-17']);
		expect(lastDays('2026-03-01', 2)).toEqual(['2026-02-28', '2026-03-01']);
	});

	it('overall is the worst status', () => {
		expect(overall([])).toBe('operational');
		expect(overall(['operational', 'degraded'])).toBe('degraded');
		expect(overall(['degraded', 'down', 'operational'])).toBe('down');
	});
});

describe('how long the bot may stay quiet', () => {
	it('follows the reporting interval and never goes below the one-minute default', () => {
		expect(staleAfterSeconds(60)).toBe(HEARTBEAT_STALE_SECONDS);
		expect(staleAfterSeconds(1800)).toBe(3630);
		expect(staleAfterSeconds(10)).toBe(HEARTBEAT_STALE_SECONDS);
		for (const bad of [null, undefined, 0, -5, NaN]) {
			expect(staleAfterSeconds(bad as any)).toBe(HEARTBEAT_STALE_SECONDS);
		}
	});

	it('readBot uses the window it is given', () => {
		const hb = fresh({ recordedAt: ago(20 * 60) });
		expect(readBot(hb, NOW).host.status).toBe('down');
		expect(readBot(hb, NOW, staleAfterSeconds(1800)).host.status).toBe('operational');
	});
});

describe('how long ago', () => {
	it('says just now, then minutes, then hours', () => {
		expect(describeAgo(0)).toBe('just now');
		expect(describeAgo(44)).toBe('just now');
		expect(describeAgo(45)).toBe('1 minute ago');
		expect(describeAgo(90)).toBe('2 minutes ago');
		expect(describeAgo(5 * 60)).toBe('5 minutes ago');
		expect(describeAgo(119 * 60)).toBe('119 minutes ago');
		expect(describeAgo(3 * 3600)).toBe('3 hours ago');
	});
	it('does not claim just now when the age is unknown', () => {
		expect(describeAgo(Infinity)).toBe('a while ago');
		expect(describeAgo(NaN)).toBe('a while ago');
	});
});
