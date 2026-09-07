import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({}) as any);

const dbMock = vi.hoisted(() => ({
	countActiveRoomsForUser: vi.fn(async () => 0),
	countActiveRoomsForGuild: vi.fn(async () => 0),
	recordManagedChannel: vi.fn(async (): Promise<Record<string, any>> => ({
		success: true,
		id: 1,
	})),
	getManagedChannel: vi.fn(async () => null),
	getOwnedManagedChannel: vi.fn(async (..._args: any[]): Promise<any> => null),
	getChannelPreset: vi.fn(async () => null),
	updateManagedChannel: vi.fn(async (..._args: any[]) => ({ success: true })),
	closeManagedChannel: vi.fn(async () => ({ success: true, closed: 1 })),
	appendManagedCategory: vi.fn(async (..._args: any[]) => ({ success: true })),
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

	// Every channel in the fake guild, so category counting has something to
	// count. Tests override it to build a full category.
	const guildChannels: any[] = overrides.guildChannels || [];
	// The overwrites a mute/unmute verb has to preserve.
	const existingOverwrites: any[] = overrides.existingOverwrites || [];

	const discord: any = {
		created,
		permissionCalls,
		edits,
		deletes,
		disconnects,
		guilds: {
			fetch: async () => ({
				channels: {
					fetch: async () => new Map(guildChannels.map((c) => [c.id, c])),
					create: async (payload) => {
						created.push(payload);
						const id = payload.type === 4 ? `cat-${created.length}` : 'new-channel';
						guildChannels.push({ id, name: payload.name, type: payload.type });
						return { id, name: payload.name };
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
			fetch: async (channelId) => ({
				id: channelId,
				permission_overwrites: existingOverwrites,
			}),
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
	delete discord.guildChannels;
	delete discord.existingOverwrites;
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

describe('room mute verbs', () => {
	const SPEAK = 1n << 21n;
	const VIEW = 1n << 10n;
	const CONNECT_BIT = 1n << 20n;

	function mutePreset() {
		return preset({ owner_can: ['mute', 'unmute'] });
	}

	it('mutes somebody without revoking the invite that let them in', async () => {
		dbMock.getOwnedManagedChannel.mockResolvedValue(room());
		dbMock.getChannelPreset.mockResolvedValue(mutePreset());

		const discord = fakeDiscord({
			existingOverwrites: [
				{ id: 'guest1', type: 1, allow: String(VIEW | CONNECT_BIT), deny: '0' },
			],
		});

		const result = await runRoomVerb({
			db,
			discord,
			guildId: 'g1',
			actorId: 'owner1',
			verb: 'mute',
			channelId: 'c1',
			options: { user: 'guest1' },
		});

		expect(result.success).toBe(true);
		const call = discord.permissionCalls.at(-1);
		expect(call.overwriteId).toBe('guest1');
		expect(BigInt(call.perms.deny) & SPEAK).toBe(SPEAK);
		// The invite survives.
		expect(BigInt(call.perms.allow) & VIEW).toBe(VIEW);
		expect(BigInt(call.perms.allow) & CONNECT_BIT).toBe(CONNECT_BIT);
	});

	it('hands the mic back on unmute', async () => {
		dbMock.getOwnedManagedChannel.mockResolvedValue(room());
		dbMock.getChannelPreset.mockResolvedValue(mutePreset());

		const discord = fakeDiscord({
			existingOverwrites: [{ id: 'guest1', type: 1, allow: '0', deny: String(SPEAK) }],
		});

		await runRoomVerb({
			db,
			discord,
			guildId: 'g1',
			actorId: 'owner1',
			verb: 'unmute',
			channelId: 'c1',
			options: { user: 'guest1' },
		});

		const call = discord.permissionCalls.at(-1);
		expect(BigInt(call.perms.allow) & SPEAK).toBe(SPEAK);
		expect(BigInt(call.perms.deny) & SPEAK).toBe(0n);
	});

	it('refuses to mute the room owner', async () => {
		dbMock.getOwnedManagedChannel.mockResolvedValue(room());
		dbMock.getChannelPreset.mockResolvedValue(mutePreset());

		const result = await runRoomVerb({
			db,
			discord: fakeDiscord(),
			guildId: 'g1',
			actorId: 'mod1',
			verb: 'mute',
			channelId: 'c1',
			options: { user: 'owner1' },
			isModerator: true,
		});

		expect(result.success).toBe(false);
		expect(result.error).toMatch(/owner/i);
	});

	it('refuses to mute in a text room', async () => {
		dbMock.getOwnedManagedChannel.mockResolvedValue(room({ channel_type: 0 }));
		dbMock.getChannelPreset.mockResolvedValue(mutePreset());

		const result = await runRoomVerb({
			db,
			discord: fakeDiscord(),
			guildId: 'g1',
			actorId: 'owner1',
			verb: 'mute',
			channelId: 'c1',
			options: { user: 'guest1' },
		});

		expect(result.success).toBe(false);
		expect(result.error).toMatch(/voice rooms/i);
	});

	it('respects a preset that does not delegate muting', async () => {
		dbMock.getOwnedManagedChannel.mockResolvedValue(room());
		dbMock.getChannelPreset.mockResolvedValue(preset({ owner_can: ['rename'] }));

		const result = await runRoomVerb({
			db,
			discord: fakeDiscord(),
			guildId: 'g1',
			actorId: 'owner1',
			verb: 'mute',
			channelId: 'c1',
			options: { user: 'guest1' },
		});

		expect(result.success).toBe(false);
		expect(result.error).toMatch(/doesn't allow/i);
	});
});

describe('createManagedRoom categories', () => {
	const own = (extra: Record<string, any> = {}) =>
		preset({ category_mode: 'own', parent_id: null, name: 'Study Rooms', ...extra });

	it('makes its own category on the first room and remembers it', async () => {
		const discord = fakeDiscord();
		const result = await createManagedRoom({
			db,
			discord,
			guildId: 'g1',
			preset: own(),
			ownerId: 'owner1',
			name: 'Study',
		});

		expect(result.success).toBe(true);
		const category = discord.created.find((c) => c.type === 4);
		expect(category?.name).toBe('Study Rooms');
		expect(dbMock.appendManagedCategory).toHaveBeenCalledWith(db, 'g1', 7, 'cat-1');

		const channel = discord.created.find((c) => c.type !== 4);
		expect(channel.parent).toBe('cat-1');
	});

	it('reuses a category that still has room', async () => {
		const discord = fakeDiscord({
			guildChannels: [
				{ id: 'catA', name: 'Study Rooms', type: 4 },
				{ id: 'r1', type: 2, parent_id: 'catA' },
			],
		});

		await createManagedRoom({
			db,
			discord,
			guildId: 'g1',
			preset: own({ managed_category_ids: ['catA'] }),
			ownerId: 'owner1',
		});

		expect(discord.created.some((c) => c.type === 4)).toBe(false);
		expect(discord.created[0].parent).toBe('catA');
	});

	it('rolls over to a new category once Discord’s 50-child cap is reached', async () => {
		const full = Array.from({ length: 50 }, (_, i) => ({
			id: `r${i}`,
			type: 2,
			parent_id: 'catA',
		}));
		const discord = fakeDiscord({
			guildChannels: [{ id: 'catA', name: 'Study Rooms', type: 4 }, ...full],
		});

		await createManagedRoom({
			db,
			discord,
			guildId: 'g1',
			preset: own({ managed_category_ids: ['catA'] }),
			ownerId: 'owner1',
		});

		const category = discord.created.find((c) => c.type === 4);
		expect(category?.name).toBe('Study Rooms 2');
		expect(discord.created.find((c) => c.type !== 4).parent).toBe('cat-1');
	});

	it('skips a remembered category somebody deleted by hand', async () => {
		const discord = fakeDiscord({ guildChannels: [] });

		await createManagedRoom({
			db,
			discord,
			guildId: 'g1',
			preset: own({ managed_category_ids: ['gone'] }),
			ownerId: 'owner1',
		});

		expect(discord.created.find((c) => c.type === 4)).toBeDefined();
		expect(discord.created.find((c) => c.type !== 4).parent).toBe('cat-1');
	});

	it('still gives the member a room when the category cannot be made', async () => {
		const discord = fakeDiscord();
		discord.guilds.fetch = async () => {
			throw new Error('Missing Permissions');
		};
		// The room create itself goes through the same guild handle, so give it
		// one that only fails while resolving the category.
		let calls = 0;
		discord.guilds.fetch = async () => {
			calls += 1;
			if (calls === 1) throw new Error('Missing Permissions');
			return {
				channels: {
					fetch: async () => new Map(),
					create: async (payload) => {
						discord.created.push(payload);
						return { id: 'new-channel', name: payload.name };
					},
				},
			};
		};

		const result = await createManagedRoom({
			db,
			discord,
			guildId: 'g1',
			preset: own(),
			ownerId: 'owner1',
		});

		expect(result.success).toBe(true);
		expect(discord.created[0].parent).toBeUndefined();
	});

	it('leaves an "existing" preset pointing at the category the admin picked', async () => {
		const discord = fakeDiscord();
		await createManagedRoom({
			db,
			discord,
			guildId: 'g1',
			preset: preset(),
			ownerId: 'owner1',
		});

		expect(discord.created).toHaveLength(1);
		expect(discord.created[0].parent).toBe('cat1');
	});
});

describe('createManagedRoom shape', () => {
	it('records what the room was actually created as', async () => {
		const discord = fakeDiscord();
		const result = await createManagedRoom({
			db,
			discord,
			guildId: 'g1',
			preset: preset(),
			ownerId: 'owner1',
			visibility: 'public',
			voiceMode: 'listen',
		});

		expect(result.visibility).toBe('public');
		expect(result.voiceMode).toBe('listen');
		expect(dbMock.recordManagedChannel).toHaveBeenCalledWith(
			db,
			expect.objectContaining({ visibility: 'public', voice_mode: 'listen' })
		);
	});

	it('ignores the member choice when the preset refuses it', async () => {
		const discord = fakeDiscord();
		const result = await createManagedRoom({
			db,
			discord,
			guildId: 'g1',
			preset: preset({ allow_visibility_choice: false, default_visibility: 'private' }),
			ownerId: 'owner1',
			visibility: 'public',
		});

		expect(result.visibility).toBe('private');
	});
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
		// Locking *is* going private, so the room's stored shape moves with it.
		expect(dbMock.updateManagedChannel).toHaveBeenCalledWith(db, 'c1', {
			locked: 1,
			visibility: 'private',
		});
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
		const update: any = (dbMock.updateManagedChannel.mock.calls.at(-1) as any[])?.[2];
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

describe('resolving which room a verb acts on', () => {
	it("falls back to the caller's own room when they run a verb elsewhere", async () => {
		// `/room lock` typed in #general: no room of theirs at that channel…
		dbMock.getOwnedManagedChannel.mockImplementation(async (..._args: any[]) =>
			_args[3] ? null : room()
		);
		const discord = fakeDiscord();

		const result = await runRoomVerb({
			db,
			discord,
			guildId: 'g1',
			actorId: 'owner1',
			verb: 'lock',
			channelId: 'general',
		});

		// …so it acts on the room they actually own.
		expect(result.success).toBe(true);
		expect(discord.permissionCalls[0].channelId).toBe('c1');
	});

	it('prefers the room the caller is standing in', async () => {
		dbMock.getOwnedManagedChannel.mockImplementation(async (..._args: any[]) =>
			_args[3] === 'c2' ? room({ channel_id: 'c2' }) : room()
		);
		const discord = fakeDiscord();

		await runRoomVerb({
			db,
			discord,
			guildId: 'g1',
			actorId: 'owner1',
			verb: 'lock',
			channelId: 'c2',
		});

		expect(discord.permissionCalls[0].channelId).toBe('c2');
	});

	it("does not hand a moderator someone else's room when they own one themselves", async () => {
		dbMock.getOwnedManagedChannel.mockImplementation(async () => room({ channel_id: 'mine' }));
		dbMock.getManagedChannel.mockResolvedValue(room({ owner_user_id: 'someone-else' }));
		const discord = fakeDiscord();

		await runRoomVerb({
			db,
			discord,
			guildId: 'g1',
			actorId: 'mod',
			verb: 'lock',
			channelId: 'mine',
			isModerator: true,
		});

		expect(discord.permissionCalls[0].channelId).toBe('mine');
	});
});
