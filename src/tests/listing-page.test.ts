import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/discord/guilds.js', () => ({
	verifyGuildAdmin: vi.fn(async () => ({ authorized: false })),
	hasFullAdminPermission: vi.fn(() => false),
}));

import { actions } from '../routes/admin/[serverId]/listing/+page.server.js';
import { createSqliteD1 } from './helpers/sqlite-d1.js';

const GUILD = '111111111111111111';
const SUPERADMIN = '900000000000000001';

const SCHEMA = `
	CREATE TABLE guild_listings (
		guild_id TEXT PRIMARY KEY,
		listed INTEGER NOT NULL DEFAULT 0,
		headline TEXT, description TEXT, category TEXT,
		tags TEXT NOT NULL DEFAULT '[]',
		invite_url TEXT,
		show_member_count INTEGER NOT NULL DEFAULT 1,
		nsfw INTEGER NOT NULL DEFAULT 0,
		review_status TEXT NOT NULL DEFAULT 'approved',
		review_note TEXT, listed_at DATETIME, submitted_by TEXT,
		created_at DATETIME, updated_at DATETIME
	);
`;

function call(db: any, fields: Record<string, string>, userId = SUPERADMIN) {
	const formData = new FormData();
	for (const [key, value] of Object.entries(fields)) formData.set(key, value);
	return (actions as any).save({
		request: { formData: async () => formData },
		cookies: { get: (name: string) => (name === 'discord_user_id' ? userId : 'token') },
		platform: { env: { DB: db, ADMIN_USER_IDS: SUPERADMIN } },
		params: { serverId: GUILD },
	});
}

const GOOD = {
	listed: 'on',
	headline: 'A friendly place for builders',
	description: 'We build bots.',
	category: 'tech',
	tags: 'coding, open source',
	invite_url: 'discord.gg/abc123',
	show_member_count: 'on',
};

describe('listing page save', () => {
	it('stores a valid listing, canonicalizing the invite', async () => {
		const db = createSqliteD1(SCHEMA);
		const result = await call(db, GOOD);
		expect(result.success).toBe(true);

		const row = await db
			.prepare('SELECT * FROM guild_listings WHERE guild_id = ?')
			.bind(GUILD)
			.first();
		expect(row.listed).toBe(1);
		expect(row.invite_url).toBe('https://discord.gg/abc123');
		expect(JSON.parse(row.tags)).toEqual(['coding', 'open source']);
		expect(row.submitted_by).toBe(SUPERADMIN);
	});

	it('treats a missing listed field as unlisted, so nothing publishes by accident', async () => {
		const db = createSqliteD1(SCHEMA);
		await call(db, { ...GOOD, listed: '' });
		const row = await db
			.prepare('SELECT listed FROM guild_listings WHERE guild_id = ?')
			.bind(GUILD)
			.first();
		expect(row.listed).toBe(0);
	});

	it('refuses to publish without a headline or a working invite, and saves nothing', async () => {
		const db = createSqliteD1(SCHEMA);
		const result: any = await call(db, {
			...GOOD,
			headline: '',
			invite_url: 'https://evil.example.com',
		});
		expect(result.status).toBe(400);
		expect(Object.keys(result.data.errors)).toEqual(
			expect.arrayContaining(['headline', 'invite_url'])
		);
		const row = await db
			.prepare('SELECT * FROM guild_listings WHERE guild_id = ?')
			.bind(GUILD)
			.first();
		expect(row).toBeNull();
	});

	it('lets a draft be saved with blanks while unlisted', async () => {
		const db = createSqliteD1(SCHEMA);
		const result = await call(db, { listed: '', headline: '', invite_url: '' });
		expect(result.success).toBe(true);
	});

	it('does not let an editor clear an operator takedown', async () => {
		const db = createSqliteD1(SCHEMA);
		await db
			.prepare(
				"INSERT INTO guild_listings (guild_id, listed, review_status, review_note) VALUES (?, 1, 'rejected', 'spam')"
			)
			.bind(GUILD)
			.run();
		await call(db, GOOD);
		const row = await db
			.prepare('SELECT review_status FROM guild_listings WHERE guild_id = ?')
			.bind(GUILD)
			.first();
		expect(row.review_status).toBe('rejected');
	});

	it('rejects someone who is not a full administrator', async () => {
		const db = createSqliteD1(SCHEMA);
		const result: any = await call(db, GOOD, '123456789012345678');
		expect(result.status).toBe(403);
		const row = await db
			.prepare('SELECT * FROM guild_listings WHERE guild_id = ?')
			.bind(GUILD)
			.first();
		expect(row).toBeNull();
	});
});
