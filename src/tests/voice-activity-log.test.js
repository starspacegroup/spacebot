import { describe, expect, it } from 'vitest';
import { normalizeVoiceActivityLog } from '../lib/server/voice-activity-log.js';

describe('normalizeVoiceActivityLog', () => {
	it('falls back to target identity when actor fields are missing', () => {
		const entries = normalizeVoiceActivityLog([
			{
				id: 42,
				event_type: 'VOICE_SERVER_UNMUTE',
				actor_id: null,
				actor_name: null,
				actor_avatar: null,
				target_id: '1234567890',
				target_name: 'jobycat',
				target_avatar: 'avatarhash',
				channel_name: 'Ten Forward',
				created_at: '2026-05-21 09:45:00',
			},
		]);

		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			actorId: '1234567890',
			actorName: 'jobycat',
			actorAvatar: 'avatarhash',
			channelName: 'Ten Forward',
			actionLabel: 'User was server unmuted by moderator',
		});
	});

	it('keeps actor identity when actor fields are present', () => {
		const entries = normalizeVoiceActivityLog([
			{
				id: 43,
				event_type: 'VOICE_JOIN',
				actor_id: '999',
				actor_name: 'funsize9845',
				actor_avatar: 'actorhash',
				target_id: '111',
				target_name: 'someone-else',
				target_avatar: 'targethash',
				channel_name: 'Ten Forward',
				created_at: '2026-05-21 09:50:00',
			},
		]);

		expect(entries[0]).toMatchObject({
			actorId: '999',
			actorName: 'funsize9845',
			actorAvatar: 'actorhash',
		});
	});
});
