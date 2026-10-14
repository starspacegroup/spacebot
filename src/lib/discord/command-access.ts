/**
 * Who may run a command: its permission level plus role rules.
 *
 * `default_member_permissions` (a permission bitfield) says what a member must
 * be *able to do*. Access rules say who they *are*: roles that are let in even
 * without that permission, and roles that are kept out even with it.
 *
 * Discord hides a command from members who lack `default_member_permissions`,
 * so a role that is allowed in despite lacking it can only see the command if
 * the command is registered without that restriction. `visibleToEveryone` says
 * when: registration drops the permission gate and this module is the gate.
 */

import {
	ADMINISTRATOR,
	memberHasCommandPermission,
	parsePermissionBits,
} from './command-permissions.js';

export interface AccessRules {
	allow_roles: string[];
	deny_roles: string[];
}

export const NO_RULES: AccessRules = { allow_roles: [], deny_roles: [] };

const SNOWFLAKE = /^\d{5,25}$/;

function ids(value: unknown): string[] {
	const list = Array.isArray(value) ? value : [];
	return [...new Set(list.map((v) => String(v).trim()).filter((v) => SNOWFLAKE.test(v)))];
}

/** Read rules from the stored JSON (or an object), ignoring anything malformed. */
export function parseAccessRules(raw: unknown): AccessRules {
	let value: any = raw;
	if (typeof raw === 'string') {
		try {
			value = JSON.parse(raw);
		} catch {
			return { ...NO_RULES };
		}
	}
	if (!value || typeof value !== 'object') return { ...NO_RULES };
	return { allow_roles: ids(value.allow_roles), deny_roles: ids(value.deny_roles) };
}

/** What to store: NULL when there is nothing to say. */
export function serializeAccessRules(
	rules: Partial<AccessRules> | null | undefined
): string | null {
	const clean = parseAccessRules(rules);
	return clean.allow_roles.length || clean.deny_roles.length ? JSON.stringify(clean) : null;
}

/** A comma-separated list from a form field, as role ids. */
export function roleIdsFromField(value: unknown): string[] {
	return ids(String(value ?? '').split(/[,\s]+/));
}

/**
 * Whether the command should be registered with no permission gate so that
 * allowed roles can see it. True when there are allowed roles and a gate to drop.
 */
export function visibleToEveryone(requiredPermissions: unknown, rules: AccessRules): boolean {
	return rules.allow_roles.length > 0 && parsePermissionBits(requiredPermissions) !== null;
}

export function memberMayUseCommand(
	member: { permissions?: unknown; roles?: unknown } | null | undefined,
	requiredPermissions: unknown,
	rawRules: unknown
): boolean {
	const rules = parseAccessRules(rawRules);
	const bits = parsePermissionBits(member?.permissions);
	if (bits !== null && (bits & ADMINISTRATOR) === ADMINISTRATOR) return true;

	const roles = new Set(Array.isArray(member?.roles) ? member!.roles.map(String) : []);
	if (rules.deny_roles.some((id) => roles.has(id))) return false;
	if (rules.allow_roles.some((id) => roles.has(id))) return true;
	return memberHasCommandPermission(member?.permissions, requiredPermissions);
}
