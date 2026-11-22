/**
 * The idea box's rules, with no database and no network, so they can be unit-tested.
 *
 * Ranking is RICE cut down to what a solo project can judge:
 *
 *   score = impact (1-5) x reach (1-5) x confidence (50, 80 or 100 %) / effort (days)
 *
 * Effort is a size, XS to XL, counted as 0.5, 1, 3, 8 and 20 days. A small change that helps many
 * people ranks above a big change that helps a few. See planning/IDEA_BOX_PLAN.md and
 * docs/ideas.md.
 */

export const EFFORTS = ['XS', 'S', 'M', 'L', 'XL'] as const;
export type Effort = (typeof EFFORTS)[number];
export const EFFORT_DAYS: Record<Effort, number> = { XS: 0.5, S: 1, M: 3, L: 8, XL: 20 };

export const CONFIDENCES = [50, 80, 100] as const;

export const AREAS = [
	'commands',
	'dashboard',
	'games',
	'automations',
	'logging',
	'server_browser',
	'other',
] as const;
export type Area = (typeof AREAS)[number];

export const STATUSES = [
	'new',
	'reviewing',
	'planned',
	'shipped',
	'declined',
	'duplicate',
] as const;
export type Status = (typeof STATUSES)[number];

export const MIN_BODY = 20;
export const MAX_BODY = 2000;
export const MAX_TITLE = 100;

/** Ideas per person: one a minute and ten a day. */
export const IDEA_LIMITS = [
	{ max: 1, windowSeconds: 60 },
	{ max: 10, windowSeconds: 86_400 },
] as const;

export type Scores = {
	impact: number | null;
	reach: number | null;
	effort: string | null;
	confidence: number | null;
};

export const isEffort = (v: unknown): v is Effort => EFFORTS.includes(v as Effort);
export const isArea = (v: unknown): v is Area => AREAS.includes(v as Area);
export const isStatus = (v: unknown): v is Status => STATUSES.includes(v as Status);

const inRange = (v: unknown, lo: number, hi: number): v is number =>
	typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/** The four numbers are complete and in range: only then is there a score to compute. */
export function isScored(s: Scores): boolean {
	return (
		inRange(s.impact, 1, 5) &&
		inRange(s.reach, 1, 5) &&
		isEffort(s.effort) &&
		(CONFIDENCES as readonly number[]).includes(s.confidence as number)
	);
}

/**
 * Impact x reach x confidence / effort-days, to two decimals (the lowest real score is 0.025, so
 * one decimal would round a scored idea down to 0 and make it look unscored). 0 when the scores
 * are incomplete.
 */
export function computeScore(s: Scores): number {
	if (!isScored(s)) return 0;
	const raw = (s.impact! * s.reach! * (s.confidence! / 100)) / EFFORT_DAYS[s.effort as Effort];
	return Math.round(raw * 100) / 100;
}

/**
 * The rank an idea sorts on: the superadmin's own score once there is one, otherwise the AI's
 * draft. `source` says which, so the list can mark a draft.
 */
export function rankOf(
	final: Scores,
	draft: Scores
): { score: number; source: 'admin' | 'ai' | null } {
	if (isScored(final)) return { score: computeScore(final), source: 'admin' };
	if (isScored(draft)) return { score: computeScore(draft), source: 'ai' };
	return { score: 0, source: null };
}

/** What the sender typed, tidied: trimmed, no control characters, blank lines kept to one. */
export function cleanText(raw: unknown): string {
	return String(raw ?? '')
		.replace(/\r\n?/g, '\n')
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
		.replace(/[ \t]+/g, ' ')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/** The title the sender gave, or the first line of the idea, cut at 100 characters. */
export function makeTitle(title: unknown, body: string): string {
	const given = cleanText(title).replace(/\s+/g, ' ');
	const base = given || (body.split('\n')[0] ?? '').replace(/\s+/g, ' ').trim();
	return base.length <= MAX_TITLE ? base : `${base.slice(0, MAX_TITLE - 1).trimEnd()}…`;
}

export type IdeaInput = { body: unknown; title?: unknown; area?: unknown };
export type CleanIdea = { body: string; title: string; area: Area };

/** Check and tidy what a sender submitted. `error` is a message for the sender. */
export function validateIdea(
	input: IdeaInput
): { ok: true; idea: CleanIdea } | { ok: false; error: string } {
	const body = cleanText(input.body);
	if (body.length < MIN_BODY) {
		return { ok: false, error: `Tell us a little more: at least ${MIN_BODY} characters.` };
	}
	if (body.length > MAX_BODY) {
		return { ok: false, error: `That is too long. Keep it under ${MAX_BODY} characters.` };
	}
	const area = isArea(input.area) ? input.area : 'other';
	return { ok: true, idea: { body, title: makeTitle(input.title, body), area } };
}

/** How the sender sees a status. `declined` is worded gently; nothing here promises a build. */
export const SENDER_STATUS: Record<Status, string> = {
	new: 'Received',
	reviewing: 'Being looked at',
	planned: 'Planned',
	shipped: 'Shipped',
	declined: 'Not planned for now',
	duplicate: 'Already suggested',
};
