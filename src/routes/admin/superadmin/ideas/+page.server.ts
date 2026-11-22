import { fail, redirect } from '@sveltejs/kit';
import {
	anonymizeIdea,
	banSender,
	getIdea,
	ideaCounts,
	listBans,
	listIdeas,
	openIdeaTitles,
	rerank,
	saveReview,
	unbanSender,
	SORTS,
	type Sort,
} from '$lib/db/ideas.js';
import { scoreIdea } from '$lib/server/idea-ai.js';
import {
	AREAS,
	CONFIDENCES,
	EFFORTS,
	STATUSES,
	isEffort,
	isStatus,
} from '$lib/server/idea-scoring.js';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';

const WEEK_MS = 7 * 86_400_000;

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform, url }) {
	if (!checkIsSuperAdmin(cookies.get('discord_user_id'), platform)) throw redirect(302, '/admin');
	const db = (platform as any)?.env?.DB;
	const empty = {
		available: false as const,
		ideas: [],
		counts: { newThisWeek: 0, needsScore: 0, planned: 0, shipped: 0, total: 0 },
		selected: null,
		picker: [],
		bans: [],
		filters: {
			status: 'open',
			area: '',
			effort: '',
			needs: false,
			dups: false,
			q: '',
			sort: 'score',
		},
		options: { areas: AREAS, efforts: EFFORTS, statuses: STATUSES, confidences: CONFIDENCES },
	};
	if (!db) return empty;

	const p = url.searchParams;
	const sort = (SORTS as readonly string[]).includes(p.get('sort') ?? '')
		? (p.get('sort') as Sort)
		: 'score';
	const filters = {
		status: p.get('status') ?? 'open',
		area: p.get('area') ?? '',
		effort: p.get('effort') ?? '',
		needs: p.get('needs') === '1',
		dups: p.get('dups') === '1',
		q: (p.get('q') ?? '').slice(0, 100),
		sort,
	};
	const rows = await listIdeas(db, {
		status: filters.status,
		area: filters.area || undefined,
		effort: filters.effort || undefined,
		needsScore: filters.needs,
		hasDuplicates: filters.dups,
		q: filters.q,
		sort,
	});
	// The list needs a line per idea, not the whole text.
	const ideas = rows.map((r) => ({
		id: r.id,
		title: r.title,
		area: r.area,
		status: r.status,
		score: r.score,
		scoreSource: r.score_source,
		impact: r.impact ?? r.ai_impact,
		reach: r.reach ?? r.ai_reach,
		effort: r.effort ?? r.ai_effort,
		risk: Boolean(r.risk || r.ai_risk),
		userName: r.user_name,
		createdAt: r.created_at,
		hasDuplicates: Boolean(r.ai_duplicates && r.ai_duplicates !== '[]'),
	}));

	const id = Number(p.get('id'));
	const selected = Number.isInteger(id) && id > 0 ? await getIdea(db, id) : null;
	const picker = selected ? await openIdeaTitles(db, selected.id, 100) : [];
	return {
		available: true as const,
		ideas,
		counts: await ideaCounts(db, new Date(Date.now() - WEEK_MS).toISOString()),
		selected,
		picker,
		bans: await listBans(db),
		filters,
		options: { areas: AREAS, efforts: EFFORTS, statuses: STATUSES, confidences: CONFIDENCES },
	};
}

const text = (v: FormDataEntryValue | null, max: number) => {
	const s = String(v ?? '')
		.trim()
		.slice(0, max);
	return s || null;
};
const whole = (v: FormDataEntryValue | null, lo: number, hi: number) => {
	const s = String(v ?? '').trim();
	if (!s) return null;
	const n = Number(s);
	return Number.isInteger(n) && n >= lo && n <= hi ? n : NaN;
};

function guard(cookies: any, platform: any) {
	const userId = cookies.get('discord_user_id');
	return checkIsSuperAdmin(userId, platform) ? (userId as string) : null;
}

