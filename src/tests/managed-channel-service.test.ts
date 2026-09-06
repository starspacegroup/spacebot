import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({}) as any);

const dbMock = vi.hoisted(() => ({
	countActiveRoomsForUser: vi.fn(async () => 0),
	countActiveRoomsForGuild: vi.fn(async () => 0),
	recordManagedChannel: vi.fn(async () => ({ success: true, id: 1 })),
	getManagedChannel: vi.fn(async () => null),
	getOwnedManagedChannel: vi.fn(async () => null),
	getChannelPreset: vi.fn(async () => null),
	updateManagedChannel: vi.fn(async () => ({ success: true })),
	closeManagedChannel: vi.fn(async () => ({ success: true, closed: 1 })),
}));

vi.mock('../lib/db/managed-channels.js', () => dbMock);

const { createManagedRoom, runRoomVerb } = await import('../lib/automation/managed-channels.js');

const VIEW_CHANNEL = 1n << 10n;
const CONNECT = 1n << 20n;

function preset(overrides: Record<string, any> = {}) {
	return {
		id: 7,
		enabled: true,
		channel_type: 2,
		parent_id: 'cat1',
		lifetime_mode: 'idle',
		ttl_minutes: 120,
		idle_minutes: 15,
		grace_minutes: 5,
		extend_minutes: 30,
		max_extensions: 2,
		max_per_user: 1,
		max_per_guild: 25,
		max_renames: 2,
		default_user_limit: null,
		allow_role_ids: [],
		deny_role_ids: [],
		owner_can: ['rename', 'invite', 'kick', 'lock', 'limit', 'transfer', 'extend', 'delete'],
		owner_allow: ['VIEW_CHANNEL', 'CONNECT'],
		everyone_deny: ['VIEW_CHANNEL', 'CONNECT'],
		...overrides,
	};
}

function room(overrides: Record<string, any> = {}) {
	return {
		guild_id: 'g1',
		channel_id: 'c1',
		preset_id: 7,
		owner_user_id: 'owner1',
		channel_type: 2,
		status: 'active',
		renames_used: 0,
		extensions_used: 0,
		expires_at: null,
		created_at: '2026-01-01 00:00:00',
		...overrides,
	};
}

/** Minimal stand-in for the REST client surface these operations touch. */
function fakeDiscord(overrides: Record<string, any> = {}) {
	const created: any[] = [];
	const permissionCalls: any[] = [];
	const edits: any[] = [];
	const deletes: string[] = [];
	const disconnects: string[] = [];

	const discord: any = {
		created,
		permissionCalls,
		edits,
		deletes,
		disconnects,
		guilds: {
			fetch: async () => ({
				channels: {
					create: async (payload) => {
						created.push(payload);
						return { id: 'new-channel', name: payload.name };
					},
				},
				members: {
					fetch: async (userId) => ({
						voice: {
							channelId: 'c1',
							disconnect: async () => {
								disconnects.push(userId);
							},
						},
					}),
				},
			}),
		},
		channels: {
			edit: async (channelId, patch) => {
				edits.push({ channelId, patch });
			},
			delete: async (channelId) => {
				deletes.push(channelId);
			},
			permissions: (channelId) => ({
				set: async (overwriteId, perms) => {
					permissionCalls.push({ channelId, overwriteId, perms });
				},
				delete: async () => {},
			}),
		},
		...overrides,
	};
	return discord;
}

beforeEach(() => {
	for (const fn of Object.values(dbMock)) (fn as any).mockClear();
	dbMock.countActiveRoomsForUser.mockResolvedValue(0);
	dbMock.countActiveRoomsForGuild.mockResolvedValue(0);
	dbMock.recordManagedChannel.mockResolvedValue({ success: true, id: 1 });
	dbMock.getManagedChannel.mockResolvedValue(null);
	dbMock.getOwnedManagedChannel.mockResolvedValue(null);
	dbMock.getChannelPreset.mockResolvedValue(preset());
});

