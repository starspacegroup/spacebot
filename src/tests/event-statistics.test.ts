import { describe, expect, it } from 'vitest';
import { getEventStatistics } from '$lib/db/statistics.js';
import { createSqliteD1 } from './helpers/sqlite-d1.js';

describe('getEventStatistics', () => {
	it('counts totals, windows, bots, categories and types from one query', async () => {
		const db: any = createSqliteD1();
		db.exec(
			`CREATE TABLE event_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, event_type TEXT, event_category TEXT, actor_id TEXT, actor_name TEXT, actor_is_bot INTEGER, actor_avatar TEXT, actor_discriminator TEXT, channel_id TEXT, channel_name TEXT, created_at TEXT)`
		);
		const ins = (type: string, cat: string, name: string, bot: number, ago: string) =>
			db
				.prepare(
					`INSERT INTO event_logs (guild_id,event_type,event_category,actor_id,actor_name,actor_is_bot,created_at) VALUES ('g',?,?,?,?,?,datetime('now',?))`
				)
				.bind(type, cat, name, name, bot, ago)
				.run();
		await ins('MESSAGE_CREATE', 'message', 'ann', 0, '-1 hour');
		await ins('MESSAGE_CREATE', 'message', 'ann', 0, '-3 days');
		// A bot is the account's own bot flag, never its name: Abbott below is a person.
		await ins('MESSAGE_CREATE', 'message', 'helper', 1, '-3 days');
		await ins('MEMBER_JOIN', 'member', 'Abbott', 0, '-20 days');
		await ins('MEMBER_JOIN', 'member', 'x', 1, '-60 days');
		const e = await getEventStatistics(db, 'g');
		expect(e.total).toBe(5);
		expect(e.totalNonBot).toBe(3);
		expect(e.today).toBe(1);
		expect(e.thisWeek).toBe(3);
		expect(e.thisWeekNonBot).toBe(2);
		expect(e.thisMonth).toBe(4);
		expect(e.byCategory).toEqual({ message: 3, member: 2 });
		expect(e.byCategoryNonBot).toEqual({ message: 2, member: 1 });
		expect(e.byType[0]).toMatchObject({
			event_type: 'MESSAGE_CREATE',
			count: 3,
			non_bot_count: 2,
		});
	});
});
