/**
 * Control actions shared by the dashboard (session auth) and the public v1 API /
 * MCP endpoint (API-key auth).
 *
 * Callers do their own authentication and guild authorization first; these
 * functions hold the behaviour (guild-scoped lookup, plan limits, Discord sync)
 * so both doors run the same code path.
 */

import { getAutomation, getAutomations, toggleAutomation } from '$lib/db/automations.js';
import {
	getCommand,
	getGuildCommands,
	setBuiltInCommandOverride,
	updateCommand,
} from '$lib/db/commands.js';
import { createScheduledMessage } from '$lib/db/scheduled-messages.js';
import { getGuildChannels } from '$lib/db/guild-channels.js';
import { checkPlanLimit } from '$lib/db/server-plans.js';
import { syncGuildCommands } from '$lib/discord/commands.js';
import { log, logEvent } from '$lib/db/logger.js';

export type ControlResult =
	{ ok: true; [k: string]: any } | { ok: false; status: number; error: string };

/**
 * Enable or disable one automation in a guild. Enabling is checked against the
 * guild's plan limit, as the dashboard has always done.
 */
export async function setAutomationEnabled(
	db,
	guildId: string,
	automationId: string | number,
	enabled: boolean
): Promise<ControlResult> {
	const existing = await getAutomation(db, automationId, guildId);
	if (!existing) return { ok: false, status: 404, error: 'Automation not found' };

	if (enabled) {
		try {
			const activeResult = await getAutomations(db, guildId, { enabled: true, limit: 1000 });
			const activeCount = activeResult.automations?.length || 0;
			const planCheck = await checkPlanLimit(db, guildId, 'automations', activeCount);
			if (!planCheck.allowed) {
				return {
					ok: false,
					status: 403,
					error: `Automation limit reached (${planCheck.current}/${planCheck.limit}). Upgrade your plan or disable another automation first.`,
				};
			}
		} catch (err) {
			log.warn('Plan limit check failed, allowing toggle:', err);
		}
	}

	const result = await toggleAutomation(db, automationId, guildId, enabled);
	if (!result.success) return { ok: false, status: 500, error: 'Failed to toggle automation' };
	return { ok: true, enabled, automation: existing };
}

/**
 * How a built-in command is toggled:
 * - 'override': per-guild override (setBuiltInCommandOverride). What a guild admin
 *   gets on the dashboard Commands page, and what an API key gets.
 * - 'global': edit the shared built-in row itself. Superadmin only; the caller
 *   must have checked that (the JSON route /api/commands/:guildId/:commandId).
 */
export type BuiltInMode = 'override' | 'global';

/**
 * Enable or disable one slash command for a guild, then sync the guild's
 * commands to Discord. Enabling a custom command is checked against the plan
 * limit, as the dashboard has always done; built-in overrides are not.
 */
export async function setCommandEnabled(
	db,
	env,
	guildId: string,
	commandId: number,
	enabled: boolean,
	{ builtIn = 'override' }: { builtIn?: BuiltInMode } = {}
): Promise<ControlResult> {
	const existing = await getCommand(db, commandId, guildId);
	if (!existing) return { ok: false, status: 404, error: 'Command not found' };

	const builtInOverride = !!existing.is_built_in && builtIn === 'override';

	if (enabled && !builtInOverride) {
		try {
			const activeCommands = await getGuildCommands(db, guildId, { enabledOnly: true });
			const planCheck = await checkPlanLimit(db, guildId, 'commands', activeCommands.length);
			if (!planCheck.allowed) {
				return {
					ok: false,
					status: 403,
					error: `Command limit reached (${planCheck.current}/${planCheck.limit}). Upgrade your plan or disable another command first.`,
				};
			}
		} catch (err) {
			log.warn('Plan limit check failed, allowing toggle:', err);
		}
	}

	const result: any = builtInOverride
		? await setBuiltInCommandOverride(db, guildId, commandId, { enabled })
		: await updateCommand(db, commandId, { enabled }, guildId);
	if (!result.success) {
		return { ok: false, status: 500, error: result.error || 'Failed to toggle command' };
	}
	await syncGuildCommands(db, guildId, env);
	return { ok: true, enabled, command: existing };
}

/**
 * Schedule a plain channel message in a guild. The channel must be one of the
 * guild's own channels (from the synced channel directory); the cron sender
 * re-checks ownership against Discord at send time.
 */
export async function scheduleChannelMessage(
	db,
	guildId: string,
	{
		channel_id,
		content,
		send_at,
		created_by,
	}: { channel_id: unknown; content: unknown; send_at: unknown; created_by?: string }
): Promise<ControlResult> {
	if (typeof channel_id !== 'string' || !/^\d{17,20}$/.test(channel_id)) {
		return { ok: false, status: 400, error: 'channel_id must be a Discord channel id' };
	}
	if (typeof content !== 'string' || !content.trim() || content.length > 2000) {
		return { ok: false, status: 400, error: 'content must be 1-2000 characters' };
	}
	if (typeof send_at !== 'string') {
		return { ok: false, status: 400, error: 'send_at must be an ISO 8601 time' };
	}

	const channels = await getGuildChannels(db, guildId);
	if (!channels.some((c) => c.channelId === channel_id)) {
		return { ok: false, status: 403, error: 'Channel does not belong to this server' };
	}

	const result = await createScheduledMessage(db, {
		guild_id: guildId,
		channel_id,
		action_type: 'SEND_MESSAGE',
		message_payload: { content },
		send_at,
		created_by,
	});
	if (!result.success)
		return { ok: false, status: 400, error: result.error || 'Failed to schedule' };
	return { ok: true, id: result.id, send_at: result.send_at };
}

/**
 * Record a write made with an API key as an event in the guild's log, naming
 * the key. Never throws: a failed log line must not undo a completed write.
 */
export async function logApiKeyWrite(
	db,
	auth: { guildId?: string; keyId?: number },
	eventType: string,
	target: { id?: string | number | null; name?: string | null; channel_id?: string | null },
	details: Record<string, any>
) {
	try {
		const row = await db
			.prepare('SELECT name FROM api_keys WHERE id = ? AND guild_id = ?')
			.bind(auth.keyId, auth.guildId)
			.first();
		const keyName = row?.name || `API key #${auth.keyId}`;
		await logEvent(db, {
			guild_id: auth.guildId,
			event_type: eventType,
			event_category: 'api',
			actor_id: `api_key:${auth.keyId}`,
			actor_name: keyName,
			actor_is_bot: true,
			target_id: target.id != null ? String(target.id) : null,
			target_name: target.name || null,
			channel_id: target.channel_id || null,
			details: { api_key_id: auth.keyId, api_key_name: keyName, ...details },
		});
	} catch (err) {
		log.warn('[API v1] Failed to log API key write:', err);
	}
}
