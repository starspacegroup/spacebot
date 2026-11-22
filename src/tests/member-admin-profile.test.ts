import { describe, expect, it, vi } from 'vitest';
import { createSqliteD1 } from './helpers/sqlite-d1.js';

vi.mock('$lib/db/logger.js', () => ({
	log: { error: () => {}, info: () => {}, warn: () => {}, debug: () => {} },
}));

import { accountCreatedAt, getMemberAdminProfile } from '$lib/db/member-admin-profile.js';

const G = '100000000000000001';
const U = '200000000000000002';
const O = '300000000000000003';
const sql = (t: number) => new Date(t).toISOString().slice(0, 19).replace('T', ' ');
const ago = (min: number) => sql(Date.now() - min * 60_000);

function setup() {
	const db = createSqliteD1(`
		CREATE TABLE guild_members_cache (guild_id TEXT, user_id TEXT, username TEXT, discriminator TEXT, global_name TEXT, avatar TEXT, nickname TEXT, guild_avatar TEXT, is_bot INTEGER, is_owner INTEGER, joined_at TEXT, premium_since TEXT, communication_disabled_until TEXT, roles TEXT, PRIMARY KEY (guild_id, user_id));
		CREATE TABLE guild_roles_cache (guild_id TEXT, role_id TEXT, name TEXT, color INTEGER, position INTEGER);
		CREATE TABLE event_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, event_type TEXT, actor_id TEXT, target_id TEXT, actor_name TEXT, target_name TEXT, actor_avatar TEXT, actor_discriminator TEXT, actor_is_bot INTEGER DEFAULT 0, channel_id TEXT, channel_name TEXT, created_at TEXT);
		CREATE TABLE voice_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, user_id TEXT, channel_id TEXT, channel_name TEXT, joined_at TEXT, left_at TEXT, duration_seconds INTEGER, join_event_id INTEGER, leave_event_id INTEGER, is_bot INTEGER);
		CREATE TABLE commands (id INTEGER PRIMARY KEY, name TEXT);
		CREATE TABLE command_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, command_id INTEGER, guild_id TEXT, user_id TEXT, created_at TEXT);
		CREATE TABLE guild_settings (guild_id TEXT, excluded_channels TEXT);
	`);
	db.exec(`
		INSERT INTO guild_members_cache VALUES ('${G}','${U}','ann','0','Ann S','hashA','Annie',NULL,0,0,'2026-01-02 03:04:05',NULL,NULL,'["r1","r2"]');
		INSERT INTO guild_members_cache VALUES ('${G}','${O}','bo','0',NULL,'hashB',NULL,NULL,0,0,NULL,NULL,NULL,'[]');
		INSERT INTO guild_roles_cache VALUES ('${G}','r1','Mod',16711680,5), ('${G}','r2','Regular',0,1);
		INSERT INTO voice_sessions (guild_id,user_id,channel_id,channel_name,joined_at,left_at,is_bot) VALUES
		  ('${G}','${U}','c1','General','${ago(120)}','${ago(60)}',0),
		  ('${G}','${O}','c1','General','${ago(110)}','${ago(80)}',0),
		  ('${G}','${U}','c2','Games','${ago(50)}','${ago(40)}',0);
		INSERT INTO event_logs (guild_id,event_type,actor_id,actor_name,channel_id,channel_name,created_at) VALUES
		  ('${G}','MESSAGE_CREATE','${U}','Ann','t1','chat','${ago(30)}'),
		  ('${G}','MESSAGE_CREATE','${U}','Ann','t1','chat','${ago(20)}'),
		  ('${G}','MESSAGE_CREATE','${U}','Ann','t2','memes','${ago(10)}');
		INSERT INTO event_logs (guild_id,event_type,actor_id,target_id,actor_name,target_name,created_at) VALUES
		  ('${G}','MEMBER_TIMEOUT','${O}','${U}','Bo','Ann','${ago(5)}');
		INSERT INTO commands VALUES (1,'ping');
		INSERT INTO command_logs (command_id,guild_id,user_id,created_at) VALUES (1,'${G}','${U}','${ago(3)}'), (1,'${G}','${U}','${ago(2)}');
	`);
	return db;
}

describe('member profile for admins', () => {
	it('reads the account creation time out of the id', () => {
		expect(accountCreatedAt('175928847299117063')).toBe('2016-04-30 11:18:25');
		expect(accountCreatedAt('not a number')).toBeNull();
	});

	it('reads the ISO times the members cache stores (a timeout in the future still counts)', async () => {
		const db: any = setup();
		const future = new Date(Date.now() + 3600_000).toISOString().replace('Z', '+00:00');
		db.exec(
			`UPDATE guild_members_cache SET joined_at='2025-09-04T08:05:40.110000+00:00', communication_disabled_until='${future}' WHERE user_id='${U}'`
		);
		const p = await getMemberAdminProfile(db, G, U, 30);
		expect(p.identity.joinedAt).toBe('2025-09-04T08:05:40.110000+00:00');
		expect(p.identity.timeoutUntil).toBe(future);
	});

	it('gathers identity, voice, people, messages, commands and moderation', async () => {
		const p = await getMemberAdminProfile(setup(), G, U, 30);
		expect(p.identity).toMatchObject({
			name: 'Annie',
			username: 'ann',
			inServer: true,
			joinedAt: '2026-01-02 03:04:05',
		});
		expect(p.identity.roles.map((r) => r.name)).toEqual(['Mod', 'Regular']);

		// 60 min in General + 10 in Games
		expect(p.voiceChannels[0]).toMatchObject({ channel: 'General', visits: 1 });
		expect(p.voiceChannels[0].seconds).toBeGreaterThanOrEqual(3590);
		expect(p.voiceChannels.map((c) => c.channel)).toEqual(['General', 'Games']);

		// Bo overlapped for 30 minutes
		expect(p.withPeople[0]).toMatchObject({ id: O, name: 'bo' });
		expect(p.withPeople[0].seconds).toBeGreaterThanOrEqual(1790);
		expect(p.withPeople[0].seconds).toBeLessThanOrEqual(1810);

		expect(p.messageChannels).toEqual([
			{ channel: 'chat', messages: 2 },
			{ channel: 'memes', messages: 1 },
		]);
		expect(p.messageChannels.reduce((n, c) => n + c.messages, 0)).toBe(
			p.hours.messages.reduce((n, v) => n + v, 0)
		);
		expect(p.commands[0]).toMatchObject({ command: 'ping', uses: 2 });
		expect(p.moderation[0]).toMatchObject({ type: 'MEMBER_TIMEOUT', by: 'Bo' });
		expect(p.recentEvents[0]).toMatchObject({
			type: 'MEMBER_TIMEOUT',
			as: 'target',
			other: 'Bo',
		});
	});

	it('does not list a member who is not in the server as present, and keeps a name from events', async () => {
		const db = setup();
		const p = await getMemberAdminProfile(db, G, '999999999999999999', 30);
		expect(p.identity.inServer).toBe(false);
		expect(p.identity.name).toBe('Unknown member');
	});

	it('says which part could not be read instead of showing zeros', async () => {
		const db = createSqliteD1(
			`CREATE TABLE guild_members_cache (guild_id TEXT, user_id TEXT);`
		);
		const p = await getMemberAdminProfile(db, G, U, 30);
		expect(p.failedParts.length).toBeGreaterThan(0);
	});

	it('clamps the window to what is kept', async () => {
		const p = await getMemberAdminProfile(setup(), G, U, 9999);
		expect(p.days).toBe(90);
	});
});
