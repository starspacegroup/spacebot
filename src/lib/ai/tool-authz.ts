/**
 * Server-side authorization for AI tool calls (security review 2026-10-20, #3).
 *
 * The model picks tool arguments, and the user writes the prompt, so a guild
 * id in a tool call is attacker-controlled. Telling the model which guilds the
 * user manages was the only fence. Every call is now checked against an
 * authorization context the server built (gateway member permissions, or the
 * OAuth guild list) before it runs:
 *
 * - account tools act on the session user only (pinned in chat.ts);
 * - `list_guilds` is superadmin-only;
 * - every other tool needs a `guildId` in the caller's managed set, and a
 *   `channelId` must belong to that guild.
 *
 * Superadmins pass the guild checks; the channel→guild binding still applies.
 */

import { channelBelongsToGuild } from '../automation/channel-scope.js';

export interface ToolAuthzContext {
	isSuperAdmin: boolean;
	allowedGuildIds: Set<string>;
	botToken?: string | null;
	fetchImpl?: typeof fetch;
}

export const SESSION_USER_TOOLS = new Set([
	'list_local_runners',
	'get_local_runner_activity',
	'start_local_runner_task',
	'get_local_runner_job',
	'cancel_local_runner_job',
	'retry_local_runner_job',
	'discover_vscode_instances',
	'open_vscode_workspace',
	'send_vscode_copilot_message',
	'update_user_timezone',
]);

const SUPERADMIN_ONLY_TOOLS = new Set(['list_guilds']);

export function buildToolAuthzContext({
	isSuperAdmin,
	managedGuilds,
	botToken,
}: {
	isSuperAdmin: boolean;
	managedGuilds: Array<{ id?: unknown }> | null | undefined;
	botToken?: string | null;
}): ToolAuthzContext {
	const allowedGuildIds = new Set(
		(Array.isArray(managedGuilds) ? managedGuilds : [])
			.map((g) => (g?.id == null ? '' : String(g.id)))
			.filter(Boolean)
	);
	return { isSuperAdmin: Boolean(isSuperAdmin), allowedGuildIds, botToken };
}

export async function authorizeToolCall(
	tool: string,
	args: Record<string, any>,
	ctx: ToolAuthzContext
): Promise<{ ok: boolean; error?: string }> {
	if (SESSION_USER_TOOLS.has(tool)) return { ok: true };

	if (SUPERADMIN_ONLY_TOOLS.has(tool)) {
		return ctx.isSuperAdmin
			? { ok: true }
			: { ok: false, error: `${tool} is restricted to superadmins` };
	}

	const guildId = args?.guildId == null ? '' : String(args.guildId);
	if (!guildId) return { ok: false, error: `${tool} requires a guildId` };
	if (!ctx.isSuperAdmin && !ctx.allowedGuildIds.has(guildId)) {
		return { ok: false, error: 'You do not manage that server' };
	}

	if (args?.channelId != null && args.channelId !== '') {
		const owned =
			ctx.botToken &&
			(await channelBelongsToGuild(
				ctx.botToken,
				String(args.channelId),
				guildId,
				ctx.fetchImpl
			));
		if (!owned) return { ok: false, error: 'That channel is not in this server' };
	}

	return { ok: true };
}
