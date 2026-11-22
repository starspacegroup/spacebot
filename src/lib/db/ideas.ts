/**
 * The idea box's tables: `ideas` and `idea_bans` (migration 0095).
 *
 * Plain SQL and no policy. Who may send, how often, and what counts as a duplicate live in
 * `server/idea-intake.ts`; the score formula lives in `server/idea-scoring.ts`.
 */

import { isEffort, isStatus, rankOf, type CleanIdea, type Status } from '../server/idea-scoring.js';

type Db = any;

export type IdeaRow = {
	id: number;
	created_at: string;
	source: 'web' | 'command';
	user_id: string | null;
	user_name: string | null;
	guild_id: string | null;
	title: string;
	body: string;
	area: string;
	status: Status;
	duplicate_of: number | null;
	shipped_ref: string | null;
	admin_note: string | null;
	ai_summary: string | null;
	ai_impact: number | null;
	ai_reach: number | null;
	ai_effort: string | null;
	ai_confidence: number | null;
	ai_risk: number;
	ai_reasoning: string | null;
	ai_duplicates: string | null;
	ai_exists: string | null;
	ai_scored_at: string | null;
	impact: number | null;
	reach: number | null;
	effort: string | null;
	confidence: number | null;
	risk: number;
	scored_by: string | null;
	scored_at: string | null;
	score: number;
	score_source: 'admin' | 'ai' | null;
};

