import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	getGuildChannels,
	getGuildChannelsSyncedAt,
	normalizeChannel,
	replaceGuildChannels,
} from '../lib/db/guild-channels.js';

/**
 * The public channel directory: what gets stored, what gets refused, and the
 * shape the v1 endpoint serves. The privacy filters are covered in
 * `guild-channels-api.test.ts` — this file is the storage layer.
 */

type Row = Record<string, any>;

class FakeDb {
	rows: Row[] = [];
	batches = 0;
	failNext = false;

	prepare(sql: string) {
		const db = this;
		let args: any[] = [];
		const statement = {
			sql,
			get args() {
				return args;
			},
			bind(...next: any[]) {
				args = next;
				return statement;
			},
			async all() {
				if (db.failNext) throw new Error('boom');
				if (/FROM guild_channels/i.test(sql)) {
					return { results: db.rows.filter((row) => row.guild_id === args[0]) };
				}
				return { results: [] };
			},
			async first() {
				if (db.failNext) throw new Error('boom');
				const mine = db.rows.filter((row) => row.guild_id === args[0]);
				if (!mine.length) return { synced_at: null };
				return { synced_at: mine[mine.length - 1].synced_at };
			},
			async run() {
				return { success: true };
			},
			_apply() {
				if (/^DELETE FROM guild_channels/i.test(sql)) {
					db.rows = db.rows.filter((row) => row.guild_id !== args[0]);
					return;
				}
				const [guild_id, channel_id, name, type, topic, parent_id, parent_name, position] =
					args;
				db.rows.push({
					guild_id,
					channel_id,
					name,
					type,
					topic,
					parent_id,
					parent_name,
					position,
					synced_at: '2026-09-07T12:00:00Z',
				});
			},
		};
		return statement;
	}

	async batch(statements: any[]) {
		if (this.failNext) throw new Error('batch failed');
		this.batches++;
		for (const statement of statements) statement._apply();
		return statements.map(() => ({ success: true }));
	}
}

const channel = (over: Row = {}) => ({
	channel_id: '100',
	name: 'general',
	type: 0,
	topic: 'Say hello',
	parent_id: '1',
	parent_name: 'Lobby',
	position: 0,
	...over,
});

describe('normalizeChannel', () => {
	it('keeps a complete channel and trims its strings', () => {
		expect(normalizeChannel(channel({ name: '  general  ', topic: '  Say hello  ' }))).toEqual({
			channelId: '100',
			name: 'general',
			type: 0,
			topic: 'Say hello',
			parentId: '1',
			parentName: 'Lobby',
			position: 0,
		});
	});

	it('refuses a channel with no id or no name', () => {
		// A nameless entry on a public page is worse than a missing one.
		expect(normalizeChannel(channel({ channel_id: '' }))).toBeNull();
		expect(normalizeChannel(channel({ name: '   ' }))).toBeNull();
		expect(normalizeChannel({})).toBeNull();
	});

	it('treats an empty topic as absent rather than as an empty string', () => {
		expect(normalizeChannel(channel({ topic: '   ' }))?.topic).toBeNull();
		expect(normalizeChannel(channel({ topic: 42 }))?.topic).toBeNull();
	});

	it('falls back to zero for an unusable type or position', () => {
		const row = normalizeChannel(channel({ type: 'voice', position: NaN }));
		expect(row?.type).toBe(0);
		expect(row?.position).toBe(0);
	});

	it('truncates a fractional position rather than storing it', () => {
		expect(normalizeChannel(channel({ position: 3.9 }))?.position).toBe(3);
	});
});

