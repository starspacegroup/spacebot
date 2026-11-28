import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSqliteD1 } from './helpers/sqlite-d1.js';
import {
	getAnnouncementChannel,
	postAnnouncement,
	setAnnouncementChannel,
} from '../lib/server/announcements.js';
import { saveGuildSettings } from '../lib/db/settings.js';

const migration = (file: string) =>
	readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8');

const GUILD = '100000000000000001';
const CH = '200000000000000001';
const VC = '200000000000000002';

let db: ReturnType<typeof createSqliteD1>;
beforeEach(() => {
	db = createSqliteD1(
		migration('0001_create_event_logs.sql') +
			`ALTER TABLE guild_settings ADD COLUMN prefix TEXT DEFAULT '!';
			 ALTER TABLE guild_settings ADD COLUMN moderation_role_id TEXT;
			 ALTER TABLE guild_settings ADD COLUMN permission_settings TEXT;
			 ALTER TABLE guild_settings ADD COLUMN timezone TEXT;
			 ALTER TABLE guild_settings ADD COLUMN log_embed_colors TEXT;` +
			migration('0089_announcement_channel.sql') +
			'CREATE TABLE guild_channels (guild_id TEXT, channel_id TEXT, name TEXT, type INTEGER);'
	);
});

describe('announcement channel', () => {
	it('starts empty, then holds the channel, then clears', async () => {
		expect(await getAnnouncementChannel(db, GUILD)).toBeNull();
		expect(await setAnnouncementChannel(db, GUILD, CH)).toBeNull();
		expect(await getAnnouncementChannel(db, GUILD)).toBe(CH);
		expect(await setAnnouncementChannel(db, GUILD, null)).toBeNull();
		expect(await getAnnouncementChannel(db, GUILD)).toBeNull();
	});

	it('refuses a non-channel and a known voice channel, and keeps the old value', async () => {
		await setAnnouncementChannel(db, GUILD, CH);
		expect(await setAnnouncementChannel(db, GUILD, 'general')).toContain('not a channel');
		db.exec(`INSERT INTO guild_channels VALUES ('${GUILD}', '${VC}', 'vc', 2);`);
		expect(await setAnnouncementChannel(db, GUILD, VC)).toContain('text or announcement');
		expect(await getAnnouncementChannel(db, GUILD)).toBe(CH);
	});

	it('survives the bulk settings save', async () => {
		await setAnnouncementChannel(db, GUILD, CH);
		await saveGuildSettings(db, GUILD, { prefix: '?', logging_enabled: true });
		expect(await getAnnouncementChannel(db, GUILD)).toBe(CH);
		// ...and the other order: settings first, channel after.
		await saveGuildSettings(db, '100000000000000002', { prefix: '?' });
		await setAnnouncementChannel(db, '100000000000000002', CH);
		expect(await getAnnouncementChannel(db, '100000000000000002')).toBe(CH);
	});
});

describe('postAnnouncement', () => {
	const discordThatSends = () => {
		const sent: any[] = [];
		return {
			sent,
			channels: {
				send: async (channelId: string, payload: any) => {
					sent.push({ channelId, payload });
					return { id: 'm1' };
				},
			},
		};
	};

	it('posts to the chosen channel with mentions off', async () => {
		await setAnnouncementChannel(db, GUILD, CH);
		const discord = discordThatSends();
		const out = await postAnnouncement(db, discord, GUILD, '@everyone big change');
		expect(out).toEqual({ sent: true, messageId: 'm1' });
		expect(discord.sent[0]).toMatchObject({
			channelId: CH,
			payload: { allowed_mentions: { parse: [] } },
		});
	});

	it('posts nothing when no channel is set', async () => {
		const discord = discordThatSends();
		expect(await postAnnouncement(db, discord, GUILD, 'hi')).toEqual({
			sent: false,
			reason: 'no_channel',
		});
		expect(discord.sent).toHaveLength(0);
	});

	it('reports a failed post instead of throwing', async () => {
		await setAnnouncementChannel(db, GUILD, CH);
		const discord = {
			channels: {
				send: async () => {
					throw new Error('Missing Access');
				},
			},
		};
		expect(await postAnnouncement(db, discord, GUILD, 'hi')).toEqual({
			sent: false,
			reason: 'failed',
		});
	});
});