export async function insertIdea(
	db: Db,
	row: {
		source: 'web' | 'command';
		userId: string;
		userName: string | null;
		guildId: string | null;
		idea: CleanIdea;
		now: string;
	}
): Promise<number> {
	const res = await db
		.prepare(
			`INSERT INTO ideas (created_at, source, user_id, user_name, guild_id, title, body, area)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			row.now,
			row.source,
			row.userId,
			row.userName,
			row.guildId,
			row.idea.title,
			row.idea.body,
			row.idea.area
		)
		.run();
	return Number(res?.meta?.last_row_id ?? 0);
}

/** The same person sending the same text again since `sinceIso`. */
export async function findRecentCopy(
	db: Db,
	userId: string,
	body: string,
	sinceIso: string
): Promise<number | null> {
	const row = await db
		.prepare(`SELECT id FROM ideas WHERE user_id = ? AND body = ? AND created_at >= ? LIMIT 1`)
		.bind(userId, body, sinceIso)
		.first();
	return row ? Number(row.id) : null;
}

export async function getIdea(db: Db, id: number): Promise<IdeaRow | null> {
	return (await db.prepare(`SELECT * FROM ideas WHERE id = ?`).bind(id).first()) ?? null;
}

/** A sender's own ideas, newest first. Only what the sender may see. */
export async function ideasBy(db: Db, userId: string, limit = 50) {
	const { results } = await db
		.prepare(
			`SELECT id, created_at, title, status FROM ideas
			  WHERE user_id = ? ORDER BY id DESC LIMIT ?`
		)
		.bind(userId, limit)
		.all();
	return (results ?? []) as Array<{
		id: number;
		created_at: string;
		title: string;
		status: Status;
	}>;
}

export const SORTS = ['score', 'newest'] as const;
export type Sort = (typeof SORTS)[number];

export type ListFilter = {
	status?: string;
	area?: string;
	effort?: string;
	/** Only ideas the superadmin has not scored yet. */
	needsScore?: boolean;
	/** Only ideas the AI flagged as likely duplicates of another. */
	hasDuplicates?: boolean;
	q?: string;
	sort?: Sort;
	limit?: number;
};

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function listIdeas(db: Db, f: ListFilter = {}): Promise<IdeaRow[]> {
	const where: string[] = [];
	const args: unknown[] = [];
	if (f.status === 'open') where.push(`status IN ('new', 'reviewing')`);
	else if (f.status && f.status !== 'all' && isStatus(f.status)) {
		where.push('status = ?');
		args.push(f.status);
	}
	if (f.area) {
		where.push('area = ?');
		args.push(f.area);
	}
	if (f.effort && isEffort(f.effort)) {
		where.push('COALESCE(effort, ai_effort) = ?');
		args.push(f.effort);
	}
	if (f.needsScore) where.push(`score_source IS NOT 'admin'`);
	if (f.hasDuplicates) where.push(`ai_duplicates IS NOT NULL AND ai_duplicates != '[]'`);
	const q = (f.q ?? '').trim().slice(0, 100);
	if (q) {
		where.push(`(title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')`);
		args.push(`%${escapeLike(q)}%`, `%${escapeLike(q)}%`);
	}
	const order = f.sort === 'newest' ? 'id DESC' : 'score DESC, id DESC';
	const limit = Math.min(Math.max(Math.trunc(f.limit ?? 200), 1), 500);
	const sql = `SELECT * FROM ideas ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
	             ORDER BY ${order} LIMIT ?`;
	const { results } = await db
		.prepare(sql)
		.bind(...args, limit)
		.all();
	return (results ?? []) as IdeaRow[];
}

/** The titles of ideas still open, for the AI's duplicate check. */
export async function openIdeaTitles(db: Db, exceptId: number, limit = 60) {
	const { results } = await db
		.prepare(
			`SELECT id, title FROM ideas
			  WHERE status IN ('new', 'reviewing', 'planned') AND id != ?
			  ORDER BY id DESC LIMIT ?`
		)
		.bind(exceptId, limit)
		.all();
	return (results ?? []) as Array<{ id: number; title: string }>;
}

export async function ideaCounts(db: Db, weekAgoIso: string) {
	const row = await db
		.prepare(
			`SELECT
			   SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS new_this_week,
			   SUM(CASE WHEN status IN ('new', 'reviewing') AND score_source IS NOT 'admin' THEN 1 ELSE 0 END) AS needs_score,
			   SUM(CASE WHEN status = 'planned' THEN 1 ELSE 0 END) AS planned,
			   SUM(CASE WHEN status = 'shipped' THEN 1 ELSE 0 END) AS shipped,
			   COUNT(*) AS total
			 FROM ideas`
		)
		.bind(weekAgoIso)
		.first();
	return {
		newThisWeek: Number(row?.new_this_week ?? 0),
		needsScore: Number(row?.needs_score ?? 0),
		planned: Number(row?.planned ?? 0),
		shipped: Number(row?.shipped ?? 0),
		total: Number(row?.total ?? 0),
	};
}

/** Work the rank out again from the stored scores and save it. */
export async function rerank(db: Db, id: number): Promise<void> {
	const r = await getIdea(db, id);
	if (!r) return;
	const { score, source } = rankOf(
		{ impact: r.impact, reach: r.reach, effort: r.effort, confidence: r.confidence },
		{ impact: r.ai_impact, reach: r.ai_reach, effort: r.ai_effort, confidence: r.ai_confidence }
	);
	await db
		.prepare(`UPDATE ideas SET score = ?, score_source = ? WHERE id = ?`)
		.bind(score, source, id)
		.run();
}

export type Draft = {
	summary: string;
	impact: number;
	reach: number;
	effort: string;
	confidence: number;
	risk: boolean;
	reasoning: string;
	duplicates: number[];
};

export async function saveDraft(db: Db, id: number, d: Draft, nowIso: string): Promise<void> {
	await db
		.prepare(
			`UPDATE ideas SET ai_summary = ?, ai_impact = ?, ai_reach = ?, ai_effort = ?,
			        ai_confidence = ?, ai_risk = ?, ai_reasoning = ?, ai_duplicates = ?, ai_scored_at = ?
			  WHERE id = ?`
		)
		.bind(
			d.summary,
			d.impact,
			d.reach,
			d.effort,
			d.confidence,
			d.risk ? 1 : 0,
			d.reasoning,
			JSON.stringify(d.duplicates),
			nowIso,
			id
		)
		.run();
	await rerank(db, id);
}

export type Review = {
	impact: number | null;
	reach: number | null;
	effort: string | null;
	confidence: number | null;
	risk: boolean;
	status: Status;
	note: string | null;
	duplicateOf: number | null;
	shippedRef: string | null;
};

/** The superadmin's call: scores, status, note, duplicate link. Re-ranks the idea. */
export async function saveReview(
	db: Db,
	id: number,
	r: Review,
	by: string,
	nowIso: string
): Promise<void> {
	await db
		.prepare(
			`UPDATE ideas SET impact = ?, reach = ?, effort = ?, confidence = ?, risk = ?,
			        status = ?, admin_note = ?, duplicate_of = ?, shipped_ref = ?,
			        scored_by = ?, scored_at = ?
			  WHERE id = ?`
		)
		.bind(
			r.impact,
			r.reach,
			r.effort,
			r.confidence,
			r.risk ? 1 : 0,
			r.status,
			r.note,
			r.status === 'duplicate' ? r.duplicateOf : null,
			r.shippedRef,
			by,
			nowIso,
			id
		)
		.run();
	await rerank(db, id);
}

/** Take the sender's name off an idea. The idea text stays. */
export async function anonymizeIdea(db: Db, id: number): Promise<void> {
	await db
		.prepare(`UPDATE ideas SET user_id = NULL, user_name = NULL WHERE id = ?`)
		.bind(id)
		.run();
}

export async function isBanned(db: Db, userId: string): Promise<boolean> {
	const row = await db
		.prepare(`SELECT 1 AS x FROM idea_bans WHERE user_id = ?`)
		.bind(userId)
		.first();
	return Boolean(row);
}

export async function banSender(db: Db, userId: string, reason: string | null, nowIso: string) {
	await db
		.prepare(`INSERT OR REPLACE INTO idea_bans (user_id, reason, created_at) VALUES (?, ?, ?)`)
		.bind(userId, reason, nowIso)
		.run();
}

export async function unbanSender(db: Db, userId: string) {
	await db.prepare(`DELETE FROM idea_bans WHERE user_id = ?`).bind(userId).run();
}

export async function listBans(db: Db) {
	const { results } = await db
		.prepare(
			`SELECT user_id, reason, created_at FROM idea_bans ORDER BY created_at DESC LIMIT 200`
		)
		.all();
	return (results ?? []) as Array<{ user_id: string; reason: string | null; created_at: string }>;
}

/** Remember that the idea looks like something SpaceBot already does. */
export async function saveExists(db: Db, id: number, text: string): Promise<void> {
	await db
		.prepare(`UPDATE ideas SET ai_exists = ? WHERE id = ?`)
		.bind(text.slice(0, 400), id)
		.run();
}
