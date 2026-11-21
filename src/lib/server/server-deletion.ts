/**
 * Delete a server and everything SpaceBot holds about it.
 *
 * The list below is every table that carries a server's data. Child tables come before the table
 * they hang off, and a table is finished before the next starts, so a run that stops half way
 * leaves nothing without its parent. Run it again and it carries on.
 *
 * Big tables go in slices of SLICE rows; a D1 statement that deletes 200,000 rows at once times out.
 * One call spends at most `budget` statements, so a huge server may need the button pressed twice.
 *
 * What is kept: one row in server_deletions (server id, who, when, how many rows). No names, no content.
 */

type Db = any;

/** How a table points at a server. `via` means "through this parent table's id column". */
type Target =
	| { table: string; column: string }
	| { table: string; via: { parent: string; parentKey: string; column: string } };

const own = (table: string, column = 'guild_id'): Target => ({ table, column });
const child = (table: string, column: string, parent: string, parentKey = 'id'): Target => ({
	table,
	via: { parent, parentKey, column },
});

export const SERVER_TARGETS: Target[] = [
	// children first
	child('game_votes', 'meeting_id', 'game_meetings'),
	child('game_meetings', 'round_id', 'game_rounds'),
	child('game_players', 'round_id', 'game_rounds'),
	child('shiritori_players', 'round_id', 'shiritori_rounds'),
	child('shiritori_round_words', 'round_id', 'shiritori_rounds'),
	child('shiritori_words', 'chain_id', 'shiritori_chains'),
	child('quorum_votes', 'question_id', 'quorum_questions'),
	child('quorum_reminders', 'question_id', 'quorum_questions'),
	child('timebox_participants', 'session_id', 'timebox_sessions'),
	child('automation_trigger_state', 'automation_id', 'automations'),
	child('anniversary_timeline_posts', 'timeline_id', 'anniversary_timelines'),
	// then the parents and everything keyed by the server itself
	own('game_rounds'),
	own('shiritori_rounds'),
	own('shiritori_chains'),
	own('quorum_questions'),
	own('timebox_sessions'),
	own('automations'),
	own('anniversary_timelines'),
	own('game_display_names'),
	own('game_settings'),
	own('shiritori_member_stats'),
	own('shiritori_settings'),
	own('quorum_settings'),
	own('timebox_settings'),
	own('topic_custom'),
	own('topic_settings'),
	own('personality_custom'),
	own('personality_hidden'),
	own('member_content'),
	own('member_content_settings'),
	own('managed_channels'),
	own('scheduled_messages'),
	own('button_action_sets'),
	own('button_click_logs'),
	own('command_logs'),
	own('event_logs'),
	own('automation_logs'),
	own('aggregated_stats'),
	own('server_stats'),
	own('voice_sessions'),
	own('live_voice_states'),
	own('stats_processing_checkpoint'),
	own('site_listing_daily'),
	own('guild_listings'),
	own('community_reviews'),
	own('guild_members_cache'),
	own('guild_roles_cache'),
	own('guild_channels'),
	own('guild_cache_metadata'),
	own('guild_metadata'),
	own('guild_branding'),
	own('guild_integrations'),
	own('guild_command_sync'),
	own('built_in_command_overrides'),
	own('channel_presets'),
	own('connect_authorization_codes'),
	own('user_profile_preferences'),
	own('user_guilds'),
	own('ideas'),
	own('webhooks'),
	own('api_keys'),
	own('billing_history'),
	own('commands'),
	own('server_plans'),
	own('guild_settings'),
];

export const SLICE = 5000;
export const DEFAULT_BUDGET = 150;

const ID = /^\d{17,20}$/;

function statementFor(db: Db, t: Target, guildId: string) {
	if ('column' in t) {
		return db
			.prepare(
				`DELETE FROM ${t.table} WHERE rowid IN (SELECT rowid FROM ${t.table} WHERE ${t.column} = ? LIMIT ${SLICE})`
			)
			.bind(guildId);
	}
	const { parent, parentKey, column } = t.via;
	// Two hops reach the grandchildren (game_votes → meetings → rounds).
	const parentSelect = grandparentOf(parent)
		? `SELECT ${parentKey} FROM ${parent} WHERE ${grandparentOf(parent)!.column} IN (SELECT id FROM ${grandparentOf(parent)!.table} WHERE guild_id = ?)`
		: `SELECT ${parentKey} FROM ${parent} WHERE guild_id = ?`;
	return db
		.prepare(
			`DELETE FROM ${t.table} WHERE rowid IN (SELECT rowid FROM ${t.table} WHERE ${column} IN (${parentSelect}) LIMIT ${SLICE})`
		)
		.bind(guildId);
}

