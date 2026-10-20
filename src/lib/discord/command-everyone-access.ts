/**
 * Whether a regular member (only @everyone, no special permissions) can run a
 * SpaceBot command in a guild, combining SpaceBot's own config with what
 * Discord actually has: the registered command and the per-guild permission
 * overrides set under Server Settings > Integrations.
 *
 * Discord semantics applied here:
 * - The application-level entry (id == application_id) applies to every
 *   command that has no command-level entry of its own. A command-level entry
 *   replaces the application-level one wholesale.
 * - Role permission id == guild_id is @everyone; channel id == guild_id - 1 is
 *   "all channels".
 * - An explicit @everyone override beats default_member_permissions; without
 *   one, a non-null default_member_permissions (including "0") hides the
 *   command from a member with no permissions.
 * @see https://discord.com/developers/docs/interactions/application-commands#permissions
 */

import { memberMayUseCommand } from './command-access.js';

export const PERMISSION_TYPE = { ROLE: 1, USER: 2, CHANNEL: 3 } as const;

export interface DiscordPermission {
	id: string;
	type: number;
	permission: boolean;
}

export interface DiscordCommandPermissions {
	id: string;
	application_id?: string;
	guild_id?: string;
	permissions: DiscordPermission[];
}

export interface RegisteredCommand {
	id: string;
	name: string;
	type?: number;
	default_member_permissions?: string | null;
	guild_id?: string;
}

export interface SpaceBotCommand {
	name: string;
	description?: string | null;
	enabled?: boolean | number | null;
	default_member_permissions?: string | null;
	access_rules?: unknown;
	is_built_in?: boolean;
}

export interface CommandEveryoneAccess {
	name: string;
	description: string | null;
	is_built_in: boolean;
	enabled: boolean;
	registered: boolean;
	discord_command_id: string | null;
	default_member_permissions: string | null;
	discord_overrides: {
		source: 'command' | 'application' | 'none';
		permissions: DiscordPermission[];
	} | null;
	spacebot_allows_everyone: boolean;
	everyone_can_use: boolean;
}

export function allChannelsId(guildId: string): string {
	return (BigInt(guildId) - 1n).toString();
}

function everyoneOverride(permissions: DiscordPermission[], guildId: string): boolean | null {
	const entry = permissions.find((p) => p.type === PERMISSION_TYPE.ROLE && p.id === guildId);
	return entry ? entry.permission : null;
}

function allChannelsDenied(permissions: DiscordPermission[], guildId: string): boolean {
	const all = allChannelsId(guildId);
	return permissions.some(
		(p) => p.type === PERMISSION_TYPE.CHANNEL && p.id === all && p.permission === false
	);
}

function restrictsEveryone(defaultMemberPermissions: string | null | undefined): boolean {
	return (
		defaultMemberPermissions !== null &&
		defaultMemberPermissions !== undefined &&
		String(defaultMemberPermissions).trim() !== ''
	);
}

export function resolveCommandEveryoneAccess(input: {
	guildId: string;
	applicationId: string;
	commands: SpaceBotCommand[];
	registered: RegisteredCommand[] | null;
	permissions: DiscordCommandPermissions[] | null;
}): CommandEveryoneAccess[] {
	const { guildId, applicationId, commands } = input;
	const discordKnown = input.registered !== null;
	const registeredByName = new Map<string, RegisteredCommand>();
	for (const command of input.registered ?? []) {
		if ((command.type ?? 1) !== 1) continue;
		const existing = registeredByName.get(command.name);
		if (!existing || command.guild_id) registeredByName.set(command.name, command);
	}
	const permissionsById = new Map((input.permissions ?? []).map((p) => [p.id, p.permissions]));
	const appLevel = permissionsById.get(applicationId) ?? null;

	return commands.map((command) => {
		const enabled = command.enabled === true || command.enabled === 1;
		const registeredCommand = registeredByName.get(command.name) ?? null;
		const registered = registeredCommand !== null;
		const spacebotAllowsEveryone = memberMayUseCommand(
			{ permissions: null, roles: [] },
			command.default_member_permissions ?? null,
			command.access_rules
		);

		const commandLevel = registeredCommand
			? (permissionsById.get(registeredCommand.id) ?? null)
			: null;
		const source = commandLevel ? 'command' : appLevel ? 'application' : 'none';
		const effective = commandLevel ?? appLevel ?? [];
		const defaultMemberPermissions = registeredCommand
			? (registeredCommand.default_member_permissions ?? null)
			: null;

		const override = everyoneOverride(effective, guildId);
		const discordAllowsEveryone =
			registered &&
			!allChannelsDenied(effective, guildId) &&
			(override === null ? !restrictsEveryone(defaultMemberPermissions) : override);

		return {
			name: command.name,
			description: command.description ?? null,
			is_built_in: Boolean(command.is_built_in),
			enabled,
			registered,
			discord_command_id: registeredCommand?.id ?? null,
			default_member_permissions: defaultMemberPermissions,
			discord_overrides:
				discordKnown && input.permissions !== null
					? { source, permissions: effective }
					: null,
			spacebot_allows_everyone: spacebotAllowsEveryone,
			everyone_can_use: enabled && spacebotAllowsEveryone && discordAllowsEveryone,
		};
	});
}
