import { describe, it, expect } from 'vitest';
import {
	evaluateThreshold,
	FRESH_STATE,
	readOccupancy,
	readThresholdConfig,
	type ThresholdState,
} from '../lib/automation/voice-threshold.js';
import { checkVoiceThreshold } from '../lib/db/automation-trigger-state.js';
import { FILTER_TYPES, filterAppliesToEvent } from '../lib/db/automations.js';

const MIN = 60_000;
const cfg = (filters: Record<string, unknown> = {}) =>
	readThresholdConfig({ min_users: 4, ...filters })!;

/** Replay a channel's head-count over time; returns the minutes it fired at. */
function replay(counts: Array<[minute: number, count: number]>, filters = {}) {
	const config = cfg(filters);
	let state: ThresholdState = { ...FRESH_STATE };
	let previous = 0;
	const fired: number[] = [];
	for (const [minute, count] of counts) {
		const result = evaluateThreshold(config, state, { count, previous }, minute * MIN);
		if (result.fire) fired.push(minute);
		state = result.state;
		previous = count;
	}
	return fired;
}

describe('voice threshold config', () => {
	it('needs a positive min_users', () => {
		expect(readThresholdConfig({})).toBeNull();
		expect(readThresholdConfig({ min_users: '0' })).toBeNull();
		expect(readThresholdConfig({ min_users: 'abc' })).toBeNull();
	});

	it('reads form strings and applies the defaults', () => {
		const c = readThresholdConfig({ min_users: '4' })!;
		expect(c).toMatchObject({ minUsers: 4, rearmBelow: 3, countBots: false });
		expect(c.cooldownMs).toBe(30 * MIN);
	});

	it('caps rearm_below at min_users so it cannot turn into a level check', () => {
		expect(cfg({ rearm_below: 9 }).rearmBelow).toBe(4);
	});

	it('counts humans unless count_bots is yes', () => {
		const event = {
			details: { humanCount: 3, totalCount: 5, previousHumanCount: 2, previousTotalCount: 4 },
		};
		expect(readOccupancy(event, cfg())).toEqual({ count: 3, previous: 2 });
		expect(readOccupancy(event, cfg({ count_bots: 'yes' }))).toEqual({ count: 5, previous: 4 });
		expect(readOccupancy({ details: {} }, cfg())).toBeNull();
	});
});

describe('evaluateThreshold', () => {
	it('fires once on the crossing, not on later joins', () => {
		expect(
			replay([
				[0, 1],
				[1, 2],
				[2, 3],
				[3, 4],
				[4, 5],
				[5, 6],
			])
		).toEqual([3]);
	});

	it('does not fire below the threshold', () => {
		expect(
			replay([
				[0, 1],
				[1, 2],
				[2, 3],
			])
		).toEqual([]);
	});

	it('stays quiet when someone leaves and rejoins around the threshold', () => {
		// 4 -> 3 is not below rearm_below (3), so it is still disarmed.
		expect(
			replay([
				[0, 3],
				[1, 4],
				[2, 3],
				[3, 4],
				[4, 3],
				[5, 4],
			])
		).toEqual([1]);
	});

	it('re-arms after the count drops under rearm_below and the cooldown passes', () => {
		expect(
			replay([
				[0, 4],
				[5, 2],
				[40, 4],
			])
		).toEqual([0, 40]);
	});

	it('does not re-fire inside the cooldown even after re-arming', () => {
		expect(
			replay([
				[0, 4],
				[5, 2],
				[10, 4],
			])
		).toEqual([0]);
	});

	it('spends a crossing made inside the cooldown instead of saving it', () => {
		// Crosses at 10 (cooling down), so 20 and 40 at the same level do not fire.
		expect(
			replay([
				[0, 4],
				[5, 2],
				[10, 4],
				[20, 5],
				[40, 6],
			])
		).toEqual([0]);
	});

	it('honours a custom rearm_below and cooldown', () => {
		const filters = { rearm_below: 1, cooldown_minutes: 0 };
		// Dropping to 2 is not below 1, so no re-arm; dropping to 0 is.
		expect(
			replay(
				[
					[0, 4],
					[1, 2],
					[2, 4],
					[3, 0],
					[4, 4],
				],
				filters
			)
		).toEqual([0, 4]);
	});

	it('never fires without a crossing, so a restart with a full room is quiet', () => {
		const result = evaluateThreshold(cfg(), { ...FRESH_STATE }, { count: 6, previous: 5 }, 0);
		expect(result.fire).toBe(false);
		expect(result.state.armed).toBe(false);
	});
});

/** A D1 stand-in holding automation_trigger_state in a Map. */
function fakeDb() {
	const rows = new Map<string, { armed: number; last_fired_at: number | null }>();
	return {
		rows,
		prepare(_sql: string) {
			return {
				bind(...args: any[]) {
					return {
						first: async () => rows.get(`${args[0]}|${args[1]}`) ?? null,
						run: async () => {
							rows.set(`${args[0]}|${args[1]}`, {
								armed: args[2],
								last_fired_at: args[3],
							});
						},
					};
				},
			};
		},
	};
}

const voiceEvent = (channel: string, count: number, previous: number) => ({
	event_type: 'VOICE_CHANNEL_THRESHOLD',
	channel_id: channel,
	details: {
		humanCount: count,
		previousHumanCount: previous,
		totalCount: count,
		previousTotalCount: previous,
	},
});

describe('checkVoiceThreshold (persisted state)', () => {
	const automation = { id: 7, trigger_filters: { min_users: '4' } };

	it('fires once and remembers across calls, as it must across a restart', async () => {
		const db = fakeDb();
		expect(await checkVoiceThreshold(db, automation, voiceEvent('a', 4, 3), 0)).toBe(true);
		expect(await checkVoiceThreshold(db, automation, voiceEvent('a', 5, 4), 1000)).toBe(false);
		expect(db.rows.get('7|voice:a')).toEqual({ armed: 0, last_fired_at: 0 });
	});

	it('tracks each channel on its own', async () => {
		const db = fakeDb();
		expect(await checkVoiceThreshold(db, automation, voiceEvent('a', 4, 3), 0)).toBe(true);
		expect(await checkVoiceThreshold(db, automation, voiceEvent('b', 4, 3), 0)).toBe(true);
	});

	it('does nothing for an automation with no min_users', async () => {
		const db = fakeDb();
		const bare = { id: 8, trigger_filters: {} };
		expect(await checkVoiceThreshold(db, bare, voiceEvent('a', 4, 3), 0)).toBe(false);
		expect(db.rows.size).toBe(0);
	});
});

describe('voice threshold filters in the editor', () => {
	it('apply to the threshold event and the channel filter reaches it too', () => {
		for (const key of ['min_users', 'rearm_below', 'cooldown_minutes', 'count_bots']) {
			expect(filterAppliesToEvent(FILTER_TYPES[key], 'VOICE_CHANNEL_THRESHOLD')).toBe(true);
			expect(filterAppliesToEvent(FILTER_TYPES[key], 'VOICE_JOIN')).toBe(false);
		}
		expect(filterAppliesToEvent(FILTER_TYPES.channel_id, 'VOICE_CHANNEL_THRESHOLD')).toBe(true);
	});
});
