import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteD1 } from './helpers/sqlite-d1.js';

const auth = { ok: true };
vi.mock('../lib/discord/guilds.js', () => ({
	verifyGuildAdmin: async () => (auth.ok ? { authorized: true } : { authorized: false }),
}));
const setEnabled = vi.fn(async () => ({ ok: true }));
vi.mock('../lib/server/control-actions.js', () => ({
	setCommandEnabled: (...a: any[]) => (setEnabled as any)(...a),
}));
const statusCalls: any[] = [];
vi.mock('../lib/discord/rest-client.js', () => ({
	createDiscordRestClient: () => ({
		channels: {
			setVoiceStatus: async (...a: any[]) => {
				statusCalls.push(a);
				return {};
			},
		},
	}),
}));
vi.mock('../lib/db/guild-channels.js', () => ({
	CHANNEL_TYPES: { VOICE: 2, STAGE: 13, TEXT: 0 },
	getGuildChannels: async () => [
		{ channelId: 'vc1', name: 'Lounge', type: 2, parentName: 'Voice' },
		{ channelId: 'tx1', name: 'general', type: 0, parentName: null },
	],
}));
vi.mock('../lib/db/commands.js', () => ({
	getCommandByName: async () => ({ name: 'topic' }),
	getBuiltInCommandsForGuild: async () => [{ id: 7, name: 'topic', enabled: false }],
}));

import { actions, load } from '../routes/admin/[serverId]/topics/+page.server.js';

const SCHEMA = `
CREATE TABLE topic_settings (guild_id TEXT PRIMARY KEY, set_voice_status INTEGER NOT NULL DEFAULT 0,
	custom_only INTEGER NOT NULL DEFAULT 0, last_topic TEXT, updated_at TEXT DEFAULT (datetime('now')));
CREATE TABLE topic_custom (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, text TEXT NOT NULL,
	added_by TEXT, created_at TEXT DEFAULT (datetime('now')));`;
const G = '123456789012345678';

let db: any;
const event = (fields: Record<string, string>) => ({
	request: { formData: async () => new Map(Object.entries(fields)) as any },
	cookies: { get: (k: string) => ({ discord_access_token: 't', discord_user_id: 'u9' })[k] },
	platform: { env: { DB: db, DISCORD_BOT_TOKEN: 'tok' } },
	params: { serverId: G },
});

beforeEach(() => {
	auth.ok = true;
	statusCalls.length = 0;
	setEnabled.mockClear();
	db = createSqliteD1(SCHEMA);
});

describe('topics dashboard', () => {
	it('loads the command, options, own topics and only voice channels', async () => {
		db.exec(
			`INSERT INTO topic_custom (guild_id,text) VALUES ('${G}','Mine'),('other','Theirs')`
		);
		const data: any = await load({
			platform: { env: { DB: db } },
			params: { serverId: G },
			parent: async () => ({ adminGuilds: [{ id: G }] }),
		} as any);
		expect(data).toMatchObject({ available: true, enabled: false, commandId: 7 });
		expect(data.topics.map((t: any) => t.text)).toEqual(['Mine']);
		expect(data.voiceChannels).toEqual([{ id: 'vc1', name: 'Lounge', parent: 'Voice' }]);
	});

	it('sends someone who does not manage the server away', async () => {
		await expect(
			load({
				platform: { env: { DB: db } },
				params: { serverId: G },
				parent: async () => ({ adminGuilds: [{ id: '1' }], isSuperAdmin: false }),
			} as any)
		).rejects.toMatchObject({ status: 302 });
	});

	it('every write is refused without Manage Server', async () => {
		auth.ok = false;
		for (const [name, fields] of [
			['enable', { command_id: '7', enabled: 'on' }],
			['options', { custom_only: 'on' }],
			['add', { text: 'x' }],
			['remove', { id: '1' }],
			['voice', { channel_id: 'vc1', mode: 'set', text: 'x' }],
		] as const) {
			const r: any = await (actions as any)[name](event(fields));
			expect(r.status, name).toBe(403);
		}
		expect(setEnabled).not.toHaveBeenCalled();
		expect(statusCalls).toEqual([]);
		expect((await db.prepare('SELECT * FROM topic_custom').all()).results).toEqual([]);
	});

	it('turns the command on through the normal command toggle', async () => {
		const r: any = await actions.enable(event({ command_id: '7', enabled: 'on' }) as any);
		expect(r.success).toBe(true);
		expect(setEnabled.mock.calls[0].slice(2)).toEqual([G, 7, true]);
	});

	it('saves both options, and an unchecked box means off', async () => {
		await actions.options(event({ set_voice_status: 'on', custom_only: 'on' }) as any);
		let row: any = await db.prepare('SELECT * FROM topic_settings').first();
		expect([row.set_voice_status, row.custom_only]).toEqual([1, 1]);
		await actions.options(event({ custom_only: 'on' }) as any);
		row = await db.prepare('SELECT * FROM topic_settings').first();
		expect([row.set_voice_status, row.custom_only]).toEqual([0, 1]);
	});

	it("adds and removes topics, refusing a duplicate and another server's topic", async () => {
		expect(
			((await actions.add(event({ text: ' Is soup a drink? ' }) as any)) as any).success
		).toBe(true);
		const dup: any = await actions.add(event({ text: 'is soup a drink?' }) as any);
		expect(dup.status).toBe(400);
		db.exec(`INSERT INTO topic_custom (guild_id,text) VALUES ('other','Theirs')`);
		const other: any = await actions.remove(event({ id: '2' }) as any);
		expect(other.status).toBe(404);
		expect(((await actions.remove(event({ id: '1' }) as any)) as any).success).toBe(true);
	});

	it("sets and clears a voice channel, only from this server's own channel list", async () => {
		const set: any = await actions.voice(
			event({ channel_id: 'vc1', mode: 'set', text: 'Movie night' }) as any
		);
		expect(set.success).toBe(true);
		expect(statusCalls[0].slice(0, 2)).toEqual(['vc1', 'Movie night']);
		await actions.voice(event({ channel_id: 'vc1', mode: 'clear' }) as any);
		expect(statusCalls[1].slice(0, 2)).toEqual(['vc1', '']);
		for (const channel_id of ['tx1', 'nope']) {
			const bad: any = await actions.voice(
				event({ channel_id, mode: 'set', text: 'x' }) as any
			);
			expect(bad.status, channel_id).toBe(400);
		}
		expect(statusCalls).toHaveLength(2);
	});
});
