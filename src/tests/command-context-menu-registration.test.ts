import { describe, expect, it } from "vitest";
import { toDiscordCommand } from "../lib/db/commands.js";

describe("toDiscordCommand context-menu registration", () => {
	it("returns a single slash command object when no context menus are enabled", () => {
		const result = toDiscordCommand({
			name: "greet",
			description: "Say hi",
			options: [],
		});
		expect(Array.isArray(result)).toBe(false);
		expect(result).toMatchObject({ name: "greet", type: 1 });
	});

	it("appends a USER context-menu command (type 2) without description/options", () => {
		const result = toDiscordCommand({
			name: "warn",
			description: "Warn a user",
			context_menu_user: true,
			options: [{ name: "reason", description: "why", type: 3 }],
		}) as any[];

		expect(Array.isArray(result)).toBe(true);
		expect(result).toHaveLength(2);

		const slash = result.find((c) => c.type === 1);
		const user = result.find((c) => c.type === 2);
		expect(slash.options).toHaveLength(1);
		// Context-menu commands must not carry description or options.
		expect(user).toBeDefined();
		expect(user.description).toBeUndefined();
		expect(user.options).toBeUndefined();
		expect(user.name).toBe("warn");
	});

	it("appends a MESSAGE context-menu command (type 3) without description/options", () => {
		const result = toDiscordCommand({
			name: "report",
			description: "Report a message",
			context_menu_message: true,
		}) as any[];

		expect(Array.isArray(result)).toBe(true);
		const message = result.find((c) => c.type === 3);
		expect(message).toBeDefined();
		expect(message.name).toBe("report");
		expect(message.description).toBeUndefined();
		expect(message.options).toBeUndefined();
	});

	it("emits slash + user + message variants together and propagates permissions", () => {
		const result = toDiscordCommand({
			name: "moderate",
			description: "Mod tools",
			context_menu_user: true,
			context_menu_message: true,
			default_member_permissions: "8192",
		}) as any[];

		expect(result).toHaveLength(3);
		expect(result.map((c) => c.type).sort()).toEqual([1, 2, 3]);
		for (const cmd of result) {
			expect(cmd.default_member_permissions).toBe("8192");
		}
	});
});
