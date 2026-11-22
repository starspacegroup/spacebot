import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSqliteD1 } from './helpers/sqlite-d1.js';
import { GET } from '../routes/servers/[guildId]/join/+server.js';

const migration = (file: string) =>
	readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8');

const GUILD = '100000000000000001';
const HIDDEN = '100000000000000002';
const NO_INVITE = '100000000000000003';

let db: ReturnType<typeof createSqliteD1>;
const call = (guildId: string, headers: Record<string, string> = {}) =>
	GET({
		platform: { env: { DB: db } },
		params: { guildId },
		request: new Request(`https://x.test/servers/${guildId}/join`, {
			headers: { 'user-agent': 'Mozilla/5.0 Firefox/130', ...headers },
		}),
	} as any);
const joins = async (id = GUILD) =>
	(
		await db
			.prepare(
				'SELECT COALESCE(SUM(joins), 0) AS j FROM site_listing_daily WHERE guild_id = ?'
			)
			.bind(id)
			.first()
	)?.j;

beforeEach(() => {
	db = createSqliteD1(
		migration('0022_guild_metadata.sql') +
			migration('0059_public_server_listings.sql') +
			migration('0091_site_listing_daily.sql')
	);
	const row = (id: string, status: string, invite: string | null) => {
		db.exec(
			`INSERT INTO guild_metadata (guild_id, name, fetched_at) VALUES ('${id}', 'S', datetime('now'));`
		);
		db.prepare(
			`INSERT INTO guild_listings (guild_id, listed, review_status, invite_url) VALUES (?, 1, ?, ?)`
		)
			.bind(id, status, invite)
			.run();
	};
	row(GUILD, 'approved', 'https://discord.gg/abc123');
	row(HIDDEN, 'rejected', 'https://discord.gg/hidden');
	row(NO_INVITE, 'approved', null);
});

describe('Join button route', () => {
	it('counts the press and redirects to the stored invite', async () => {
		await expect(call(GUILD)).rejects.toMatchObject({
			status: 302,
			location: 'https://discord.gg/abc123',
		});
		expect(await joins()).toBe(1);
	});

	it('does not count a bot or a prefetch, but still redirects', async () => {
		await expect(call(GUILD, { 'user-agent': 'Googlebot/2.1' })).rejects.toMatchObject({
			status: 302,
		});
		await expect(call(GUILD, { 'sec-purpose': 'prefetch' })).rejects.toMatchObject({
			status: 302,
		});
		expect(await joins()).toBe(0);
	});

	it('404s for a hidden listing, one with no invite, an unknown id and a bad id', async () => {
		for (const id of [HIDDEN, NO_INVITE, '100000000000000099', 'x; DROP TABLE']) {
			await expect(call(id)).rejects.toMatchObject({ status: 404 });
			expect(await joins(id)).toBe(0);
		}
	});
});
