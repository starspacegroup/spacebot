/**
 * /about — one short piece of content a member keeps about themselves.
 *
 * Writing is gated to one role per server, chosen by an admin with
 * `/about role`. The role is read from the interaction itself, so removing it
 * from a member takes their write access away on their next command, with no
 * cache in between. Reading is open to everyone in the server, and the same
 * rows are served by `GET /api/v1/member-content`. See docs/member-content.md.
 *
 * Content is plain text and is stored and served as typed; the bot never asks
 * Discord to ping from it (`allowed_mentions: { parse: [] }`).
 *
 * D1 only, no discord.js: the interactions route calls this on the edge.
 */

import { ADMINISTRATOR, parsePermissionBits } from '../discord/command-permissions.js';
import { RESPOND_MESSAGE } from './timebox.js';

const EPHEMERAL = 64;
const MANAGE_GUILD = 1n << 5n;
/** Longest piece of content, in characters. Matches the option's max_length. */
export const MAX_LENGTH = 500;

export async function getContributorRole(db, guildId: string): Promise<string | null> {
	const row = await db
		.prepare('SELECT role_id FROM member_content_settings WHERE guild_id = ?')
		.bind(guildId)
		.first();
	return row?.role_id ? String(row.role_id) : null;
}

export async function setContributorRole(db, guildId: string, roleId: string): Promise<void> {
	await db
		.prepare(
			`INSERT INTO member_content_settings (guild_id, role_id, updated_at)
			 VALUES (?, ?, datetime('now'))
			 ON CONFLICT(guild_id) DO UPDATE SET role_id = excluded.role_id, updated_at = excluded.updated_at`
		)
		.bind(guildId, roleId)
		.run();
}

export async function getMemberContent(db, guildId: string, userId: string) {
	const row = await db
		.prepare(
			'SELECT content, updated_at FROM member_content WHERE guild_id = ? AND user_id = ?'
		)
		.bind(guildId, userId)
		.first();
	return row ? { content: String(row.content), updated_at: String(row.updated_at) } : null;
}

export async function setMemberContent(
	db,
	guildId: string,
	userId: string,
	content: string
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO member_content (guild_id, user_id, content, updated_at)
			 VALUES (?, ?, ?, datetime('now'))
			 ON CONFLICT(guild_id, user_id)
			 DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`
		)
		.bind(guildId, userId, content)
		.run();
}

/** True when a row was removed. */
export async function clearMemberContent(db, guildId: string, userId: string): Promise<boolean> {
	const res = await db
		.prepare('DELETE FROM member_content WHERE guild_id = ? AND user_id = ?')
		.bind(guildId, userId)
		.run();
	return Number(res?.meta?.changes ?? res?.changes ?? 0) > 0;
}

/** Every member's content in a guild, newest edit first, for the API. */
export async function listMemberContent(db, guildId: string, limit = 100, offset = 0) {
	const { results } = await db
		.prepare(
			`SELECT user_id, content, updated_at FROM member_content
			 WHERE guild_id = ? ORDER BY updated_at DESC, user_id ASC LIMIT ? OFFSET ?`
		)
		.bind(guildId, limit, offset)
		.all();
	return (results ?? []).map((r) => ({
		user_id: String(r.user_id),
		content: String(r.content),
		updated_at: String(r.updated_at),
	}));
}

function mayManageServer(permissions: unknown): boolean {
	const bits = parsePermissionBits(permissions);
	if (bits === null) return false;
	return (bits & ADMINISTRATOR) === ADMINISTRATOR || (bits & MANAGE_GUILD) === MANAGE_GUILD;
}

function reply(content: string, ephemeral: boolean) {
	return {
		type: RESPOND_MESSAGE,
		data: {
			content,
			allowed_mentions: { parse: [] },
			...(ephemeral ? { flags: EPHEMERAL } : {}),
		},
	};
}

export async function handleAboutCommand(body, db) {
	const guildId = body.guild_id;
	if (!guildId) return reply('/about only works inside a server.', true);
	if (!db) return reply('The database is not available right now.', true);

	const sub = body.data?.options?.[0];
	const opt = (name: string) => sub?.options?.find((o) => o.name === name)?.value;
	const caller = String(body.member?.user?.id ?? body.user?.id ?? '');

	if (sub?.name === 'role') {
		if (!mayManageServer(body.member?.permissions)) {
			return reply(
				'Only members who can manage the server may choose the contributor role.',
				true
			);
		}
		const roleId = String(opt('role') ?? '');
		if (!roleId) return reply('Pick a role.', true);
		await setContributorRole(db, guildId, roleId);
		return reply(
			`Members with <@&${roleId}> can now set their own content with \`/about set\`.`,
			true
		);
	}

	if (sub?.name === 'show') {
		const target = String(opt('member') ?? caller);
		const found = await getMemberContent(db, guildId, target);
		if (!found) return reply(`<@${target}> has not set anything.`, true);
		return reply(`**<@${target}>**\n${found.content}`, false);
	}

	if (sub?.name === 'set' || sub?.name === 'clear') {
		// Checked on every write, from the roles Discord sent with this command.
		const roleId = await getContributorRole(db, guildId);
		if (!roleId) {
			return reply(
				'No contributor role is set for this server yet. An admin can choose one with `/about role`.',
				true
			);
		}
		const roles: string[] = (body.member?.roles ?? []).map(String);
		if (!roles.includes(roleId)) {
			return reply('Only members with the contributor role can do that.', true);
		}
		if (!caller) return reply('I could not tell who you are.', true);

		if (sub.name === 'clear') {
			const removed = await clearMemberContent(db, guildId, caller);
			return reply(removed ? 'Your content is cleared.' : 'You had nothing set.', true);
		}
		const text = String(opt('text') ?? '').trim();
		if (!text) return reply('Say what to keep.', true);
		if (text.length > MAX_LENGTH)
			return reply(`Keep it to ${MAX_LENGTH} characters or fewer.`, true);
		await setMemberContent(db, guildId, caller, text);
		return reply('Saved. Anyone can read it with `/about show`.', true);
	}

	return reply('Use `/about set`, `/about clear`, `/about show` or `/about role`.', true);
}
