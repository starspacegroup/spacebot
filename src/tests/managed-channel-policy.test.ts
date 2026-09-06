import { describe, expect, it } from 'vitest';
import {
	buildRoomOverwrites,
	canExtend,
	clampUserLimit,
	evaluateRoomExpiry,
	initialExpiresAt,
	memberMayCreate,
	normalizeRoomName,
	OVERWRITE_TYPE_MEMBER,
	OVERWRITE_TYPE_ROLE,
	ownerMayUseVerb,
	parseDbTime,
	permissionNamesToBits,
	sanitizeOwnerPermissions,
	CHANNEL_TYPE_TEXT,
	CHANNEL_TYPE_VOICE,
} from '../lib/discord/managed-channel-policy.js';

const VIEW_CHANNEL = 1n << 10n;
const CONNECT = 1n << 20n;

function preset(overrides: Record<string, any> = {}) {
	return {
		id: 1,
		enabled: true,
		channel_type: CHANNEL_TYPE_VOICE,
		lifetime_mode: 'idle',
		ttl_minutes: 120,
		idle_minutes: 15,
		grace_minutes: 5,
		extend_minutes: 30,
		max_extensions: 2,
		allow_role_ids: [],
		deny_role_ids: [],
		owner_can: ['rename', 'invite', 'delete'],
		owner_allow: ['VIEW_CHANNEL', 'CONNECT'],
		everyone_deny: ['VIEW_CHANNEL', 'CONNECT'],
		...overrides,
	};
}

function room(overrides: Record<string, any> = {}) {
	return {
		status: 'active',
		created_at: '2026-01-01 00:00:00',
		expires_at: null,
		empty_since: null,
		extensions_used: 0,
		...overrides,
	};
}

describe('permissionNamesToBits', () => {
	it('ORs named flags into a bitfield string', () => {
		expect(permissionNamesToBits(['VIEW_CHANNEL', 'CONNECT'])).toBe(
			String(VIEW_CHANNEL | CONNECT)
		);
	});

	it('is case insensitive and ignores unknown names', () => {
		expect(permissionNamesToBits(['view_channel', 'NOT_A_PERMISSION'])).toBe(
			String(VIEW_CHANNEL)
		);
	});

	it("returns '0' for junk input", () => {
		expect(permissionNamesToBits(null)).toBe('0');
		expect(permissionNamesToBits([])).toBe('0');
	});
});

describe('sanitizeOwnerPermissions', () => {
	it('strips permissions that would put the room beyond our control', () => {
		expect(
			sanitizeOwnerPermissions([
				'VIEW_CHANNEL',
				'MANAGE_CHANNELS',
				'ADMINISTRATOR',
				'MANAGE_ROLES',
			])
		).toEqual(['VIEW_CHANNEL']);
	});
});

describe('buildRoomOverwrites', () => {
	const targets = { ownerId: 'owner1', everyoneRoleId: 'guild1', botId: 'bot1' };

	it('denies @everyone, allows the owner, and keeps the bot in', () => {
		const overwrites = buildRoomOverwrites(preset(), targets);

		expect(overwrites).toHaveLength(3);
		expect(overwrites[0]).toMatchObject({
			id: 'guild1',
			type: OVERWRITE_TYPE_ROLE,
			deny: String(VIEW_CHANNEL | CONNECT),
		});
		expect(overwrites[1]).toMatchObject({
			id: 'owner1',
			type: OVERWRITE_TYPE_MEMBER,
			allow: String(VIEW_CHANNEL | CONNECT),
		});
		expect(overwrites[2].id).toBe('bot1');
	});

	it('never grants the owner MANAGE_CHANNELS, however the preset is written', () => {
		const overwrites = buildRoomOverwrites(
			preset({ owner_allow: ['VIEW_CHANNEL', 'MANAGE_CHANNELS'] }),
			targets
		);
		expect(overwrites[1].allow).toBe(String(VIEW_CHANNEL));
	});

	it('skips the @everyone overwrite when nothing is denied', () => {
		const overwrites = buildRoomOverwrites(preset({ everyone_deny: [] }), targets);
		expect(overwrites.map((o) => o.id)).toEqual(['owner1', 'bot1']);
	});
});

describe('memberMayCreate', () => {
	it('allows anyone when no allow list is set', () => {
		expect(memberMayCreate(preset(), ['r1']).allowed).toBe(true);
	});

	it('requires a listed role when an allow list is set', () => {
		const p = preset({ allow_role_ids: ['trusted'] });
		expect(memberMayCreate(p, ['other'])).toEqual({
			allowed: false,
			reason: 'role_not_allowed',
		});
		expect(memberMayCreate(p, ['other', 'trusted']).allowed).toBe(true);
	});

	it('lets a deny role override an allow role', () => {
		const p = preset({ allow_role_ids: ['trusted'], deny_role_ids: ['muted'] });
		expect(memberMayCreate(p, ['trusted', 'muted'])).toEqual({
			allowed: false,
			reason: 'role_denied',
		});
	});

	it('refuses a disabled or missing preset', () => {
		expect(memberMayCreate(preset({ enabled: false }), []).reason).toBe('preset_disabled');
		expect(memberMayCreate(null, []).reason).toBe('preset_missing');
	});
});

describe('ownerMayUseVerb', () => {
	it('only allows delegated verbs', () => {
		expect(ownerMayUseVerb(preset(), 'rename')).toBe(true);
		expect(ownerMayUseVerb(preset(), 'kick')).toBe(false);
		expect(ownerMayUseVerb(null, 'rename')).toBe(false);
	});
});

