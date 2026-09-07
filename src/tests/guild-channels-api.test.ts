import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The two channel endpoints, and the privacy rules that make the directory
 * safe to publish:
 *
 *  - `/api/v1/channels` serves it, behind the `channels:read` scope.
 *  - `/api/channels/sync` takes it from the gateway, behind the bot token, and
 *    drops the rooms members made with `/room`.
 *
 * The other half of the privacy story — never sending a channel `@everyone`
 * cannot view — lives in the gateway, where the permission overwrites are.
 */

let auth: any = { authenticated: true, guildId: 'g1', scopes: ['channels:read', 'commands:read'] };

vi.mock('$lib/api-auth.js', () => ({
	authenticateApiKey: async () => auth,
	hasScope: (a: any, scope: string) => Boolean(a?.scopes?.includes(scope)),
}));

vi.mock('$lib/db/logger.js', () => ({ log: { error: () => {}, info: () => {}, warn: () => {} } }));
vi.mock('$lib/log.js', () => ({ log: { error: () => {}, info: () => {}, warn: () => {} } }));

const stored: any[] = [];
let managedRooms: any[] = [];
let syncedAt: string | null = '2026-09-07T12:00:00Z';
let replaceResult = { success: true, stored: 0 };

vi.mock('$lib/db/guild-channels.js', async (importOriginal) => {
	const actual = (await importOriginal()) as any;
	return {
		...actual,
		getGuildChannels: async () => stored,
		getGuildChannelsSyncedAt: async () => syncedAt,
		replaceGuildChannels: async (_db: any, _guild: string, channels: any[]) => {
			replaceResult = { success: replaceResult.success, stored: channels.length };
			return replaceResult;
		},
	};
});

vi.mock('$lib/db/managed-channels.js', () => ({
	listActiveManagedChannels: async () => managedRooms,
}));

const { GET: channelsGet } = await import('../routes/api/v1/channels/+server.js');
const { POST: syncPost } = await import('../routes/api/channels/sync/+server.js');

const platform = { env: { DB: {}, DISCORD_BOT_TOKEN: 'secret-token' } };
const event = (query = '') => ({
	request: new Request('https://bot.test/api/v1/channels'),
	platform,
	url: new URL(`https://bot.test/api/v1/channels${query}`),
});

const channel = (over: Record<string, any> = {}) => ({
	channelId: '100',
	name: 'general',
	type: 0,
	topic: 'Say hello',
	parentId: 'c1',
	parentName: 'Lobby',
	position: 0,
	...over,
});

beforeEach(() => {
	auth = { authenticated: true, guildId: 'g1', scopes: ['channels:read', 'commands:read'] };
	stored.length = 0;
	managedRooms = [];
	syncedAt = '2026-09-07T12:00:00Z';
	replaceResult = { success: true, stored: 0 };
});

describe('GET /api/v1/channels', () => {
	it('refuses a key without channels:read', async () => {
		auth = { authenticated: true, guildId: 'g1', scopes: ['voice:read'] };
		const response = await channelsGet(event() as any);
		expect(response.status).toBe(403);
		expect((await response.json()).error).toContain('channels:read');
	});

	it('passes an authentication failure through with its own status', async () => {
		auth = { authenticated: false, error: 'Invalid API key', status: 401 };
		expect((await channelsGet(event() as any)).status).toBe(401);
	});

	it('serves the directory grouped by category, in sidebar order', async () => {
		stored.push(
			channel({ channelId: '1', name: 'welcome', position: 0 }),
			channel({ channelId: '2', name: 'general', position: 1 }),
			channel({
				channelId: '3',
				name: 'focus-room',
				type: 2,
				parentId: 'c2',
				parentName: 'Work',
				position: 0,
			})
		);
		const body = await (await channelsGet(event() as any)).json();

		expect(body.count).toBe(3);
		expect(body.synced_at).toBe('2026-09-07T12:00:00Z');
		expect(body.categories.map((group: any) => group.category)).toEqual(['Lobby', 'Work']);
		expect(body.categories[0].channels.map((c: any) => c.name)).toEqual(['welcome', 'general']);
		expect(body.categories[1].channels[0].type).toBe('voice');
	});

	it('never lists a category as a channel of its own', async () => {
		stored.push(
			channel({ channelId: 'c1', name: 'Lobby', type: 4, parentId: null, parentName: null }),
			channel({ channelId: '1', name: 'general' })
		);
		const body = await (await channelsGet(event() as any)).json();
		expect(body.count).toBe(1);
		expect(body.channels.map((c: any) => c.name)).toEqual(['general']);
	});

	it('names Discord’s numeric types, and calls an unknown one "other"', async () => {
		stored.push(
			channel({ channelId: '1', type: 0 }),
			channel({ channelId: '2', type: 2 }),
			channel({ channelId: '3', type: 15 }),
			channel({ channelId: '4', type: 99 })
		);
		const body = await (await channelsGet(event() as any)).json();
		expect(body.channels.map((c: any) => c.type)).toEqual(['text', 'voice', 'forum', 'other']);
	});

	it('filters to one type on request', async () => {
		stored.push(channel({ channelId: '1', type: 0 }), channel({ channelId: '2', type: 2 }));
		const body = await (await channelsGet(event('?type=voice') as any)).json();
		expect(body.count).toBe(1);
		expect(body.channels[0].type).toBe('voice');
	});

	it('serves an empty directory rather than an error', async () => {
		syncedAt = null;
		const body = await (await channelsGet(event() as any)).json();
		expect(body).toMatchObject({ count: 0, categories: [], channels: [], synced_at: null });
	});

	it('reports a missing database', async () => {
		const response = await channelsGet({ ...event(), platform: { env: {} } } as any);
		expect(response.status).toBe(500);
	});
});

describe('POST /api/channels/sync', () => {
	const post = (body: unknown, token = 'Bot secret-token') =>
		syncPost({
			request: new Request('https://bot.test/api/channels/sync', {
				method: 'POST',
				headers: token ? { Authorization: token } : {},
				body: typeof body === 'string' ? body : JSON.stringify(body),
			}),
			platform,
		} as any);

	it('refuses anything but the bot token', async () => {
		expect((await post({ guild_id: 'g1', channels: [] }, 'Bearer nope')).status).toBe(401);
		expect((await post({ guild_id: 'g1', channels: [] }, '')).status).toBe(401);
	});

	it('drops rooms members created with /room', async () => {
		managedRooms = [{ channel_id: '900' }, { channel_id: '901' }];
		const response = await post({
			guild_id: 'g1',
			channels: [
				{ channel_id: '1', name: 'general' },
				{ channel_id: '900', name: "nova's room" },
				{ channel_id: '901', name: "quill's room" },
			],
		});
		expect((await response.json()).stored).toBe(1);
	});

	it('requires a guild id', async () => {
		expect((await post({ channels: [] })).status).toBe(400);
	});

	it('treats a missing channels key as malformed, not as an empty guild', async () => {
		// The difference matters: the second wipes the directory.
		expect((await post({ guild_id: 'g1' })).status).toBe(400);
		expect((await post({ guild_id: 'g1', channels: [] })).status).toBe(200);
	});

	it('refuses a body that is not JSON', async () => {
		expect((await post('not json')).status).toBe(400);
	});

	it('reports a failed write', async () => {
		replaceResult = { success: false, stored: 0 };
		expect((await post({ guild_id: 'g1', channels: [] })).status).toBe(500);
	});
});