export const actions = {
	/** Scores, status, note, duplicate link. Re-ranks the idea. */
	review: async ({ request, cookies, platform }) => {
		const by = guard(cookies, platform);
		const db = (platform as any)?.env?.DB;
		if (!by || !db) return fail(403, { error: 'Not allowed.' });
		const f = await request.formData();
		const id = Number(f.get('id'));
		const idea = Number.isInteger(id) ? await getIdea(db, id) : null;
		if (!idea) return fail(404, { error: 'That idea is gone.' });

		const impact = whole(f.get('impact'), 1, 5);
		const reach = whole(f.get('reach'), 1, 5);
		const confidence = whole(f.get('confidence'), 50, 100);
		const effortRaw = String(f.get('effort') ?? '');
		const status = String(f.get('status') ?? '');
		const dup = whole(f.get('duplicate_of'), 1, 2_000_000_000);
		if (
			[impact, reach, confidence, dup].some((n) => Number.isNaN(n)) ||
			(confidence !== null && !(CONFIDENCES as readonly number[]).includes(confidence)) ||
			(effortRaw && !isEffort(effortRaw)) ||
			!isStatus(status)
		) {
			return fail(400, { error: 'One of the values is not allowed.' });
		}
		if (status === 'duplicate') {
			if (!dup || dup === id || !(await getIdea(db, dup))) {
				return fail(400, { error: 'Pick the idea this one repeats.' });
			}
		}
		await saveReview(
			db,
			id,
			{
				impact,
				reach,
				effort: effortRaw || null,
				confidence,
				risk: f.get('risk') === 'on',
				status,
				note: text(f.get('note'), 2000),
				duplicateOf: dup,
				shippedRef: text(f.get('shipped_ref'), 200),
			},
			by,
			new Date().toISOString()
		);
		return { ok: 'Saved.' };
	},

	/** One click on a row: set the status, or the effort, and leave the rest alone. */
	quick: async ({ request, cookies, platform }) => {
		const by = guard(cookies, platform);
		const db = (platform as any)?.env?.DB;
		if (!by || !db) return fail(403, { error: 'Not allowed.' });
		const f = await request.formData();
		const id = Number(f.get('id'));
		const idea = Number.isInteger(id) ? await getIdea(db, id) : null;
		if (!idea) return fail(404, { error: 'That idea is gone.' });
		const status = String(f.get('status') ?? idea.status);
		const effort = f.has('effort') ? String(f.get('effort')) : idea.effort;
		if (!isStatus(status) || (effort && !isEffort(effort))) {
			return fail(400, { error: 'That value is not allowed.' });
		}
		if (status === 'duplicate' && idea.status !== 'duplicate') {
			return fail(400, { error: 'Open the idea to say which one it repeats.' });
		}
		await db
			.prepare(
				`UPDATE ideas SET status = ?, effort = ?, scored_by = ?, scored_at = ? WHERE id = ?`
			)
			.bind(status, effort || null, by, new Date().toISOString(), id)
			.run();
		await rerank(db, id);
		return { ok: 'Saved.' };
	},

	/** Ask the model for a fresh draft, for an idea whose first try failed. */
	redraft: async ({ request, cookies, platform }) => {
		const by = guard(cookies, platform);
		const env = (platform as any)?.env;
		if (!by || !env?.DB) return fail(403, { error: 'Not allowed.' });
		const id = Number((await request.formData()).get('id'));
		const done = await scoreIdea(env.DB, env, id);
		return done
			? { ok: 'Draft saved.' }
			: fail(502, { error: 'No draft this time. Try again later.' });
	},

	ban: async ({ request, cookies, platform }) => {
		const by = guard(cookies, platform);
		const db = (platform as any)?.env?.DB;
		if (!by || !db) return fail(403, { error: 'Not allowed.' });
		const f = await request.formData();
		const userId = text(f.get('user_id'), 32);
		if (!userId || !/^\d{5,25}$/.test(userId))
			return fail(400, { error: 'That is not a Discord ID.' });
		await banSender(db, userId, text(f.get('reason'), 200), new Date().toISOString());
		return { ok: 'Sender blocked.' };
	},

	unban: async ({ request, cookies, platform }) => {
		const by = guard(cookies, platform);
		const db = (platform as any)?.env?.DB;
		if (!by || !db) return fail(403, { error: 'Not allowed.' });
		const userId = text((await request.formData()).get('user_id'), 32);
		if (userId) await unbanSender(db, userId);
		return { ok: 'Sender unblocked.' };
	},

	/** Take the sender's name off an idea. The text stays. */
	anonymize: async ({ request, cookies, platform }) => {
		const by = guard(cookies, platform);
		const db = (platform as any)?.env?.DB;
		if (!by || !db) return fail(403, { error: 'Not allowed.' });
		const id = Number((await request.formData()).get('id'));
		if (Number.isInteger(id)) await anonymizeIdea(db, id);
		return { ok: 'Name removed.' };
	},
};