describe('replaceGuildChannels', () => {
	let db: FakeDb;
	beforeEach(() => {
		db = new FakeDb();
	});

	it('stores a directory and reads it back', async () => {
		const result = await replaceGuildChannels(db, 'g1', [
			channel(),
			channel({ channel_id: '101', name: 'voice-lounge', type: 2, topic: null }),
		]);
		expect(result).toMatchObject({ success: true, stored: 2 });
		expect(await getGuildChannels(db, 'g1')).toHaveLength(2);
	});

	it('replaces rather than appends, so a deleted channel disappears', async () => {
		await replaceGuildChannels(db, 'g1', [
			channel(),
			channel({ channel_id: '101', name: 'old' }),
		]);
		await replaceGuildChannels(db, 'g1', [channel()]);
		const stored = await getGuildChannels(db, 'g1');
		expect(stored).toHaveLength(1);
		expect(stored[0].name).toBe('general');
	});

	it('leaves another guild alone', async () => {
		await replaceGuildChannels(db, 'g1', [channel()]);
		await replaceGuildChannels(db, 'g2', [channel({ channel_id: '200', name: 'other' })]);
		expect(await getGuildChannels(db, 'g1')).toHaveLength(1);
		expect(await getGuildChannels(db, 'g2')).toHaveLength(1);
	});

	it('accepts an empty sync and clears the guild', async () => {
		await replaceGuildChannels(db, 'g1', [channel()]);
		const result = await replaceGuildChannels(db, 'g1', []);
		expect(result).toMatchObject({ success: true, stored: 0 });
		expect(await getGuildChannels(db, 'g1')).toEqual([]);
	});

	it('keeps the last copy when a channel arrives twice', async () => {
		const result = await replaceGuildChannels(db, 'g1', [
			channel({ name: 'first' }),
			channel({ name: 'second' }),
		]);
		expect(result.stored).toBe(1);
		expect((await getGuildChannels(db, 'g1'))[0].name).toBe('second');
	});

	it('drops unusable entries instead of failing the whole sync', async () => {
		const result = await replaceGuildChannels(db, 'g1', [
			channel(),
			{ name: 'no id' },
			null as any,
		]);
		expect(result.stored).toBe(1);
	});

	it('writes in one batch, so a reader never sees a half-replaced directory', async () => {
		await replaceGuildChannels(db, 'g1', [channel(), channel({ channel_id: '101' })]);
		expect(db.batches).toBe(1);
	});

	it('reports a missing database or guild rather than throwing', async () => {
		expect(await replaceGuildChannels(null, 'g1', [channel()])).toMatchObject({
			success: false,
		});
		expect(await replaceGuildChannels(db, '', [channel()])).toMatchObject({ success: false });
	});

	it('reports a failed write rather than throwing', async () => {
		db.failNext = true;
		const result = await replaceGuildChannels(db, 'g1', [channel()]);
		expect(result).toMatchObject({ success: false, stored: 0 });
		expect(result.error).toBeTruthy();
	});

	it('survives a non-array argument', async () => {
		expect(await replaceGuildChannels(db, 'g1', 'nope' as any)).toMatchObject({ stored: 0 });
	});
});

describe('getGuildChannels', () => {
	it('answers empty for a missing database, guild, or read failure', async () => {
		const db = new FakeDb();
		expect(await getGuildChannels(null, 'g1')).toEqual([]);
		expect(await getGuildChannels(db, '')).toEqual([]);
		db.failNext = true;
		expect(await getGuildChannels(db, 'g1')).toEqual([]);
	});
});

describe('getGuildChannelsSyncedAt', () => {
	it('reports when the directory was last written', async () => {
		const db = new FakeDb();
		await replaceGuildChannels(db, 'g1', [channel()]);
		expect(await getGuildChannelsSyncedAt(db, 'g1')).toBe('2026-09-07T12:00:00Z');
	});

	it('answers null when nothing is stored or the read fails', async () => {
		const db = new FakeDb();
		expect(await getGuildChannelsSyncedAt(db, 'g1')).toBeNull();
		expect(await getGuildChannelsSyncedAt(null, 'g1')).toBeNull();
		db.failNext = true;
		expect(await getGuildChannelsSyncedAt(db, 'g1')).toBeNull();
	});
});
