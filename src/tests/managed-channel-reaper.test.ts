import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({}) as any);

const dbMock = vi.hoisted(() => ({
	listRoomsForReaping: vi.fn(async () => [] as any[]),
	getHumanOccupancy: vi.fn(async () => new Map()),
	markRoomOccupied: vi.fn(async () => {}),
	markRoomEmpty: vi.fn(async () => {}),
	closeManagedChannel: vi.fn(async () => ({ success: true, closed: 1 })),
}));

const restMock = vi.hoisted(() => ({
	deletes: [] as string[],
	failWith: null as any,
}));

vi.mock('../lib/db/managed-channels.js', () => dbMock);
vi.mock('../lib/discord/rest-client.js', () => ({
	createDiscordRestClient: () => ({
		channels: {
			delete: async (channelId: string) => {
				if (restMock.failWith) throw restMock.failWith;
				restMock.deletes.push(channelId);
			},
		},
	}),
}));

const { reapManagedChannels } = await import('../lib/server/managed-channel-reaper.js');

const NOW = new Date('2026-01-01T12:00:00Z');

function voiceRoom(overrides: Record<string, any> = {}) {
	return {
		channel_id: 'c1',
		guild_id: 'g1',
		channel_type: 2,
		status: 'active',
		created_at: '2026-01-01 00:00:00',
		expires_at: null,
		empty_since: null,
		lifetime_mode: 'idle',
		idle_minutes: 15,
		grace_minutes: 5,
		ttl_minutes: 120,
		...overrides,
	};
}

beforeEach(() => {
	for (const fn of Object.values(dbMock)) (fn as any).mockClear();
	dbMock.listRoomsForReaping.mockResolvedValue([]);
	dbMock.getHumanOccupancy.mockResolvedValue(new Map());
	restMock.deletes = [];
	restMock.failWith = null;
});

describe('reapManagedChannels', () => {
	it('does no further work when no rooms are open', async () => {
		const summary = await reapManagedChannels(db, 'token', NOW);

		expect(summary).toMatchObject({ scanned: 0, reaped: 0 });
		expect(dbMock.getHumanOccupancy).not.toHaveBeenCalled();
	});

	it('starts the idle countdown on the first scan that sees a room empty', async () => {
		dbMock.listRoomsForReaping.mockResolvedValue([voiceRoom()]);

		const summary = await reapManagedChannels(db, 'token', NOW);

		expect(dbMock.markRoomEmpty).toHaveBeenCalledWith(db, 'c1');
		expect(summary.reaped).toBe(0);
		expect(restMock.deletes).toEqual([]);
	});

	it('clears the countdown when somebody comes back', async () => {
		dbMock.listRoomsForReaping.mockResolvedValue([
			voiceRoom({ empty_since: '2026-01-01 11:00:00' }),
		]);
		dbMock.getHumanOccupancy.mockResolvedValue(new Map([['c1', 2]]));

		const summary = await reapManagedChannels(db, 'token', NOW);

		expect(dbMock.markRoomOccupied).toHaveBeenCalledWith(db, 'c1');
		expect(summary.reaped).toBe(0);
	});

	it('reaps a room that has been empty past its idle window', async () => {
		dbMock.listRoomsForReaping.mockResolvedValue([
			voiceRoom({ empty_since: '2026-01-01 11:30:00' }),
		]);

		const summary = await reapManagedChannels(db, 'token', NOW);

		expect(restMock.deletes).toEqual(['c1']);
		expect(dbMock.closeManagedChannel).toHaveBeenCalledWith(db, 'c1', 'idle_timeout');
		expect(summary.reaped).toBe(1);
	});

	it('does not count a bot as occupancy', async () => {
		// getHumanOccupancy filters bots in SQL; an empty map is what a room
		// holding only a music bot looks like here.
		dbMock.listRoomsForReaping.mockResolvedValue([
			voiceRoom({ empty_since: '2026-01-01 11:30:00' }),
		]);
		dbMock.getHumanOccupancy.mockResolvedValue(new Map());

		const summary = await reapManagedChannels(db, 'token', NOW);
		expect(summary.reaped).toBe(1);
	});

	it('reaps a fixed room on its deadline even while occupied', async () => {
		dbMock.listRoomsForReaping.mockResolvedValue([
			voiceRoom({ lifetime_mode: 'fixed', expires_at: '2026-01-01 11:00:00' }),
		]);
		dbMock.getHumanOccupancy.mockResolvedValue(new Map([['c1', 4]]));

		const summary = await reapManagedChannels(db, 'token', NOW);

		expect(restMock.deletes).toEqual(['c1']);
		expect(dbMock.closeManagedChannel).toHaveBeenCalledWith(db, 'c1', 'expired');
		expect(summary.reaped).toBe(1);
	});

	it('closes the row when the channel is already gone', async () => {
		dbMock.listRoomsForReaping.mockResolvedValue([
			voiceRoom({ empty_since: '2026-01-01 11:30:00' }),
		]);
		const error: any = new Error('Unknown Channel');
		error.status = 404;
		restMock.failWith = error;

		const summary = await reapManagedChannels(db, 'token', NOW);

		expect(summary.alreadyGone).toBe(1);
		expect(dbMock.closeManagedChannel).toHaveBeenCalledOnce();
	});

	it('leaves the row alone when the delete fails for another reason', async () => {
		dbMock.listRoomsForReaping.mockResolvedValue([
			voiceRoom({ empty_since: '2026-01-01 11:30:00' }),
		]);
		const error: any = new Error('Server error');
		error.status = 500;
		restMock.failWith = error;

		const summary = await reapManagedChannels(db, 'token', NOW);

		expect(summary.failed).toBe(1);
		expect(dbMock.closeManagedChannel).not.toHaveBeenCalled();
	});

	it('respects the grace window for a room nobody has joined yet', async () => {
		dbMock.listRoomsForReaping.mockResolvedValue([
			voiceRoom({
				created_at: '2026-01-01 11:58:00',
				empty_since: '2026-01-01 11:58:00',
			}),
		]);

		const summary = await reapManagedChannels(db, 'token', NOW);
		expect(summary.reaped).toBe(0);
		expect(restMock.deletes).toEqual([]);
	});

	it('only reads occupancy for voice rooms', async () => {
		dbMock.listRoomsForReaping.mockResolvedValue([
			voiceRoom({ channel_id: 'text1', channel_type: 0, lifetime_mode: 'fixed' }),
		]);

		await reapManagedChannels(db, 'token', NOW);
		expect(dbMock.getHumanOccupancy).toHaveBeenCalledWith(db, []);
		expect(dbMock.markRoomEmpty).not.toHaveBeenCalled();
	});
});
