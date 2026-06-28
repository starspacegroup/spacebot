import { describe, expect, it } from "vitest";
import {
	applyContextMenuTargetToEvent,
	extractContextMenuTarget,
} from "../lib/discord/context-menu.js";

// Mirrors the shape Discord sends for USER (type 2) context-menu commands.
function userContextData() {
	return {
		name: "warn",
		type: 2, // ApplicationCommandType.User
		target_id: "user-123",
		resolved: {
			users: {
				"user-123": { id: "user-123", username: "spacefan" },
			},
		},
	};
}

// Mirrors the shape Discord sends for MESSAGE (type 3) context-menu commands.
function messageContextData() {
	return {
		name: "report",
		type: 3, // ApplicationCommandType.Message
		target_id: "msg-999",
		resolved: {
			messages: {
				"msg-999": {
					id: "msg-999",
					content: "this is the reported message",
					author: { id: "author-42", username: "poster" },
				},
			},
		},
	};
}

describe("extractContextMenuTarget", () => {
	it("returns null for slash commands and missing targets", () => {
		expect(extractContextMenuTarget({ name: "ping", type: 1 })).toBeNull();
		expect(extractContextMenuTarget({ name: "x", type: 2 })).toBeNull(); // no target_id
		expect(extractContextMenuTarget(null)).toBeNull();
		expect(extractContextMenuTarget(undefined)).toBeNull();
	});

	it("extracts the selected user for USER context menus", () => {
		const target = extractContextMenuTarget(userContextData());
		expect(target).toEqual({
			kind: "user",
			targetId: "user-123",
			user: { id: "user-123", name: "spacefan" },
		});
	});

	it("falls back to 'Unknown' when the resolved user is absent", () => {
		const target = extractContextMenuTarget({
			name: "warn",
			type: 2,
			target_id: "user-x",
			resolved: { users: {} },
		});
		expect(target?.user).toEqual({ id: "user-x", name: "Unknown" });
	});

	it("extracts the message and its author for MESSAGE context menus", () => {
		const target = extractContextMenuTarget(messageContextData(), "chan-7");
		expect(target?.kind).toBe("message");
		expect(target?.targetId).toBe("msg-999");
		expect(target?.message).toEqual({
			id: "msg-999",
			content: "this is the reported message",
			channelId: "chan-7",
			authorId: "author-42",
			authorName: "poster",
		});
		// The message author becomes the acting target user.
		expect(target?.user).toEqual({ id: "author-42", name: "poster" });
	});
});

describe("applyContextMenuTargetToEvent", () => {
	it("populates target_id and options.user for USER context menus", () => {
		const event: any = { options: {} };
		const target = applyContextMenuTargetToEvent(event, userContextData());
		expect(target?.kind).toBe("user");
		expect(event.target_id).toBe("user-123");
		expect(event.options.user).toBe("user-123");
	});

	it("populates message + author fields for MESSAGE context menus", () => {
		const event: any = { options: {} };
		applyContextMenuTargetToEvent(event, messageContextData(), "chan-7");
		// The message id lives in target_message_id; target_id stays a USER id
		// (the author) so resolveTargetUser-driven actions work unchanged.
		expect(event.target_message_id).toBe("msg-999");
		expect(event.target_id).toBe("author-42");
		expect(event.options.message).toBe("msg-999");
		expect(event.options.message_content).toBe("this is the reported message");
		// Author routed as the user target so user-targeting actions work.
		expect(event.options.user).toBe("author-42");
	});

	it("does not set a user target_id for an authorless message", () => {
		const event: any = { options: {} };
		applyContextMenuTargetToEvent(event, {
			name: "report",
			type: 3,
			target_id: "msg-555",
			resolved: { messages: { "msg-555": { id: "msg-555", content: "hi" } } },
		});
		// No author → no user target; the message id must not leak into target_id.
		expect(event.target_id).toBeUndefined();
		expect(event.target_message_id).toBe("msg-555");
		expect(event.options.user).toBeUndefined();
	});

	it("leaves the event untouched and returns null for slash commands", () => {
		const event: any = { options: {} };
		const result = applyContextMenuTargetToEvent(event, { name: "ping", type: 1 });
		expect(result).toBeNull();
		expect(event.target_id).toBeUndefined();
		expect(event.options).toEqual({});
	});
});
