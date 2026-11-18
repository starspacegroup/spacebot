import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSqliteD1 } from './helpers/sqlite-d1.js';

const enabled = { on: true };
vi.mock('../lib/db/commands.js', () => ({
	getCommandByName: async () => (enabled.on ? { name: 'topic' } : null),
}));

import { handleTopicCommand } from '../lib/server/topic-command.js';
import { TOPICS, TOPIC_KINDS, pickTopic } from '../lib/server/topics.js';

const SCHEMA = `
CREATE TABLE live_voice_states (guild_id TEXT, user_id TEXT, channel_id TEXT, is_bot INTEGER DEFAULT 0);
CREATE TABLE topic_settings (
	guild_id TEXT PRIMARY KEY, set_voice_status INTEGER NOT NULL DEFAULT 0,
	last_topic TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);`;

const body = (sub: string, options: any[] = [], over: any = {}) => ({
	guild_id: 'g1',
	channel_id: 'vc1',
	member: { user: { id: 'u1' }, permissions: '0' },
	data: { name: 'topic', options: [{ name: sub, type: 1, options }] },
	...over,
});
const MANAGE = String(1 << 5);

let db: any;
let setVoiceStatus: any;
let discord: any;
beforeEach(() => {
	enabled.on = true;
	db = createSqliteD1(SCHEMA);
	setVoiceStatus = vi.fn(async () => ({}));
	discord = { channels: { setVoiceStatus } };
});
const turnOn = () =>
	handleTopicCommand(
		body('settings', [{ name: 'set_voice_status', value: true }], {
			member: { user: { id: 'owner' }, permissions: MANAGE },
		}),
		db,
		discord
	);

describe('topics', () => {
	it('every kind has enough short topics and none repeat', () => {
		const all = Object.values(TOPICS).flat();
		expect(new Set(all).size).toBe(all.length);
		for (const k of TOPIC_KINDS) expect(TOPICS[k].length).toBeGreaterThanOrEqual(20);
		for (const t of all) expect(t.length).toBeLessThanOrEqual(200);
	});
	it('picks from the kind asked, and never the last one shown', () => {
		for (let i = 0; i < 50; i++) {
			expect(TOPICS.food).toContain(pickTopic('food'));
			expect(pickTopic('debate', TOPICS.debate[0], () => 0)).not.toBe(TOPICS.debate[0]);
		}
		expect(Object.values(TOPICS).flat()).toContain(pickTopic('nope'));
	});
});

describe('/topic', () => {
	it('is off until the server turns it on', async () => {
		enabled.on = false;
		const r: any = await handleTopicCommand(body('new'), db, discord);
		expect(r.data.content).toMatch(/not turned on/);
		expect(r.data.flags).toBe(64);
	});

	it('posts a topic in the channel and sets no status by default', async () => {
		const r: any = await handleTopicCommand(body('new'), db, discord);
		expect(r.data.content).toMatch(/^💬 \*\*/);
		expect(r.data.flags).toBeUndefined();
		expect(r.data.allowed_mentions).toEqual({ parse: [] });
		expect(setVoiceStatus).not.toHaveBeenCalled();
	});

	it('only people with Manage Server can change the option', async () => {
		const r: any = await handleTopicCommand(
			body('settings', [{ name: 'set_voice_status', value: true }]),
			db,
			discord
		);
		expect(r.data.content).toMatch(/Only people with Manage Server/);
		expect((await db.prepare('SELECT * FROM topic_settings').all()).results).toEqual([]);
	});

	it('with the option on, a member in the voice channel sets its status from its chat', async () => {
		await turnOn();
		db.exec(`INSERT INTO live_voice_states VALUES ('g1','u1','vc1',0)`);
		const r: any = await handleTopicCommand(body('new'), db, discord);
		const topic = r.data.content.match(/\*\*(.+)\*\*/)[1];
		expect(setVoiceStatus).toHaveBeenCalledWith('vc1', topic, 'Set by /topic');
		expect(r.data.content).toMatch(/Set as this voice channel/);
	});

	it('does not set it for someone outside that voice channel, or in a normal channel', async () => {
		await turnOn();
		await handleTopicCommand(body('new'), db, discord); // not in voice at all
		db.exec(`INSERT INTO live_voice_states VALUES ('g1','u1','vc2',0)`);
		await handleTopicCommand(body('new'), db, discord); // in a different voice channel
		await handleTopicCommand(body('new', [], { channel_id: 'text1' }), db, discord);
		expect(setVoiceStatus).not.toHaveBeenCalled();
	});

	it('says so when Discord refuses the status, and still posts the topic', async () => {
		await turnOn();
		db.exec(`INSERT INTO live_voice_states VALUES ('g1','u1','vc1',0)`);
		setVoiceStatus.mockRejectedValue({ status: 403, message: 'Missing Permissions' });
		const r: any = await handleTopicCommand(body('new'), db, discord);
		expect(r.data.content).toMatch(/^💬 \*\*/);
		expect(r.data.content).toMatch(/Set Voice Channel Status permission/);
	});

	it('does not repeat the topic it showed last', async () => {
		let last = '';
		for (let i = 0; i < 20; i++) {
			const r: any = await handleTopicCommand(body('new'), db, discord, () => 0);
			const t = r.data.content.match(/\*\*(.+?)\*\*/)[1];
			expect(t).not.toBe(last);
			last = t;
		}
	});

	it('the migration ships the command off and creates the settings table', () => {
		const sql = readFileSync('migrations/0101_topic_command.sql', 'utf8');
		expect(sql).toMatch(/'topic', '[^']+', 0, 1/);
		expect(sql).toContain('CREATE TABLE IF NOT EXISTS topic_settings');
	});
});
