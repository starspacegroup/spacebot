/**
 * Arm state for edge-triggered automations (see automation/voice-threshold.ts).
 * One row per (automation, scope); for voice thresholds the scope is
 * `voice:<channelId>`. A missing row means armed and never fired.
 */
import { log } from '../log.js';
import {
	evaluateThreshold,
	FRESH_STATE,
	readOccupancy,
	readThresholdConfig,
	type ThresholdState,
} from '../automation/voice-threshold.js';

export async function getTriggerState(
	db,
	automationId: number,
	scope: string
): Promise<ThresholdState> {
	const row = await db
		.prepare(
			'SELECT armed, last_fired_at FROM automation_trigger_state WHERE automation_id = ? AND scope = ?'
		)
		.bind(automationId, scope)
		.first();
	if (!row) return { ...FRESH_STATE };
	return { armed: row.armed !== 0, lastFiredAt: row.last_fired_at ?? null };
}

export async function saveTriggerState(
	db,
	automationId: number,
	scope: string,
	state: ThresholdState
) {
	await db
		.prepare(
			`INSERT INTO automation_trigger_state (automation_id, scope, armed, last_fired_at, updated_at)
			 VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
			 ON CONFLICT(automation_id, scope) DO UPDATE SET
			   armed = excluded.armed, last_fired_at = excluded.last_fired_at, updated_at = CURRENT_TIMESTAMP`
		)
		.bind(automationId, scope, state.armed ? 1 : 0, state.lastFiredAt)
		.run();
}

/**
 * Run the edge check for one automation and persist the new arm state.
 * Returns true when the automation should fire for this head-count change.
 */
export async function checkVoiceThreshold(
	db,
	automation,
	event,
	now = Date.now()
): Promise<boolean> {
	const config = readThresholdConfig(automation.trigger_filters);
	const occupancy = config && readOccupancy(event, config);
	if (!config || !occupancy || !event.channel_id) return false;

	const scope = `voice:${event.channel_id}`;
	try {
		const before = await getTriggerState(db, automation.id, scope);
		const { fire, state } = evaluateThreshold(config, before, occupancy, now);
		if (state.armed !== before.armed || state.lastFiredAt !== before.lastFiredAt) {
			await saveTriggerState(db, automation.id, scope, state);
		}
		return fire;
	} catch (error) {
		log.error(
			`[Automation] Voice threshold state failed for #${automation.id}: ${error.message}`
		);
		return false;
	}
}