/** game_meetings has no guild_id of its own: it hangs off game_rounds. */
function grandparentOf(parent: string): { table: string; column: string } | null {
	return parent === 'game_meetings' ? { table: 'game_rounds', column: 'round_id' } : null;
}

export interface DeletionResult {
	done: boolean;
	removed: number;
	/** The table it stopped at, when not done. */
	stoppedAt?: string;
}

/**
 * Delete what the server owns. Safe to run again. Only touches rows for this server id.
 * A table that is missing (an old database) is skipped, never an error.
 */
export async function deleteServerData(
	db: Db,
	guildId: string,
	budget = DEFAULT_BUDGET
): Promise<DeletionResult> {
	if (!db || !ID.test(guildId)) throw new Error('A valid server id and database are required.');
	let removed = 0;
	let used = 0;
	for (const target of SERVER_TARGETS) {
		for (;;) {
			if (used >= budget) return { done: false, removed, stoppedAt: target.table };
			used++;
			let changes = 0;
			try {
				const res: any = await statementFor(db, target, guildId).run();
				changes = Number(res?.meta?.changes ?? 0);
			} catch (error) {
				if (/no such table/i.test(String((error as Error)?.message))) break;
				throw error;
			}
			removed += changes;
			if (changes < SLICE) break;
		}
	}
	// The dashboard's own record of what each person did on this server's pages.
	const pathLike = `/admin/${guildId}%`;
	for (;;) {
		if (used >= budget) return { done: false, removed, stoppedAt: 'user_activity_logs' };
		used++;
		let changes = 0;
		try {
			const res: any = await db
				.prepare(
					`DELETE FROM user_activity_logs WHERE rowid IN (SELECT rowid FROM user_activity_logs WHERE path LIKE ? LIMIT ${SLICE})`
				)
				.bind(pathLike)
				.run();
			changes = Number(res?.meta?.changes ?? 0);
		} catch (error) {
			if (/no such table/i.test(String((error as Error)?.message))) break;
			throw error;
		}
		removed += changes;
		if (changes < SLICE) break;
	}
	return { done: true, removed };
}

/** Everything left for this server, by table. Used to prove the delete worked. */
export async function remainingRows(db: Db, guildId: string): Promise<Record<string, number>> {
	const out: Record<string, number> = {};
	for (const t of SERVER_TARGETS) {
		if (!('column' in t)) continue;
		try {
			const row: any = await db
				.prepare(`SELECT COUNT(*) AS n FROM ${t.table} WHERE ${t.column} = ?`)
				.bind(guildId)
				.first();
			if (Number(row?.n) > 0) out[t.table] = Number(row.n);
		} catch {
			// missing table
		}
	}
	return out;
}

export async function recordDeletion(
	db: Db,
	guildId: string,
	userId: string,
	removed: number,
	complete: boolean
) {
	await db
		.prepare(
			`INSERT INTO server_deletions (guild_id, deleted_by, rows_removed, complete, started_at, finished_at)
			 VALUES (?, ?, ?, ?, datetime('now'), CASE WHEN ? THEN datetime('now') END)`
		)
		.bind(guildId, userId, removed, complete ? 1 : 0, complete ? 1 : 0)
		.run();
}

/** Take the bot out of the server. Best effort: it may already be gone. */
export async function removeBotFromServer(botToken: string | undefined, guildId: string) {
	if (!botToken || !ID.test(guildId)) return false;
	try {
		const res = await fetch(`https://discord.com/api/v10/users/@me/guilds/${guildId}`, {
			method: 'DELETE',
			headers: { Authorization: `Bot ${botToken}` },
			signal: AbortSignal.timeout(5000),
		});
		return res.ok || res.status === 404;
	} catch {
		return false;
	}
}

/** Remove SpaceBot's slash commands from the server. Best effort. */
export async function clearServerCommands(
	botToken: string | undefined,
	clientId: string | undefined,
	guildId: string
) {
	if (!botToken || !clientId || !ID.test(guildId)) return false;
	try {
		const res = await fetch(
			`https://discord.com/api/v10/applications/${clientId}/guilds/${guildId}/commands`,
			{
				method: 'PUT',
				headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
				body: '[]',
				signal: AbortSignal.timeout(5000),
			}
		);
		return res.ok;
	} catch {
		return false;
	}
}
