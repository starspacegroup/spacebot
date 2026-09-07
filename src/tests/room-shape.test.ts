import { describe, expect, it } from 'vitest';
import { PermissionFlagsBits } from 'discord-api-types/v10';
import {
	buildRoomOverwrites,
	everyoneDenyFor,
	ownerAllowFor,
	resolveVisibility,
	resolveVoiceMode,
	withPermissionFlag,
} from '../lib/discord/managed-channel-policy.js';

function preset(overrides: Record<string, any> = {}) {
	return {
		id: 1,
		channel_type: 2,
		owner_allow: ['VIEW_CHANNEL', 'CONNECT'],
		everyone_deny: ['VIEW_CHANNEL', 'CONNECT'],
		default_visibility: 'private',
		allow_visibility_choice: true,
		default_voice_mode: 'open',
		allow_voice_mode_choice: true,
		...overrides,
	};
}

/** Whether a bitfield string carries one named permission. */
function has(bits: string, flag: bigint) {
	return (BigInt(bits) & flag) === flag;
}

describe('resolveVisibility / resolveVoiceMode', () => {
	it('takes the preset default when the member asks for nothing', () => {
		expect(resolveVisibility(preset({ default_visibility: 'public' }))).toBe('public');
		expect(resolveVoiceMode(preset({ default_voice_mode: 'ptt' }))).toBe('ptt');
	});

	it('takes the member choice when the preset allows one', () => {
		expect(resolveVisibility(preset(), 'public')).toBe('public');
		expect(resolveVoiceMode(preset(), 'listen')).toBe('listen');
	});

	it('ignores the member choice when the preset refuses it', () => {
		const locked = preset({ allow_visibility_choice: false, allow_voice_mode_choice: false });
		expect(resolveVisibility(locked, 'public')).toBe('private');
		expect(resolveVoiceMode(locked, 'listen')).toBe('open');
	});

	it('falls back rather than failing on a value it does not know', () => {
		// An unexpanded template ("{option.visibility}") reaches here when the
		// command was invoked with no options at all. Losing the room to that
		// would be a worse answer than the default.
		expect(resolveVisibility(preset(), '{option.visibility}')).toBe('private');
		expect(resolveVoiceMode(preset(), 'shout')).toBe('open');
	});

	it('treats an empty option as no opinion', () => {
		expect(resolveVisibility(preset({ default_visibility: 'public' }), '')).toBe('public');
		expect(resolveVoiceMode(preset({ default_voice_mode: 'ptt' }), '')).toBe('ptt');
	});
});

describe('everyoneDenyFor', () => {
	it('hides a private room and exposes a public one', () => {
		expect(everyoneDenyFor(preset(), 'private', 'open')).toEqual(
			expect.arrayContaining(['VIEW_CHANNEL', 'CONNECT'])
		);
		// Public has to *undo* the preset's inherited deny, not merely skip it.
		expect(everyoneDenyFor(preset(), 'public', 'open')).toEqual([]);
	});

	it('keeps the admin baseline denies a public room does not own', () => {
		const withExtra = preset({ everyone_deny: ['VIEW_CHANNEL', 'CONNECT', 'STREAM'] });
		expect(everyoneDenyFor(withExtra, 'public', 'open')).toEqual(['STREAM']);
	});

	it('denies USE_VAD for push-to-talk and SPEAK for listen-only', () => {
		expect(everyoneDenyFor(preset(), 'public', 'ptt')).toContain('USE_VAD');
		expect(everyoneDenyFor(preset(), 'public', 'listen')).toContain('SPEAK');
		expect(everyoneDenyFor(preset(), 'public', 'listen')).not.toContain('USE_VAD');
	});

	it('ignores voice modes on a text room', () => {
		const text = preset({ channel_type: 0 });
		expect(everyoneDenyFor(text, 'public', 'listen')).toEqual([]);
	});
});

