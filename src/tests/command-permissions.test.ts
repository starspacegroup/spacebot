import { describe, expect, it } from "vitest";
import {
	memberHasCommandPermission,
	parsePermissionBits,
} from "../lib/discord/command-permissions.js";

// Discord permission bits used in the assertions below.
const ADMINISTRATOR = "8";
const MANAGE_MESSAGES = "8192";
const MANAGE_GUILD = "32";
const BAN_MEMBERS = "4";

describe("parsePermissionBits", () => {
	it("returns null for absent / blank / invalid values", () => {
		expect(parsePermissionBits(null)).toBeNull();
		expect(parsePermissionBits(undefined)).toBeNull();
		expect(parsePermissionBits("")).toBeNull();
		expect(parsePermissionBits("   ")).toBeNull();
		expect(parsePermissionBits("not-a-number")).toBeNull();
	});

	it("parses decimal bitfield strings (and numbers) into BigInt", () => {
		expect(parsePermissionBits("8")).toBe(8n);
		expect(parsePermissionBits(8)).toBe(8n);
		expect(parsePermissionBits("1099511627776")).toBe(1099511627776n);
	});
});

describe("memberHasCommandPermission", () => {
	it("allows everyone when no restriction is configured", () => {
		expect(memberHasCommandPermission("0", null)).toBe(true);
		expect(memberHasCommandPermission(undefined, undefined)).toBe(true);
		expect(memberHasCommandPermission("", "")).toBe(true);
	});

	it("lets administrators bypass any restriction", () => {
		expect(memberHasCommandPermission(ADMINISTRATOR, MANAGE_MESSAGES)).toBe(true);
		// "0" means "no one by default" — admins still pass.
		expect(memberHasCommandPermission(ADMINISTRATOR, "0")).toBe(true);
		// Administrator combined with other bits still bypasses.
		expect(memberHasCommandPermission("12", BAN_MEMBERS)).toBe(true); // 8|4
	});

	it("denies non-admins when the restriction is '0' (admins only)", () => {
		expect(memberHasCommandPermission(MANAGE_MESSAGES, "0")).toBe(false);
		expect(memberHasCommandPermission("0", "0")).toBe(false);
	});

	it("allows a member holding the required permission bit", () => {
		expect(memberHasCommandPermission(MANAGE_MESSAGES, MANAGE_MESSAGES)).toBe(true);
	});

	it("denies a member missing the required permission bit", () => {
		expect(memberHasCommandPermission(BAN_MEMBERS, MANAGE_MESSAGES)).toBe(false);
		expect(memberHasCommandPermission("0", MANAGE_GUILD)).toBe(false);
	});

	it("requires ALL bits when the restriction combines multiple permissions", () => {
		const required = (BigInt(MANAGE_MESSAGES) | BigInt(BAN_MEMBERS)).toString(); // 8196
		// Member has only one of the two required bits.
		expect(memberHasCommandPermission(MANAGE_MESSAGES, required)).toBe(false);
		// Member has both required bits.
		const both = (BigInt(MANAGE_MESSAGES) | BigInt(BAN_MEMBERS)).toString();
		expect(memberHasCommandPermission(both, required)).toBe(true);
	});

	it("fails closed when the command is restricted but member perms are unknown", () => {
		expect(memberHasCommandPermission(null, MANAGE_MESSAGES)).toBe(false);
		expect(memberHasCommandPermission(undefined, "0")).toBe(false);
		expect(memberHasCommandPermission("", BAN_MEMBERS)).toBe(false);
	});
});
