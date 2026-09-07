/**
 * `/help` answers "what can I run here?".
 *
 * It used to answer with a fixed embed naming three commands, which was wrong
 * on any server that had commands of its own. The list is built per member
 * now, so the thing worth testing is the filtering: a member must not be shown
 * a command they would be refused.
 */
import { describe, expect, it } from 'vitest';
import { PermissionFlagsBits } from 'discord-api-types/v10';
import { buildHelpEmbed, buildHelpEntries, subcommandPaths } from '../lib/discord/help.js';

const ADMIN = String(PermissionFlagsBits.Administrator);
const MANAGE_MESSAGES = String(PermissionFlagsBits.ManageMessages);
const NO_PERMISSIONS = '0';

function command(name: string, extra: Record<string, any> = {}) {
	return { name, description: `Does ${name}`, ...extra };
}

describe('subcommandPaths', () => {
	it('finds plain subcommands', () => {
		const options = [
			{ name: 'create', type: 1 },
			{ name: 'delete', type: 1 },
		];

		expect(subcommandPaths(options)).toEqual(['create', 'delete']);
	});

	it('walks into subcommand groups', () => {
		const options = [
			{ name: 'create', type: 1 },
			{ name: 'owner', type: 2, options: [{ name: 'transfer', type: 1 }] },
		];

		expect(subcommandPaths(options)).toEqual(['create', 'owner transfer']);
	});

	it('ignores ordinary options', () => {
		expect(subcommandPaths([{ name: 'user', type: 6 }])).toEqual([]);
	});

	it('copes with a command that has none', () => {
		expect(subcommandPaths(undefined)).toEqual([]);
		expect(subcommandPaths(null)).toEqual([]);
	});
});

describe('buildHelpEntries', () => {
	it('lists every source together, alphabetically', () => {
		const entries = buildHelpEntries(
			{
				builtIn: [command('ping')],
				custom: [command('welcome')],
				integration: [command('github')],
			},
			NO_PERMISSIONS
		);

		expect(entries.map((e) => e.name)).toEqual(['github', 'ping', 'welcome']);
		expect(entries.map((e) => e.source)).toEqual(['integration', 'built-in', 'server']);
	});

	it('hides a command the member could not run', () => {
		const entries = buildHelpEntries(
			{
				builtIn: [command('ping')],
				custom: [command('purge', { default_member_permissions: MANAGE_MESSAGES })],
			},
			NO_PERMISSIONS
		);

		expect(entries.map((e) => e.name)).toEqual(['ping']);
	});

	it('shows a restricted command to a member who holds the permission', () => {
		const entries = buildHelpEntries(
			{ custom: [command('purge', { default_member_permissions: MANAGE_MESSAGES })] },
			MANAGE_MESSAGES
		);

		expect(entries.map((e) => e.name)).toEqual(['purge']);
	});

	it('shows everything to an administrator', () => {
		const entries = buildHelpEntries(
			{ custom: [command('purge', { default_member_permissions: MANAGE_MESSAGES })] },
			ADMIN
		);

		expect(entries.map((e) => e.name)).toEqual(['purge']);
	});

	it('hides a restricted command when permissions are unknown', () => {
		// Fail closed: a DM has no member, and guessing "allowed" would advertise
		// moderator commands to everyone.
		const entries = buildHelpEntries(
			{ custom: [command('purge', { default_member_permissions: MANAGE_MESSAGES })] },
			null
		);

		expect(entries).toEqual([]);
	});

	it('carries subcommands through', () => {
		const entries = buildHelpEntries(
			{
				builtIn: [
					command('room', {
						options: [
							{ name: 'create', type: 1 },
							{ name: 'delete', type: 1 },
						],
					}),
				],
			},
			NO_PERMISSIONS
		);

		expect(entries[0].subcommands).toEqual(['create', 'delete']);
	});

	it('lists a name once when two sources register it', () => {
		const entries = buildHelpEntries(
			{ builtIn: [command('stats')], custom: [command('stats')] },
			NO_PERMISSIONS
		);

		expect(entries).toHaveLength(1);
		expect(entries[0].source).toBe('built-in');
	});

	it('falls back for a command with no description', () => {
		const entries = buildHelpEntries(
			{ builtIn: [{ name: 'bare', description: '' }] },
			NO_PERMISSIONS
		);

		expect(entries[0].description).toBe('No description');
	});

	it('skips a nameless row rather than listing a blank command', () => {
		expect(buildHelpEntries({ builtIn: [{ description: 'x' }] }, NO_PERMISSIONS)).toEqual([]);
	});
});

describe('buildHelpEmbed', () => {
	const entries = (n: number) =>
		buildHelpEntries(
			{
				builtIn: Array.from({ length: n }, (_, i) =>
					command(`cmd${String(i).padStart(2, '0')}`)
				),
			},
			NO_PERMISSIONS
		);

	it('says so when there is nothing to show', () => {
		const embed = buildHelpEmbed([], 'GameGeeks');

		expect(embed.title).toBe('Commands in GameGeeks');
		expect(embed.description).toMatch(/no commands/i);
		expect(embed.fields).toBeUndefined();
	});

	it('gives each command its own field', () => {
		const embed = buildHelpEmbed(entries(3), 'GameGeeks');

		expect(embed.fields).toHaveLength(3);
		expect(embed.fields?.[0].name).toBe('/cmd00');
		expect(embed.description).toMatch(/^3 commands/);
	});

	it('names the count in the singular for one command', () => {
		expect(buildHelpEmbed(entries(1), null).description).toMatch(/^1 command you can use/);
	});

	it('spells out the overflow rather than dropping it', () => {
		// Discord caps an embed at 25 fields, and a member who cannot see a
		// command in help concludes it does not exist.
		const embed = buildHelpEmbed(entries(30), null);

		expect(embed.fields).toHaveLength(25);
		expect(embed.fields?.at(-1)?.name).toBe('And 6 more');
		expect(embed.fields?.at(-1)?.value).toContain('/cmd29');
	});

	it('lists subcommands under their command', () => {
		const withSubs = buildHelpEntries(
			{ builtIn: [command('room', { options: [{ name: 'create', type: 1 }] })] },
			NO_PERMISSIONS
		);

		expect(buildHelpEmbed(withSubs, null).fields?.[0].value).toContain('`/room create`');
	});

	it("keeps a field inside Discord's length limit", () => {
		const many = buildHelpEntries(
			{
				builtIn: [
					command('big', {
						options: Array.from({ length: 60 }, (_, i) => ({
							name: `subcommand-with-a-long-name-${i}`,
							type: 1,
						})),
					}),
				],
			},
			NO_PERMISSIONS
		);

		expect(buildHelpEmbed(many, null).fields?.[0].value.length).toBeLessThanOrEqual(1024);
	});
});
