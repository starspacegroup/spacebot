import { describe, expect, it } from 'vitest';
import { processVoiceSessions, reconcileVoiceSessions } from '../lib/db/stats-aggregation.js';

class FakeStatement {
	constructor(db, sql) {
		this.db = db;
		this.sql = sql;
		this.args = [];
	}

	bind(...args) {
		this.args = args;
		return this;
	}

	async first() {
		return this.db.execute(this.sql, this.args, 'first');
	}

	async all() {
		return this.db.execute(this.sql, this.args, 'all');
	}

	async run() {
		return this.db.execute(this.sql, this.args, 'run');
	}

	async raw() {
		return this.db.execute(this.sql, this.args, 'raw');
	}

	async values() {
		return this.db.execute(this.sql, this.args, 'values');
	}
}

class FakeVoiceSessionDb {
	constructor() {
		this.checkpoints = new Map();
		this.events = [];
		this.sessions = [];
		this.nextSessionId = 1;
	}

	prepare(sql) {
		return new FakeStatement(this, sql);
	}

	seedEvents(events) {
		this.events = events.map((event) => ({ ...event }));
	}

	seedSessions(sessions) {
		this.sessions = sessions.map((session) => ({ ...session }));
		for (const session of this.sessions) {
			this.nextSessionId = Math.max(this.nextSessionId, (session.id ?? 0) + 1);
		}
	}

	execute(sql, args, mode) {
		if (sql.includes('SELECT last_processed_event_id, last_processed_at') && mode === 'first') {
			const [guildId, checkpointType] = args;
			return this.checkpoints.get(`${guildId}:${checkpointType}`) ?? null;
		}

		if (sql.includes('INSERT INTO stats_processing_checkpoint') && mode === 'run') {
			const [guildId, checkpointType, lastEventId] = args;
			this.checkpoints.set(`${guildId}:${checkpointType}`, {
				last_processed_event_id: lastEventId,
				last_processed_at: '2026-04-11 00:00:00',
			});
			return { success: true };
		}

		if (sql.includes('SELECT id, event_type, actor_id, target_id, channel_id, channel_name, created_at') && mode === 'all') {
			const [guildId, lastEventId] = args;
			return {
				results: this.events
					.filter((event) => event.guild_id === guildId && event.id > lastEventId)
					.sort((left, right) => left.id - right.id)
					.map(({ id, event_type, actor_id, target_id, channel_id, channel_name, created_at }) => ({
						id,
						event_type,
						actor_id,
						target_id,
						channel_id,
						channel_name,
						created_at,
					})),
			};
		}

		if (sql.includes('FROM voice_sessions') && sql.includes('left_at IS NULL') && mode === 'all') {
			if (sql.includes('AND user_id = ?')) {
				const [guildId, userId] = args;
				return {
					results: this.sessions
						.filter((session) => session.guild_id === guildId && session.user_id === userId && session.left_at == null)
						.sort((left, right) => {
							if (left.joined_at !== right.joined_at) return left.joined_at.localeCompare(right.joined_at);
							return left.id - right.id;
						})
						.map((session) => ({ ...session })),
				};
			}

			const [guildId] = args;
			return {
				results: this.sessions
					.filter((session) => session.guild_id === guildId && session.left_at == null)
					.sort((left, right) => {
						if (left.user_id !== right.user_id) return left.user_id.localeCompare(right.user_id);
						if (left.joined_at !== right.joined_at) return left.joined_at.localeCompare(right.joined_at);
						return left.id - right.id;
					})
					.map((session) => ({ ...session })),
			};
		}

		if (sql.includes('UPDATE voice_sessions') && sql.includes('WHERE id = ?') && mode === 'run') {
			const [leftAt, leaveEventId, _leftAtAgain, id] = args;
			const session = this.sessions.find((entry) => entry.id === id);
			if (!session) {
				throw new Error(`Missing voice session ${id}`);
			}

			session.left_at = leftAt;
			session.leave_event_id = leaveEventId;
			session.duration_seconds = Math.max(
				0,
				Math.floor((new Date(leftAt.replace(' ', 'T') + 'Z').getTime() - new Date(session.joined_at.replace(' ', 'T') + 'Z').getTime()) / 1000),
			);
			return { success: true };
		}

		if (sql.includes('INSERT INTO voice_sessions') && mode === 'run') {
			const [guildId, userId, channelId, channelName, joinedAt, joinEventId] = args;
			this.sessions.push({
				id: this.nextSessionId++,
				guild_id: guildId,
				user_id: userId,
				channel_id: channelId,
				channel_name: channelName,
				joined_at: joinedAt,
				left_at: null,
				duration_seconds: null,
				join_event_id: joinEventId ?? null,
				leave_event_id: null,
			});
			return { success: true };
		}

		throw new Error(`Unhandled SQL in test fake: ${sql} (${mode})`);
	}
}