describe('initialExpiresAt', () => {
	const now = new Date('2026-01-01T00:00:00Z');

	it('gives a fixed room a deadline', () => {
		expect(initialExpiresAt(preset({ lifetime_mode: 'fixed' }), now)).toBe(
			'2026-01-01T02:00:00.000Z'
		);
	});

	it('gives an idle voice room no deadline', () => {
		expect(initialExpiresAt(preset(), now)).toBeNull();
	});

	it('falls back to the TTL for an idle text room, which has no occupancy', () => {
		expect(initialExpiresAt(preset({ channel_type: CHANNEL_TYPE_TEXT }), now)).toBe(
			'2026-01-01T02:00:00.000Z'
		);
	});

	it('gives a manual room no deadline at all', () => {
		expect(initialExpiresAt(preset({ lifetime_mode: 'manual' }), now)).toBeNull();
	});
});

describe('parseDbTime', () => {
	it("reads SQLite's zone-less UTC timestamps as UTC", () => {
		expect(parseDbTime('2026-01-01 12:00:00')?.toISOString()).toBe('2026-01-01T12:00:00.000Z');
	});

	it('passes ISO strings and Dates through', () => {
		expect(parseDbTime('2026-01-01T12:00:00Z')?.toISOString()).toBe('2026-01-01T12:00:00.000Z');
		const d = new Date();
		expect(parseDbTime(d)).toBe(d);
	});

	it('returns null for blanks and junk', () => {
		expect(parseDbTime(null)).toBeNull();
		expect(parseDbTime('')).toBeNull();
		expect(parseDbTime('not a date')).toBeNull();
	});
});

describe('evaluateRoomExpiry', () => {
	const created = '2026-01-01 00:00:00';

	it('never reaps a room inside its grace window', () => {
		const now = new Date('2026-01-01T00:02:00Z');
		const decision = evaluateRoomExpiry(
			room({ created_at: created, empty_since: created }),
			preset(),
			false,
			now
		);
		expect(decision).toEqual({ due: false, reason: 'grace' });
	});

	it('reaps a fixed room once its deadline passes', () => {
		const now = new Date('2026-01-01T03:00:00Z');
		const decision = evaluateRoomExpiry(
			room({ created_at: created, expires_at: '2026-01-01 02:00:00' }),
			preset({ lifetime_mode: 'fixed' }),
			true,
			now
		);
		expect(decision).toEqual({ due: true, reason: 'expired' });
	});

	it('keeps an occupied idle room alive forever', () => {
		const now = new Date('2026-06-01T00:00:00Z');
		expect(evaluateRoomExpiry(room({ created_at: created }), preset(), true, now)).toEqual({
			due: false,
			reason: 'occupied',
		});
	});

	it('only starts counting from the first scan that saw it empty', () => {
		const now = new Date('2026-01-01T06:00:00Z');
		expect(evaluateRoomExpiry(room({ created_at: created }), preset(), false, now)).toEqual({
			due: false,
			reason: 'waiting',
		});
	});

	it('reaps an idle room once the empty window elapses', () => {
		const now = new Date('2026-01-01T01:00:00Z');
		expect(
			evaluateRoomExpiry(
				room({ created_at: created, empty_since: '2026-01-01 00:40:00' }),
				preset(),
				false,
				now
			)
		).toEqual({ due: true, reason: 'idle' });
	});

	it('waits out the rest of a partial empty window', () => {
		const now = new Date('2026-01-01T00:50:00Z');
		expect(
			evaluateRoomExpiry(
				room({ created_at: created, empty_since: '2026-01-01 00:40:00' }),
				preset(),
				false,
				now
			)
		).toEqual({ due: false, reason: 'waiting' });
	});

	it('never reaps a manual room', () => {
		const now = new Date('2027-01-01T00:00:00Z');
		expect(
			evaluateRoomExpiry(
				room({ created_at: created, empty_since: created }),
				preset({ lifetime_mode: 'manual' }),
				false,
				now
			)
		).toEqual({ due: false, reason: 'manual' });
	});

	it('ignores rooms that are already closed', () => {
		expect(evaluateRoomExpiry(room({ status: 'closed' }), preset(), false, new Date())).toEqual(
			{ due: false, reason: 'not_active' }
		);
	});
});

describe('canExtend', () => {
	it('refuses an idle room, which has no deadline to push out', () => {
		expect(canExtend(room(), preset())).toEqual({
			allowed: false,
			reason: 'no_deadline',
		});
	});

	it('allows an extension while the budget lasts', () => {
		const fixed = room({ expires_at: '2026-01-01 02:00:00', extensions_used: 1 });
		expect(canExtend(fixed, preset()).allowed).toBe(true);
	});

	it('refuses once the extension budget is spent', () => {
		const fixed = room({ expires_at: '2026-01-01 02:00:00', extensions_used: 2 });
		expect(canExtend(fixed, preset())).toEqual({
			allowed: false,
			reason: 'max_extensions',
		});
	});
});

describe('clampUserLimit', () => {
	it("clamps to Discord's 0–99 range", () => {
		expect(clampUserLimit(-4)).toBe(0);
		expect(clampUserLimit(500)).toBe(99);
		expect(clampUserLimit('7')).toBe(7);
	});

	it('returns null for non-numbers', () => {
		expect(clampUserLimit('many')).toBeNull();
		expect(clampUserLimit(null)).toBeNull();
	});
});

describe('normalizeRoomName', () => {
	it('falls back when the name is blank', () => {
		expect(normalizeRoomName('   ', 'fallback')).toBe('fallback');
	});

	it("trims to Discord's 100 character channel name limit", () => {
		expect(normalizeRoomName('x'.repeat(200))).toHaveLength(100);
	});
});
