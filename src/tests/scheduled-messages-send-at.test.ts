import { describe, expect, it } from 'vitest';
import { createScheduledMessage, getPendingMessages } from '../lib/db/scheduled-messages.js';

function fakeDb() {
	const calls: { sql: string; args: any[] }[] = [];
	const db = {
		prepare: (sql: string) => ({
			bind: (...args: any[]) => {
				calls.push({ sql, args });
				return {
					run: async () => ({ meta: { last_row_id: 5 } }),
					all: async () => ({ results: [] }),
				};
			},
		}),
	};
	return { db, calls };
}

describe('createScheduledMessage send_at', () => {
	it('stores an absolute future time', async () => {
		const { db, calls } = fakeDb();
		const at = new Date(Date.now() + 3600_000).toISOString();
		const res = await createScheduledMessage(db, {
			guild_id: '1',
			channel_id: '2',
			action_type: 'SEND_MESSAGE',
			message_payload: { content: 'x' },
			send_at: at,
		});
		expect(res).toEqual({ success: true, id: 5, send_at: at });
		expect(calls[0].args[5]).toBe(at);
	});

	it('refuses a past or unparseable time', async () => {
		const { db } = fakeDb();
		const base = { guild_id: '1', action_type: 'SEND_MESSAGE', message_payload: {} };
		expect(
			(await createScheduledMessage(db, { ...base, send_at: '2000-01-01T00:00:00Z' })).success
		).toBe(false);
		expect((await createScheduledMessage(db, { ...base, send_at: 'soon' })).success).toBe(
			false
		);
	});

	it('still takes a relative delay', async () => {
		const { db } = fakeDb();
		const res = await createScheduledMessage(db, {
			guild_id: '1',
			action_type: 'SEND_MESSAGE',
			message_payload: {},
			delay: '5m',
		});
		expect(res.success).toBe(true);
	});
});

describe('getPendingMessages', () => {
	it('normalises the stored ISO time before comparing with now', async () => {
		const { db, calls } = fakeDb();
		await getPendingMessages(db);
		expect(calls[0].sql).toContain("datetime(send_at) <= datetime('now')");
	});
});
