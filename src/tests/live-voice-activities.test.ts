/**
 * The VC activity page was built entirely from voice state, so it could show
 * four people in a channel watching a video together and render nothing but
 * four sets of mute badges. Discord surfaces embedded Activities — Watch
 * Together, Poker Night — through presence, not voice state.
 */
import { describe, expect, it } from 'vitest';
import { buildLiveVoiceSnapshot } from '../lib/db/live-voice.js';

function row(overrides: Record<string, any> = {}) {
	return {
		channel_id: 'c1',
		channel_name: 'Engineering',
		user_id: 'u1',
		user_name: 'blu3b3rryd3v',
		display_name: 'Blu3',
		...overrides,
	};
}

const firstMember = (snapshot: any) => snapshot.channels[0].members[0];

describe('activities in the live voice snapshot', () => {
	it('carries an embedded Activity through to the member', () => {
		const snapshot: any = buildLiveVoiceSnapshot([
			row({
				activities: [
					{
						name: 'Watch Together',
						type: 0,
						application_id: '880218394199220334',
						details: 'Queue: 3 videos',
					},
				],
			}),
		]);

		expect(firstMember(snapshot).activities).toHaveLength(1);
		expect(firstMember(snapshot).activities[0]).toMatchObject({
			name: 'Watch Together',
			label: 'Playing',
			details: 'Queue: 3 videos',
			applicationId: '880218394199220334',
		});
	});

	it('labels each activity type the way Discord phrases it', () => {
		const snapshot: any = buildLiveVoiceSnapshot([
			row({
				activities: [
					{ name: 'A', type: 0 },
					{ name: 'B', type: 2 },
					{ name: 'C', type: 3 },
					{ name: 'D', type: 5 },
				],
			}),
		]);

		expect(firstMember(snapshot).activities.map((a: any) => a.label)).toEqual([
			'Playing',
			'Listening to',
			'Watching',
			'Competing in',
		]);
	});

	it('parses activities that arrive as a JSON string from a DB row', () => {
		// The gateway sends objects; a stored column comes back as text.
		const snapshot: any = buildLiveVoiceSnapshot([
			row({ activities: JSON.stringify([{ name: 'Poker Night', type: 0 }]) }),
		]);

		expect(firstMember(snapshot).activities[0].name).toBe('Poker Night');
	});

	it('never lets a malformed value blank the snapshot', () => {
		for (const bad of ['not json', 42, { nope: true }, [null], [{ type: 0 }], undefined]) {
			const snapshot: any = buildLiveVoiceSnapshot([row({ activities: bad })]);
			// The member still renders; they just have nothing to show.
			expect(snapshot.channels[0].members).toHaveLength(1);
			expect(firstMember(snapshot).activities).toEqual([]);
		}
	});

	it('counts members in an activity, not activities', () => {
		const snapshot: any = buildLiveVoiceSnapshot([
			row({ user_id: 'u1', activities: [{ name: 'Watch Together', type: 0 }] }),
			// Two activities, one person — the tile counts people.
			row({
				user_id: 'u2',
				activities: [
					{ name: 'Poker Night', type: 0 },
					{ name: 'Spotify', type: 2 },
				],
			}),
			row({ user_id: 'u3' }),
		]);

		expect(snapshot.membersInActivities).toBe(2);
		expect(snapshot.totalUsers).toBe(3);
	});

	it('reports zero rather than undefined when nobody is in one', () => {
		const snapshot: any = buildLiveVoiceSnapshot([row()]);
		expect(snapshot.membersInActivities).toBe(0);
	});
});
