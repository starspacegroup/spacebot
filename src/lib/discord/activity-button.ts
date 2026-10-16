/**
 * The "Open Activity" button on the cards that have a place in the Activity
 * (timebox, game lobby, quorum). Discord has no button that launches an
 * Activity by itself; the click is an interaction, and the answer to it is a
 * LAUNCH_ACTIVITY response (type 12).
 */
export const ACTIVITY_OPEN_ID = 'activity:open';

export const openActivityButton = (disabled = false) => ({
	type: 2,
	style: 1,
	label: 'Open Activity',
	custom_id: ACTIVITY_OPEN_ID,
	disabled,
});

export const LAUNCH_ACTIVITY_RESPONSE = { type: 12 };