describe('createManagedRoom', () => {
	it("creates the channel with the preset's overwrites and records ownership", async () => {
		const discord = fakeDiscord();
		const result = await createManagedRoom({
			db,
			discord,
			guildId: 'g1',
			preset: preset(),
			ownerId: 'owner1',
			ownerName: 'Ada',
			name: 'Study',
			botId: 'bot1',
		});

		expect(result.success).toBe(true);
		expect(result.channelId).toBe('new-channel');

		const payload = discord.created[0];
		expect(payload.name).toBe('Study');
		expect(payload.parent).toBe('cat1');
		expect(payload.permissionOverwrites).toHaveLength(3);
		expect(payload.permissionOverwrites[0]).toMatchObject({
			id: 'g1',
			deny: String(VIEW_CHANNEL | CONNECT),
		});
		expect(dbMock.recordManagedChannel).toHaveBeenCalledOnce();
	});

	it('leaves user_limit unset when the preset has no default', async () => {
		const discord = fakeDiscord();
		await createManagedRoom({
			db,
			discord,
			guildId: 'g1',
			preset: preset(),
			ownerId: 'owner1',
			name: 'Study',
		});
		expect(discord.created[0].userLimit).toBeUndefined();
	});

	it('refuses a member without an allowed role', async () => {
		const result = await createManagedRoom({
			db,
			discord: fakeDiscord(),
			guildId: 'g1',
			preset: preset({ allow_role_ids: ['trusted'] }),
			ownerId: 'owner1',
			ownerRoleIds: ['other'],
		});
		expect(result.success).toBe(false);
		expect(result.error).toMatch(/role/i);
	});

	it('enforces the per-user cap', async () => {
		dbMock.countActiveRoomsForUser.mockResolvedValue(1);
		const result = await createManagedRoom({
			db,
			discord: fakeDiscord(),
			guildId: 'g1',
			preset: preset(),
			ownerId: 'owner1',
		});
		expect(result.success).toBe(false);
		expect(result.error).toMatch(/already have a room/i);
	});

	it('enforces the per-guild cap', async () => {
		dbMock.countActiveRoomsForGuild.mockResolvedValue(25);
		const result = await createManagedRoom({
			db,
			discord: fakeDiscord(),
			guildId: 'g1',
			preset: preset(),
			ownerId: 'owner1',
		});
		expect(result.success).toBe(false);
		expect(result.error).toMatch(/as many rooms/i);
	});

	it('deletes the channel again if ownership could not be recorded', async () => {
		dbMock.recordManagedChannel.mockResolvedValue({ success: false, error: 'boom' });
		const discord = fakeDiscord();

		const result = await createManagedRoom({
			db,
			discord,
			guildId: 'g1',
			preset: preset(),
			ownerId: 'owner1',
		});

		expect(result.success).toBe(false);
		expect(discord.deletes).toEqual(['new-channel']);
	});

	it('explains a permission failure instead of leaking the API error', async () => {
		const discord = fakeDiscord({
			guilds: {
				fetch: async () => ({
					channels: {
						create: async () => {
							const error: any = new Error('Missing Permissions');
							error.status = 403;
							throw error;
						},
					},
				}),
			},
		});

		const result = await createManagedRoom({
			db,
			discord,
			guildId: 'g1',
			preset: preset(),
			ownerId: 'owner1',
		});

		expect(result.success).toBe(false);
		expect(result.error).toMatch(/permission/i);
	});
});

