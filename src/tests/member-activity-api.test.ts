import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `GET /api/v1/members/:userId` — the endpoint a community site calls to show
 * somebody their own figures.
 *
 * What is asserted here is mostly what the endpoint REFUSES: a key without
 * `members:read`, a user id that is not a snowflake, and — the one that matters
 * for privacy — that nothing in the response names a channel, a message or
 * another member.
 */

let auth: any = { authenticated: true, guildId: 'g1', scopes: ['members:read'] };

vi.mock('$lib/api-auth.js', () => ({
	authenticateApiKey: async () => auth,
	hasScope: (a: any, scope: string) => Boolean(a?.scopes?.includes(scope)),
}));

vi.mock('$lib/db/logger.js', () => ({
	log: { error: () => {}, info: () => {}, warn: () => {}, debug: () => {} },
}));

let asked: { guildId: string; userId: string; days: number } | null = null;
let activity: any;
let explode = false;

vi.mock('$lib/db/member-activity.js', async (importOriginal) => {
	const actual = (await importOriginal()) as any;
	return {
		...actual,
		getMemberActivity: async (_db: any, guildId: string, userId: string, days: number) => {
			asked = { guildId, userId, days };
			if (explode) throw new Error('D1 is having a day');
			return activity;
		},
	};
});

import { GET } from '../routes/api/v1/members/[userId]/+server.js';

const platform = { env: { DB: {} } };

const call = (userId: string, query = '') =>
	GET({
		request: new Request('https://bot.example/api/v1/members/' + userId + query),
		platform,
		params: { userId },
		url: new URL('https://bot.example/api/v1/members/' + userId + query),
	} as any);

beforeEach(() => {
	auth = { authenticated: true, guildId: 'g1', scopes: ['members:read'] };
	asked = null;
	explode = false;
	activity = {
		member: true,
		joinedAt: '2026-01-04 12:00:00',
		bot: false,
		days: 30,
		retentionDays: 90,
		unrecordedChannels: 1,
		activity: {
			messages: 12,
			channels: 3,
			lastMessageAt: '2026-09-20 10:00:00',
			voiceSeconds: 3600,
			voiceSessions: 4,
			voiceChannels: 2,
			lastVoiceAt: '2026-09-19 22:00:00',
			commands: 7,
		},
		recorded: {
			messages: 40,
			channels: 5,
			lastMessageAt: '2026-09-20 10:00:00',
			voiceSeconds: 9000,
			voiceSessions: 11,
			voiceChannels: 3,
			lastVoiceAt: '2026-09-19 22:00:00',
			commands: 20,
		},
		standing: { messageRank: 4, messagePopulation: 37, voiceRank: 2, voicePopulation: 11 },
	};
});

describe('GET /api/v1/members/:userId', () => {
	it('serves the member their own counts', async () => {
		const response = await call('123456789012345678');
		expect(response.status).toBe(200);

		const body = await response.json();
		expect(body).toMatchObject({
			guild_id: 'g1',
			user_id: '123456789012345678',
			member: true,
			joined_at: '2026-01-04 12:00:00',
			days: 30,
			retention_days: 90,
			unrecorded_channels: 1,
		});
		expect(body.activity).toEqual({
			messages: 12,
			channels: 3,
			last_message_at: '2026-09-20 10:00:00',
			voice_seconds: 3600,
			voice_sessions: 4,
			voice_channels: 2,
			last_voice_at: '2026-09-19 22:00:00',
			commands: 7,
		});
		expect(body.recorded.messages).toBe(40);
		expect(body.standing).toEqual({
			message_rank: 4,
			message_population: 37,
			voice_rank: 2,
			voice_population: 11,
		});
	});

	it('never lets a shared cache hold one person data', async () => {
		const response = await call('123456789012345678');
		expect(response.headers.get('cache-control')).toContain('private');
	});

	it('answers a non-member with 200 and nothing to read', async () => {
		activity = {
			...activity,
			member: false,
			joinedAt: null,
			activity: { ...activity.activity, messages: 0 },
		};
		const response = await call('123456789012345678');

		// A 404 would turn this endpoint into a way to test ids for existence.
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.member).toBe(false);
		expect(body.joined_at).toBeNull();
	});

	it('carries no channel, message text or other member through', async () => {
		const body = await (await call('123456789012345678')).json();
		const serialized = JSON.stringify(body);
		expect(serialized).not.toMatch(/channel_id|channel_name|content|username|actor_id/);
		// Channel COUNTS are fine; channel identities are not.
		expect(body.activity.channels).toBe(3);
	});

	it('passes the window through, clamped', async () => {
		await call('123456789012345678', '?days=3650');
		expect(asked?.days).toBe(90);
		await call('123456789012345678', '?days=7');
		expect(asked?.days).toBe(7);
		await call('123456789012345678');
		expect(asked?.days).toBe(30);
	});

	it('scopes the read to the key own guild, not to anything the caller sends', async () => {
		auth = { authenticated: true, guildId: 'g-of-the-key', scopes: ['members:read'] };
		await call('123456789012345678', '?guild_id=somebody-elses');
		expect(asked?.guildId).toBe('g-of-the-key');
	});

	it('refuses a key without members:read, including one with stats:read', async () => {
		auth = { authenticated: true, guildId: 'g1', scopes: ['stats:read', 'voice:read'] };
		const response = await call('123456789012345678');
		expect(response.status).toBe(403);
		expect((await response.json()).error).toContain('members:read');
	});

	it('refuses an unauthenticated caller', async () => {
		auth = { authenticated: false, error: 'Missing Authorization header', status: 401 };
		const response = await call('123456789012345678');
		expect(response.status).toBe(401);
	});

	it('refuses a user id that is not a snowflake', async () => {
		for (const id of ['', 'nope', '12', "1'; DROP TABLE users;--", '1'.repeat(40)]) {
			const response = await call(id);
			expect(response.status).toBe(400);
		}
		expect(asked).toBeNull();
	});

	it('reports a database that is not there', async () => {
		const response = await GET({
			request: new Request('https://bot.example/api/v1/members/123456789012345678'),
			platform: { env: {} },
			params: { userId: '123456789012345678' },
			url: new URL('https://bot.example/api/v1/members/123456789012345678'),
		} as any);
		expect(response.status).toBe(503);
	});

	it('turns a failed read into a 500, not a stack trace', async () => {
		explode = true;
		const response = await call('123456789012345678');
		expect(response.status).toBe(500);
		expect((await response.json()).error).toBe('Failed to fetch member activity');
	});
});
