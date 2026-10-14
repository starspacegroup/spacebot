import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSqliteD1 } from './helpers/sqlite-d1.js';
import {
	memberMayUseCommand,
	parseAccessRules,
	roleIdsFromField,
	serializeAccessRules,
	visibleToEveryone,
} from '../lib/discord/command-access.js';
import {
	getCommandByName,
	setBuiltInCommandOverride,
	toDiscordCommand,
} from '../lib/db/commands.js';

const HELPER = '111111111111111111';
const BANNED = '222222222222222222';
const OTHER = '333333333333333333';
const MANAGE_MESSAGES = String(1n << 13n);
const ADMIN = String(1n << 3n);

const first = (c: any) => (Array.isArray(c) ? c[0] : c);
const rules = { allow_roles: [HELPER], deny_roles: [BANNED] };
const member = (permissions: string, roles: string[] = []) => ({ permissions, roles });

describe('memberMayUseCommand', () => {
	it('is the old permission check when there are no rules', () => {
		expect(memberMayUseCommand(member('0'), null, null)).toBe(true);
		expect(memberMayUseCommand(member('0'), MANAGE_MESSAGES, null)).toBe(false);
		expect(memberMayUseCommand(member(MANAGE_MESSAGES), MANAGE_MESSAGES, null)).toBe(true);
	});

	it('lets an allowed role in without the permission', () => {
		expect(memberMayUseCommand(member('0', [HELPER]), MANAGE_MESSAGES, rules)).toBe(true);
		expect(memberMayUseCommand(member('0', [OTHER]), MANAGE_MESSAGES, rules)).toBe(false);
	});

	it('still lets the permission through when roles are listed', () => {
		expect(memberMayUseCommand(member(MANAGE_MESSAGES, [OTHER]), MANAGE_MESSAGES, rules)).toBe(
			true
		);
	});

	it('keeps a denied role out even with the permission, or an allowed role', () => {
		expect(memberMayUseCommand(member(MANAGE_MESSAGES, [BANNED]), MANAGE_MESSAGES, rules)).toBe(
			false
		);
		expect(memberMayUseCommand(member('0', [HELPER, BANNED]), null, rules)).toBe(false);
		expect(memberMayUseCommand(member('0', [BANNED]), null, rules)).toBe(false);
	});

	it('never locks out an administrator', () => {
		expect(memberMayUseCommand(member(ADMIN, [BANNED]), MANAGE_MESSAGES, rules)).toBe(true);
	});

	it('fails closed when the member has no roles or permissions to read', () => {
		expect(memberMayUseCommand(undefined, MANAGE_MESSAGES, rules)).toBe(false);
		expect(memberMayUseCommand({ permissions: '0' }, MANAGE_MESSAGES, rules)).toBe(false);
	});
});

describe('rule storage', () => {
	it('keeps only real role ids, once each, and stores nothing for empty rules', () => {
		expect(
			parseAccessRules('{"allow_roles":["111111111111111111","x","111111111111111111"]}')
		).toEqual({
			allow_roles: [HELPER],
			deny_roles: [],
		});
		expect(parseAccessRules('not json')).toEqual({ allow_roles: [], deny_roles: [] });
		expect(serializeAccessRules({ allow_roles: [], deny_roles: [] })).toBeNull();
		expect(JSON.parse(serializeAccessRules(rules)!)).toEqual(rules);
		expect(roleIdsFromField(`${HELPER}, ${BANNED}  junk`)).toEqual([HELPER, BANNED]);
	});

	it('registers a gated command without the gate only when roles are allowed in', () => {
		expect(visibleToEveryone(MANAGE_MESSAGES, rules)).toBe(true);
		expect(visibleToEveryone(MANAGE_MESSAGES, { allow_roles: [], deny_roles: [BANNED] })).toBe(
			false
		);
		expect(visibleToEveryone(null, rules)).toBe(false);
		const base = { name: 'x', description: 'd', default_member_permissions: MANAGE_MESSAGES };
		expect(
			first(toDiscordCommand({ ...base, access_rules: rules })).default_member_permissions
		).toBeUndefined();
		expect(
			first(
				toDiscordCommand({
					...base,
					access_rules: { allow_roles: [], deny_roles: [BANNED] },
				})
			).default_member_permissions
		).toBe(MANAGE_MESSAGES);
	});
});

describe('a built-in command override carries the rules', () => {
	const migration = (f: string, cut?: string) => {
		const sql = readFileSync(new URL(`../../migrations/${f}`, import.meta.url), 'utf8');
		return cut ? sql.split(cut)[0] : sql;
	};
	const db = () =>
		createSqliteD1(
			`CREATE TABLE commands (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, name TEXT, description TEXT, enabled INTEGER DEFAULT 1, is_built_in INTEGER DEFAULT 0, options TEXT, ephemeral INTEGER DEFAULT 0, defer INTEGER DEFAULT 0, action_type TEXT, action_config TEXT, response_type TEXT, response_content TEXT, response_embed TEXT, default_member_permissions TEXT);` +
				migration('0037_built_in_command_overrides.sql') +
				migration('0073_command_access_rules.sql') +
				`INSERT INTO commands (guild_id, name, description, enabled, is_built_in, options, action_type, action_config) VALUES ('__built_in__', 'timebox', 'd', 1, 1, '[]', 'NONE', '{}');`
		);

	it('stores rules per server and hands them back at dispatch', async () => {
		const d = db();
		const id = (await d.prepare(`SELECT id FROM commands`).first()).id;
		await setBuiltInCommandOverride(d, 'g1', id, {
			default_member_permissions: MANAGE_MESSAGES,
			access_rules: rules,
		});
		const there = await getCommandByName(d, 'timebox', 'g1');
		expect(there.default_member_permissions).toBe(MANAGE_MESSAGES);
		expect(there.access_rules).toEqual(rules);
		expect((await getCommandByName(d, 'timebox', 'g2')).access_rules).toEqual({
			allow_roles: [],
			deny_roles: [],
		});
	});

	it('drops the override row when nothing is left in it', async () => {
		const d = db();
		const id = (await d.prepare(`SELECT id FROM commands`).first()).id;
		await setBuiltInCommandOverride(d, 'g1', id, { access_rules: rules });
		await setBuiltInCommandOverride(d, 'g1', id, {
			access_rules: { allow_roles: [], deny_roles: [] },
		});
		expect(
			(await d.prepare(`SELECT COUNT(*) n FROM built_in_command_overrides`).first()).n
		).toBe(0);
	});
});