describe('runRoomVerb authorization', () => {
	it('refuses when the caller owns no room', async () => {
		const result = await runRoomVerb({
			db,
			discord: fakeDiscord(),
			guildId: 'g1',
			actorId: 'someone',
			verb: 'delete',
		});
		expect(result.success).toBe(false);
		expect(result.error).toMatch(/don't have a room/i);
	});

	it('refuses a verb the preset does not delegate', async () => {
		dbMock.getOwnedManagedChannel.mockResolvedValue(room());
		dbMock.getChannelPreset.mockResolvedValue(preset({ owner_can: ['delete'] }));

		const result = await runRoomVerb({
			db,
			discord: fakeDiscord(),
			guildId: 'g1',
			actorId: 'owner1',
			verb: 'kick',
			options: { user: 'victim' },
		});

		expect(result.success).toBe(false);
		expect(result.error).toMatch(/doesn't allow/i);
	});

	it('never reaches a room the caller does not own', async () => {
		// Someone else's room exists at this channel, but the caller owns nothing.
		dbMock.getManagedChannel.mockResolvedValue(room({ owner_user_id: 'someone-else' }));
		dbMock.getOwnedManagedChannel.mockResolvedValue(null);

		const result = await runRoomVerb({
			db,
			discord: fakeDiscord(),
			guildId: 'g1',
			actorId: 'intruder',
			verb: 'delete',
			channelId: 'c1',
			isModerator: false,
		});

		expect(result.success).toBe(false);
		expect(dbMock.closeManagedChannel).not.toHaveBeenCalled();
	});

	it('lets a channel moderator act on a room they do not own, past owner_can', async () => {
		dbMock.getManagedChannel.mockResolvedValue(room({ owner_user_id: 'someone-else' }));
		dbMock.getChannelPreset.mockResolvedValue(preset({ owner_can: [] }));
		const discord = fakeDiscord();

		const result = await runRoomVerb({
			db,
			discord,
			guildId: 'g1',
			actorId: 'mod',
			verb: 'delete',
			channelId: 'c1',
			isModerator: true,
		});

		expect(result.success).toBe(true);
		expect(discord.deletes).toEqual(['c1']);
	});
});

describe('room verbs', () => {
	beforeEach(() => {
		dbMock.getOwnedManagedChannel.mockResolvedValue(room());
		dbMock.getChannelPreset.mockResolvedValue(preset());
	});

	it("renames, and counts the rename against Discord's throttle budget", async () => {
		const discord = fakeDiscord();
		const result = await runRoomVerb({
			db,
			discord,
			guildId: 'g1',
			actorId: 'owner1',
			verb: 'rename',
			options: { name: 'New name' },
		});

		expect(result.success).toBe(true);
		expect(discord.edits[0]).toMatchObject({ channelId: 'c1', patch: { name: 'New name' } });
		expect(dbMock.updateManagedChannel).toHaveBeenCalledWith(db, 'c1', {
			channel_name: 'New name',
			renames_used: 1,
		});
	});

	it('refuses a rename past the budget rather than stalling on a 429', async () => {
		dbMock.getOwnedManagedChannel.mockResolvedValue(room({ renames_used: 2 }));
		const discord = fakeDiscord();

		const result = await runRoomVerb({
			db,
			discord,
			guildId: 'g1',
			actorId: 'owner1',
			verb: 'rename',
			options: { name: 'Again' },
		});

		expect(result.success).toBe(false);
		expect(discord.edits).toHaveLength(0);
	});

	it('invites by granting access to that member only', async () => {
		const discord = fakeDiscord();
		await runRoomVerb({
			db,
			discord,
			guildId: 'g1',
			actorId: 'owner1',
			verb: 'invite',
			options: { user: 'guest' },
		});

		expect(discord.permissionCalls[0]).toMatchObject({
			overwriteId: 'guest',
			perms: { allow: String(VIEW_CHANNEL | CONNECT), deny: '0' },
		});
	});

	it('kicks by denying access and disconnecting them', async () => {
		const discord = fakeDiscord();
		const result = await runRoomVerb({
			db,
			discord,
			guildId: 'g1',
			actorId: 'owner1',
			verb: 'kick',
			options: { user: 'pest' },
		});

		expect(result.success).toBe(true);
		expect(discord.permissionCalls[0].perms.deny).toBe(String(VIEW_CHANNEL | CONNECT));
		expect(discord.disconnects).toEqual(['pest']);
	});

	it('refuses to kick yourself or the room owner', async () => {
		const discord = fakeDiscord();
		const self = await runRoomVerb({
			db,
			discord,
			guildId: 'g1',
			actorId: 'owner1',
			verb: 'kick',
			options: { user: 'owner1' },
		});
		expect(self.success).toBe(false);
		expect(discord.permissionCalls).toHaveLength(0);
	});

	it('locks by adding to the @everyone deny, not replacing it', async () => {
		const discord = fakeDiscord();
		await runRoomVerb({
			db,
			discord,
			guildId: 'g1',
			actorId: 'owner1',
			verb: 'lock',
		});

		expect(discord.permissionCalls[0]).toMatchObject({
			overwriteId: 'g1',
			perms: { deny: String(VIEW_CHANNEL | CONNECT), type: 0 },
		});
		expect(dbMock.updateManagedChannel).toHaveBeenCalledWith(db, 'c1', { locked: 1 });
	});

	it("clamps a user limit into Discord's range", async () => {
		const discord = fakeDiscord();
		await runRoomVerb({
			db,
			discord,
			guildId: 'g1',
			actorId: 'owner1',
			verb: 'limit',
			options: { limit: 300 },
		});
		expect(discord.edits[0].patch).toEqual({ user_limit: 99 });
	});

	it('refuses to extend an idle room, which has no deadline', async () => {
		const result = await runRoomVerb({
			db,
			discord: fakeDiscord(),
			guildId: 'g1',
			actorId: 'owner1',
			verb: 'extend',
		});
		expect(result.success).toBe(false);
		expect(result.error).toMatch(/as long as someone is in it/i);
	});

	it('extends a fixed room and spends one extension', async () => {
		const future = new Date(Date.now() + 3_600_000).toISOString();
		dbMock.getOwnedManagedChannel.mockResolvedValue(room({ expires_at: future }));

		const result = await runRoomVerb({
			db,
			discord: fakeDiscord(),
			guildId: 'g1',
			actorId: 'owner1',
			verb: 'extend',
		});

		expect(result.success).toBe(true);
		const update = dbMock.updateManagedChannel.mock.calls.at(-1)?.[2];
		expect(update.extensions_used).toBe(1);
		expect(new Date(update.expires_at).getTime()).toBeGreaterThan(new Date(future).getTime());
	});

	it('transfers ownership to the new owner', async () => {
		const discord = fakeDiscord();
		await runRoomVerb({
			db,
			discord,
			guildId: 'g1',
			actorId: 'owner1',
			verb: 'transfer',
			options: { user: 'heir' },
		});

		expect(discord.permissionCalls[0].overwriteId).toBe('heir');
		expect(dbMock.updateManagedChannel).toHaveBeenCalledWith(db, 'c1', {
			owner_user_id: 'heir',
			owner_user_name: null,
		});
	});

	it('closes the row even when the channel is already gone in Discord', async () => {
		const discord = fakeDiscord({
			channels: {
				delete: async () => {
					const error: any = new Error('Unknown Channel');
					error.status = 404;
					throw error;
				},
				edit: async () => {},
				permissions: () => ({ set: async () => {}, delete: async () => {} }),
			},
		});

		const result = await runRoomVerb({
			db,
			discord,
			guildId: 'g1',
			actorId: 'owner1',
			verb: 'delete',
		});

		expect(result.success).toBe(true);
		expect(dbMock.closeManagedChannel).toHaveBeenCalledWith(db, 'c1', 'owner_deleted');
	});

	it('rejects an unknown verb', async () => {
		const result = await runRoomVerb({
			db,
			discord: fakeDiscord(),
			guildId: 'g1',
			actorId: 'owner1',
			verb: 'explode',
		});
		expect(result.success).toBe(false);
	});
});