describe('ownerAllowFor', () => {
	it('exempts the owner from listen-only', () => {
		expect(ownerAllowFor(preset(), 'private', 'listen')).toContain('SPEAK');
	});

	it('does not exempt the owner from push-to-talk', () => {
		// PTT is a property of the room, not a privilege — an owner on open mic
		// in a PTT room is exactly the noise the mode exists to stop.
		expect(ownerAllowFor(preset(), 'private', 'ptt')).not.toContain('USE_VAD');
	});

	it('still lets the owner into their own hidden room', () => {
		const bare = preset({ owner_allow: [] });
		expect(ownerAllowFor(bare, 'private', 'open')).toEqual(
			expect.arrayContaining(['VIEW_CHANNEL', 'CONNECT'])
		);
	});
});

describe('buildRoomOverwrites', () => {
	const targets = { ownerId: 'owner1', everyoneRoleId: 'g1', botId: 'bot1' };

	it('writes no @everyone overwrite for a fully public open room', () => {
		const overwrites = buildRoomOverwrites(preset(), targets, {
			visibility: 'public',
			voiceMode: 'open',
		});
		expect(overwrites.find((o) => o.id === 'g1')).toBeUndefined();
	});

	it('silences @everyone but not the owner in a listen-only room', () => {
		const overwrites = buildRoomOverwrites(preset(), targets, {
			visibility: 'public',
			voiceMode: 'listen',
		});

		const everyone = overwrites.find((o) => o.id === 'g1');
		const owner = overwrites.find((o) => o.id === 'owner1');

		expect(has(String(everyone?.deny), PermissionFlagsBits.Speak)).toBe(true);
		expect(has(String(owner?.allow), PermissionFlagsBits.Speak)).toBe(true);
	});

	it('falls back to the preset when no shape is passed', () => {
		// The join-to-create lobby path passes nothing at all.
		const overwrites = buildRoomOverwrites(
			preset({ default_visibility: 'public', default_voice_mode: 'ptt' }),
			targets
		);
		const everyone = overwrites.find((o) => o.id === 'g1');
		expect(has(String(everyone?.deny), PermissionFlagsBits.UseVAD)).toBe(true);
		expect(has(String(everyone?.deny), PermissionFlagsBits.ViewChannel)).toBe(false);
	});

	it('keeps the bot able to manage a hidden room', () => {
		const overwrites = buildRoomOverwrites(preset(), targets, {
			visibility: 'private',
			voiceMode: 'open',
		});
		const bot = overwrites.find((o) => o.id === 'bot1');
		expect(has(String(bot?.allow), PermissionFlagsBits.ViewChannel)).toBe(true);
		expect(has(String(bot?.allow), PermissionFlagsBits.MoveMembers)).toBe(true);
	});
});

describe('withPermissionFlag', () => {
	const invited = {
		allow: String(PermissionFlagsBits.ViewChannel | PermissionFlagsBits.Connect),
		deny: '0',
	};

	it('mutes without revoking the invite that let them in', () => {
		const muted = withPermissionFlag(invited, 'SPEAK', false);
		expect(has(muted.allow, PermissionFlagsBits.ViewChannel)).toBe(true);
		expect(has(muted.allow, PermissionFlagsBits.Connect)).toBe(true);
		expect(has(muted.deny, PermissionFlagsBits.Speak)).toBe(true);
	});

	it('moves the flag across rather than setting it on both sides', () => {
		const muted = withPermissionFlag(invited, 'SPEAK', false);
		const unmuted = withPermissionFlag(muted, 'SPEAK', true);
		expect(has(unmuted.allow, PermissionFlagsBits.Speak)).toBe(true);
		expect(has(unmuted.deny, PermissionFlagsBits.Speak)).toBe(false);
	});

	it('clears the flag entirely on null', () => {
		const muted = withPermissionFlag(invited, 'SPEAK', false);
		const cleared = withPermissionFlag(muted, 'SPEAK', null);
		expect(has(cleared.deny, PermissionFlagsBits.Speak)).toBe(false);
		expect(has(cleared.allow, PermissionFlagsBits.Speak)).toBe(false);
	});

	it('leaves the pair alone for a name it does not know', () => {
		expect(withPermissionFlag(invited, 'NOT_A_PERMISSION', false)).toEqual({
			allow: invited.allow,
			deny: '0',
		});
	});
});
