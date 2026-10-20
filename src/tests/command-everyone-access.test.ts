import { describe, expect, it } from 'vitest';
import {
	allChannelsId,
	resolveCommandEveryoneAccess,
	PERMISSION_TYPE,
} from '../lib/discord/command-everyone-access.js';

const GUILD = '1009583217948491928';
const APP = '900000000000000001';
const PING_ID = '900000000000000100';
const MANAGE_GUILD = String(1n << 5n);
const HELPER = '111111111111111111';

const ping = {
	name: 'ping',
	description: 'Pong',
	enabled: true,
	default_member_permissions: null,
	access_rules: null,
};
const registeredPing = { id: PING_ID, name: 'ping', type: 1, default_member_permissions: null };
const everyone = (permission: boolean) => ({ id: GUILD, type: PERMISSION_TYPE.ROLE, permission });

function resolve(overrides: Partial<Parameters<typeof resolveCommandEveryoneAccess>[0]> = {}) {
	return resolveCommandEveryoneAccess({
		guildId: GUILD,
		applicationId: APP,
		commands: [ping],
		registered: [registeredPing],
		permissions: [],
		...overrides,
	})[0];
}

describe('resolveCommandEveryoneAccess', () => {
	it('lets everyone use an enabled, registered, unrestricted command', () => {
		const result = resolve();
		expect(result.everyone_can_use).toBe(true);
		expect(result.discord_command_id).toBe(PING_ID);
		expect(result.discord_overrides).toEqual({ source: 'none', permissions: [] });
	});

	it('denies when the app-level entry denies @everyone', () => {
		const result = resolve({ permissions: [{ id: APP, permissions: [everyone(false)] }] });
		expect(result.everyone_can_use).toBe(false);
		expect(result.discord_overrides?.source).toBe('application');
	});

	it('a command-level allow replaces an app-level deny', () => {
		const result = resolve({
			permissions: [
				{ id: APP, permissions: [everyone(false)] },
				{ id: PING_ID, permissions: [everyone(true)] },
			],
		});
		expect(result.everyone_can_use).toBe(true);
		expect(result.discord_overrides?.source).toBe('command');
	});

	it('a command-level entry without @everyone still drops the app-level deny', () => {
		const result = resolve({
			permissions: [
				{ id: APP, permissions: [everyone(false)] },
				{
					id: PING_ID,
					permissions: [{ id: HELPER, type: PERMISSION_TYPE.ROLE, permission: true }],
				},
			],
		});
		expect(result.everyone_can_use).toBe(true);
	});

	it('default_member_permissions restricts, including "0"', () => {
		expect(
			resolve({
				registered: [{ ...registeredPing, default_member_permissions: MANAGE_GUILD }],
			}).everyone_can_use
		).toBe(false);
		expect(
			resolve({ registered: [{ ...registeredPing, default_member_permissions: '0' }] })
				.everyone_can_use
		).toBe(false);
	});

	it('an explicit @everyone allow overrides default_member_permissions', () => {
		const result = resolve({
			registered: [{ ...registeredPing, default_member_permissions: MANAGE_GUILD }],
			permissions: [{ id: PING_ID, permissions: [everyone(true)] }],
		});
		expect(result.everyone_can_use).toBe(true);
	});

	it('denying all channels denies everyone', () => {
		const result = resolve({
			permissions: [
				{
					id: APP,
					permissions: [
						{
							id: allChannelsId(GUILD),
							type: PERMISSION_TYPE.CHANNEL,
							permission: false,
						},
					],
				},
			],
		});
		expect(allChannelsId(GUILD)).toBe('1009583217948491927');
		expect(result.everyone_can_use).toBe(false);
	});

	it('is false when disabled in SpaceBot', () => {
		const result = resolve({ commands: [{ ...ping, enabled: false }] });
		expect(result.enabled).toBe(false);
		expect(result.everyone_can_use).toBe(false);
	});

	it('is false when not registered with Discord', () => {
		const result = resolve({ registered: [] });
		expect(result.registered).toBe(false);
		expect(result.discord_command_id).toBeNull();
		expect(result.everyone_can_use).toBe(false);
	});

	it('is false when SpaceBot access rules let only a role in', () => {
		const result = resolve({
			commands: [
				{
					...ping,
					default_member_permissions: MANAGE_GUILD,
					access_rules: { allow_roles: [HELPER], deny_roles: [] },
				},
			],
		});
		expect(result.spacebot_allows_everyone).toBe(false);
		expect(result.everyone_can_use).toBe(false);
	});

	it('prefers a guild registration over a global one with the same name', () => {
		const result = resolve({
			registered: [
				{ id: '1', name: 'ping', type: 1 },
				{ id: '2', name: 'ping', type: 1, guild_id: GUILD },
			],
		});
		expect(result.discord_command_id).toBe('2');
	});

	it('reports no Discord data when Discord was unreachable', () => {
		const result = resolve({ registered: null, permissions: null });
		expect(result.registered).toBe(false);
		expect(result.discord_overrides).toBeNull();
		expect(result.everyone_can_use).toBe(false);
	});
});
