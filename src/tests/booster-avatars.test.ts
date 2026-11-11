import { describe, expect, it } from 'vitest';
import { createSqliteD1 } from './helpers/sqlite-d1.js';
import { getBoostingMembersFromCache } from '../lib/db/guild-cache.js';
import { getAvatarUrl } from '../lib/utils/avatar.js';

function seed() {
	return createSqliteD1(`
		CREATE TABLE guild_members_cache (
			guild_id TEXT, user_id TEXT, username TEXT, discriminator TEXT, global_name TEXT,
			nickname TEXT, avatar TEXT, guild_avatar TEXT, is_bot INTEGER DEFAULT 0,
			premium_since TEXT
		);
		INSERT INTO guild_members_cache VALUES
			('g1','u1','davis9001','0','David','davis','globalhash','serverhash',0,'2025-05-11 10:00:00'),
			('g1','u2','plain','0',NULL,NULL,'abc',NULL,0,'2025-06-11 10:00:00');
	`);
}

describe('boosters: server avatars', () => {
	it('gives a server avatar as its guild URL, not a bare hash that 404s as a global one', async () => {
		const rows = await getBoostingMembersFromCache(seed(), 'g1');
		const davis = rows.find((r) => r.user_id === 'u1')!;
		expect(davis.guild_avatar).toBe(
			'https://cdn.discordapp.com/guilds/g1/users/u1/avatars/serverhash.png?size=64'
		);
		expect(getAvatarUrl('u1', davis.guild_avatar || davis.avatar, '0', 20)).toContain(
			'/guilds/g1/users/u1/avatars/serverhash.png'
		);
	});

	it('falls back to the global avatar when there is no server avatar', async () => {
		const rows = await getBoostingMembersFromCache(seed(), 'g1');
		const plain = rows.find((r) => r.user_id === 'u2')!;
		expect(plain.guild_avatar).toBeNull();
		expect(getAvatarUrl('u2', plain.guild_avatar || plain.avatar, '0', 20)).toContain(
			'/avatars/u2/abc.png'
		);
	});
});