describe('processVoiceSessions', () => {
	it('ignores duplicate joins and closes the remaining open session on leave', async () => {
		const db = new FakeVoiceSessionDb();
		db.seedEvents([
			{ id: 1, guild_id: 'guild-1', event_type: 'VOICE_JOIN', actor_id: 'user-1', channel_id: 'channel-1', channel_name: 'General', created_at: '2026-04-08 02:12:17' },
			{ id: 2, guild_id: 'guild-1', event_type: 'VOICE_JOIN', actor_id: 'user-1', channel_id: 'channel-1', channel_name: 'General', created_at: '2026-04-08 02:18:34' },
			{ id: 3, guild_id: 'guild-1', event_type: 'VOICE_LEAVE', actor_id: 'user-1', channel_id: 'channel-1', channel_name: 'General', created_at: '2026-04-08 04:07:27' },
		]);

		const result = await processVoiceSessions(db, 'guild-1');

		expect(result).toMatchObject({ processed: 3, sessionsCreated: 1, sessionsClosed: 1 });
		expect(db.sessions).toHaveLength(1);
		expect(db.sessions[0]).toMatchObject({
			user_id: 'user-1',
			channel_id: 'channel-1',
			join_event_id: 1,
			leave_event_id: 3,
			left_at: '2026-04-08 04:07:27',
		});
	});

	it('uses target_id fallback when actor_id is missing', async () => {
		const db = new FakeVoiceSessionDb();
		db.seedEvents([
			{ id: 20, guild_id: 'guild-1', event_type: 'VOICE_JOIN', actor_id: null, target_id: 'user-fallback', channel_id: 'channel-1', channel_name: 'General', created_at: '2026-04-08 05:00:00' },
			{ id: 21, guild_id: 'guild-1', event_type: 'VOICE_LEAVE', actor_id: null, target_id: 'user-fallback', channel_id: 'channel-1', channel_name: 'General', created_at: '2026-04-08 05:10:00' },
		]);

		const result = await processVoiceSessions(db, 'guild-1');

		expect(result).toMatchObject({ processed: 2, sessionsCreated: 1, sessionsClosed: 1 });
		expect(db.sessions).toHaveLength(1);
		expect(db.sessions[0]).toMatchObject({
			user_id: 'user-fallback',
			join_event_id: 20,
			leave_event_id: 21,
			left_at: '2026-04-08 05:10:00',
		});
	});
});

describe('reconcileVoiceSessions', () => {
	it('closes stale sessions, collapses duplicates, and inserts missing active sessions', async () => {
		const db = new FakeVoiceSessionDb();
		db.seedSessions([
			{ id: 10, guild_id: 'guild-1', user_id: 'user-stale', channel_id: 'channel-a', channel_name: 'Alpha', joined_at: '2026-04-08 01:00:00', left_at: null, duration_seconds: null, join_event_id: 10, leave_event_id: null },
			{ id: 11, guild_id: 'guild-1', user_id: 'user-dup', channel_id: 'channel-b', channel_name: 'Beta', joined_at: '2026-04-08 02:00:00', left_at: null, duration_seconds: null, join_event_id: 11, leave_event_id: null },
			{ id: 12, guild_id: 'guild-1', user_id: 'user-dup', channel_id: 'channel-b', channel_name: 'Beta', joined_at: '2026-04-08 02:05:00', left_at: null, duration_seconds: null, join_event_id: 12, leave_event_id: null },
			{ id: 13, guild_id: 'guild-1', user_id: 'user-moved', channel_id: 'channel-c', channel_name: 'Gamma', joined_at: '2026-04-08 03:00:00', left_at: null, duration_seconds: null, join_event_id: 13, leave_event_id: null },
		]);

		const result = await reconcileVoiceSessions(db, 'guild-1', [
			{ user_id: 'user-dup', channel_id: 'channel-b', channel_name: 'Beta' },
			{ user_id: 'user-moved', channel_id: 'channel-d', channel_name: 'Delta' },
			{ user_id: 'user-new', channel_id: 'channel-e', channel_name: 'Epsilon' },
		], '2026-04-11 09:30:00');

		expect(result).toMatchObject({ closedSessions: 2, createdSessions: 2, duplicateSessionsClosed: 1 });

		const openSessions = db.sessions.filter((session) => session.left_at == null).sort((left, right) => left.user_id.localeCompare(right.user_id));
		expect(openSessions).toHaveLength(3);
		expect(openSessions.map((session) => ({ user: session.user_id, channel: session.channel_id }))).toEqual([
			{ user: 'user-dup', channel: 'channel-b' },
			{ user: 'user-moved', channel: 'channel-d' },
			{ user: 'user-new', channel: 'channel-e' },
		]);

		const duplicateClosed = db.sessions.find((session) => session.id === 12);
		expect(duplicateClosed?.left_at).toBe('2026-04-11 09:30:00');

		const staleClosed = db.sessions.find((session) => session.id === 10);
		expect(staleClosed?.left_at).toBe('2026-04-11 09:30:00');
	});
});