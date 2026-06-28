/**
 * Context-menu (application command type 2/3) routing helpers.
 *
 * Discord delivers context-menu commands through the same APPLICATION_COMMAND
 * interaction as slash commands, but the chosen target lives in
 * `data.target_id` + `data.resolved` instead of in `data.options`. These helpers
 * normalize that target so context-menu commands can reuse the slash-command
 * action pipeline (the action executor reads `event.target_id` / `event.options`).
 *
 * @see https://discord.com/developers/docs/interactions/application-commands#application-command-object-application-command-types
 */

import { ApplicationCommandType } from "discord-api-types/v10";

export interface ContextMenuUser {
	id: string;
	name: string;
}

export interface ContextMenuMessage {
	id: string;
	content: string;
	channelId?: string;
	authorId?: string;
	authorName?: string;
}

export interface ContextMenuTarget {
	/** Which kind of context menu invoked the command. */
	kind: "user" | "message";
	/** The raw Discord target id (a user id for "user", a message id for "message"). */
	targetId: string;
	/** Resolved acting target user — the selected user, or a message's author. */
	user?: ContextMenuUser;
	/** Resolved message (message context menu only). */
	message?: ContextMenuMessage;
}

/**
 * Extract the resolved target from an APPLICATION_COMMAND interaction's `data`.
 * Returns null for slash commands (type 1) or when no target is present.
 *
 * @param data       The interaction `data` object.
 * @param channelId  The interaction's channel id (used for message targets).
 */
export function extractContextMenuTarget(
	data: any,
	channelId?: string,
): ContextMenuTarget | null {
	if (!data || !data.target_id) return null;

	const targetId = String(data.target_id);

	if (data.type === ApplicationCommandType.User) {
		const resolved = data.resolved?.users?.[targetId];
		return {
			kind: "user",
			targetId,
			user: { id: targetId, name: resolved?.username || "Unknown" },
		};
	}

	if (data.type === ApplicationCommandType.Message) {
		const message = data.resolved?.messages?.[targetId];
		const authorId = message?.author?.id;
		return {
			kind: "message",
			targetId,
			message: {
				id: targetId,
				content: message?.content || "",
				channelId,
				authorId,
				authorName: message?.author?.username,
			},
			// Treat the message author as the acting target user so existing
			// user-targeting actions (DM, add role, etc.) work on message commands.
			user: authorId
				? { id: authorId, name: message?.author?.username || "Unknown" }
				: undefined,
		};
	}

	return null;
}

/** Minimal shape of the action-executor event this helper writes into. */
interface MutableActionEvent {
	target_id?: any;
	target_message_id?: any;
	options: Record<string, any>;
	[key: string]: any;
}

/**
 * Apply a context-menu target onto an action-executor event, populating
 * `target_id` and the relevant `options.*` keys so downstream actions resolve
 * the same way they do for slash-command options.
 *
 * Returns the extracted target (or null when the interaction is not a context
 * menu), so callers can branch if needed.
 */
export function applyContextMenuTargetToEvent(
	event: MutableActionEvent,
	data: any,
	channelId?: string,
): ContextMenuTarget | null {
	const target = extractContextMenuTarget(data, channelId);
	if (!target) return null;

	if (target.kind === "user" && target.user) {
		// The action executor reads `event.target_id` as the acting *user* id
		// (see resolveTargetUser in automation/engine.ts), so target_id is the
		// selected user.
		event.target_id = target.targetId;
		event.options.user = target.user.id;
	}

	if (target.kind === "message" && target.message) {
		// Keep the message id separate; `target_id` must remain a user id so
		// existing user-targeting actions (DM, kick, add role, …) resolve the
		// same way they do for user context menus / slash options.
		event.target_message_id = target.message.id;
		event.options.message = target.message.id;
		event.options.message_content = target.message.content;
		if (target.message.authorId) {
			event.target_id = target.message.authorId;
			event.options.user = target.message.authorId;
		}
	}

	return target;
}
