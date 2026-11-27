/**
 * Per-server bot identity: a custom name and image for the bot on one server.
 * Stored in guild_bot_identity; applied to Discord with Modify Current Member.
 */
import { log } from './logger.js';
import { createDiscordRestClient } from '../discord/rest-client.js';
import { safeFetch } from '../server/safe-fetch.js';
import {
	bytesToDataUri,
	guildIconUrl,
	identityPatch,
	effectiveBotName,
	type IdentityRow,
} from '../server/bot-identity-core.js';

export interface BotIdentity extends IdentityRow {
	guild_id: string;
	applied_at: string | null;
	last_error: string | null;
	updated_at: string | null;
}

export async function getBotIdentity(db: any, guildId: string): Promise<BotIdentity> {
	const row = db
		? await db
				.prepare('SELECT * FROM guild_bot_identity WHERE guild_id = ?')
				.bind(guildId)
				.first()
		: null;
	return {
		guild_id: guildId,
		enabled: Boolean(row?.enabled),
		name: row?.name ?? null,
		avatar_mode: row?.avatar_mode === 'custom' ? 'custom' : 'server_icon',
		avatar_data: row?.avatar_data ?? null,
		applied_at: row?.applied_at ?? null,
		last_error: row?.last_error ?? null,
		updated_at: row?.updated_at ?? null,
	};
}

export async function saveBotIdentity(
	db: any,
	guildId: string,
	v: {
		enabled: boolean;
		name: string | null;
		avatar_mode: 'server_icon' | 'custom';
		avatar_data: string | null;
	},
	userId: string
) {
	await db
		.prepare(
			`INSERT INTO guild_bot_identity (guild_id, enabled, name, avatar_mode, avatar_data, applied_key, updated_by, updated_at)
			 VALUES (?, ?, ?, ?, ?, NULL, ?, CURRENT_TIMESTAMP)
			 ON CONFLICT(guild_id) DO UPDATE SET enabled = excluded.enabled, name = excluded.name,
			   avatar_mode = excluded.avatar_mode, avatar_data = excluded.avatar_data,
			   applied_key = NULL, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`
		)
		.bind(guildId, v.enabled ? 1 : 0, v.name, v.avatar_mode, v.avatar_data, userId)
		.run();
}

async function iconAsDataUri(guildId: string, hash: string | null | undefined) {
	const url = guildIconUrl(guildId, hash);
	if (!url) return null; // no icon: the bot goes back to its own picture
	try {
		const res = await safeFetch(url, {}, { timeoutMs: 8000, maxBytes: 1024 * 1024 });
		if (!res.ok) return undefined;
		const r = bytesToDataUri(new Uint8Array(await res.arrayBuffer()));
		return r.ok ? r.dataUri : undefined;
	} catch (err: any) {
		log.warn(`[BotIdentity] icon fetch failed: ${err.message}`);
		return undefined;
	}
}

export type ApplyResult =
	{ ok: true; skipped?: boolean; name: string | null } | { ok: false; error: string };

/**
 * Make Discord match the stored identity. Skips when nothing changed since the last success,
 * unless `force`. Records the outcome on the row either way.
 */
export async function applyBotIdentity(
	db: any,
	botToken: string,
	guildId: string,
	{ force = false }: { force?: boolean } = {}
): Promise<ApplyResult> {
	if (!botToken) return { ok: false, error: 'The bot token is not configured' };
	const row = await getBotIdentity(db, guildId);
	const stored = await db
		.prepare('SELECT applied_key FROM guild_bot_identity WHERE guild_id = ?')
		.bind(guildId)
		.first();
	if (!stored && !row.enabled) return { ok: true, skipped: true, name: null };

	const rest = createDiscordRestClient(botToken);
	try {
		const guild = await rest.guilds.fetch(guildId);
		const icon =
			row.enabled && row.avatar_mode === 'server_icon'
				? await iconAsDataUri(guildId, guild.icon)
				: undefined;
		const patch = identityPatch(row, guild, icon);
		const key = JSON.stringify([
			patch.nick,
			patch.avatar === undefined ? 'keep' : (patch.avatar?.length ?? 0),
			guild.icon ?? '',
			row.avatar_mode,
		]);
		if (!force && stored?.applied_key === key)
			return { ok: true, skipped: true, name: patch.nick };

		await rest.guilds.editBotMember(
			guildId,
			patch,
			'Bot identity set on the SpaceBot dashboard'
		);
		await db
			.prepare(
				`UPDATE guild_bot_identity SET applied_key = ?, applied_at = CURRENT_TIMESTAMP, last_error = NULL WHERE guild_id = ?`
			)
			.bind(key, guildId)
			.run();
		return { ok: true, name: row.enabled ? effectiveBotName(row.name, guild.name) : null };
	} catch (err: any) {
		const error = describeDiscordError(err);
		log.warn(`[BotIdentity] apply failed for ${guildId}: ${error}`);
		await db
			.prepare('UPDATE guild_bot_identity SET last_error = ? WHERE guild_id = ?')
			.bind(error, guildId)
			.run()
			.catch(() => {});
		return { ok: false, error };
	}
}

function describeDiscordError(err: any): string {
	const status = err?.status;
	if (status === 403) {
		return 'Discord refused: give the bot the Change Nickname permission on this server, then try again.';
	}
	if (status === 429)
		return 'Discord is rate limiting profile changes. Wait a few minutes and try again.';
	if (status === 404) return 'The bot is not on this server.';
	return `Discord rejected the change${status ? ` (${status})` : ''}.`;
}
