/**
 * Command permission enforcement.
 *
 * Discord enforces `default_member_permissions` at its own UI layer, but that is
 * advisory only — a crafted interaction (or a stale client) can still reach the
 * endpoint. These helpers re-check the invoking member's permissions server-side
 * at interaction dispatch time (defense in depth), failing closed when a command
 * is restricted but the member's permissions cannot be determined.
 *
 * Permission values are Discord bitfields encoded as decimal strings.
 * @see https://discord.com/developers/docs/topics/permissions
 */

import { PermissionFlagsBits } from "discord-api-types/v10";

/** Administrator permission bit — implies every other permission. */
export const ADMINISTRATOR = PermissionFlagsBits.Administrator; // 8n

/**
 * Parse a Discord permission bitfield string into a BigInt.
 * Returns null for absent/blank/invalid values.
 */
export function parsePermissionBits(value: unknown): bigint | null {
	if (value === null || value === undefined) return null;
	const str = String(value).trim();
	if (str === "") return null;
	try {
		return BigInt(str);
	} catch {
		return null;
	}
}

/**
 * Decide whether a guild member may run a command given the command's configured
 * `default_member_permissions` restriction.
 *
 * Rules (matching Discord's documented semantics):
 * - No restriction configured (null/undefined/blank) → everyone may use it.
 * - Members with ADMINISTRATOR always bypass restrictions.
 * - A restriction of "0" means "no one by default" (admins only).
 * - Otherwise the member must hold ALL bits in the required bitfield.
 * - If a restriction is set but the member's permissions are unknown, fail closed.
 *
 * @param memberPermissions   Bitfield string from `interaction.member.permissions`.
 * @param requiredPermissions The command's `default_member_permissions`.
 */
export function memberHasCommandPermission(
	memberPermissions: unknown,
	requiredPermissions: unknown,
): boolean {
	const required = parsePermissionBits(requiredPermissions);

	// No restriction configured — everyone is allowed.
	if (required === null) return true;

	const member = parsePermissionBits(memberPermissions);

	// Administrators bypass every command restriction.
	if (member !== null && (member & ADMINISTRATOR) === ADMINISTRATOR) {
		return true;
	}

	// "0" disables the command for everyone except administrators (handled above).
	if (required === 0n) return false;

	// Restricted command but the member's permissions are unknown — fail closed.
	if (member === null) return false;

	// The member must hold ALL required permission bits.
	return (member & required) === required;
}
