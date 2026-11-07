import { describe, expect, it } from 'vitest';
import {
	AREAS,
	EFFORTS,
	EFFORT_DAYS,
	MAX_BODY,
	MIN_BODY,
	computeScore,
	isScored,
	makeTitle,
	rankOf,
	validateIdea,
	type Scores,
} from '$lib/server/idea-scoring.js';

const s = (impact: number, reach: number, effort: string, confidence: number): Scores => ({
	impact,
	reach,
	effort,
	confidence,
});
const none: Scores = { impact: null, reach: null, effort: null, confidence: null };

describe('computeScore', () => {
	it('matches the worked examples in the plan', () => {
		expect(computeScore(s(4, 5, 'S', 80))).toBe(16);
		expect(computeScore(s(5, 2, 'L', 80))).toBe(1);
	});

	it('is 0 when anything is missing or out of range', () => {
		expect(computeScore(none)).toBe(0);
		expect(computeScore(s(0, 5, 'S', 80))).toBe(0);
		expect(computeScore(s(4, 6, 'S', 80))).toBe(0);
		expect(computeScore(s(4, 5, 'XXL', 80))).toBe(0);
		expect(computeScore(s(4, 5, 'S', 70))).toBe(0);
		expect(computeScore({ ...s(4, 5, 'S', 80), impact: 2.5 })).toBe(0);
	});

	it('counts the effort sizes as 0.5, 1, 3, 8 and 20 days', () => {
		expect(EFFORT_DAYS).toEqual({ XS: 0.5, S: 1, M: 3, L: 8, XL: 20 });
	});
});

describe('the ranking rules, over every combination', () => {
	const all: Scores[] = [];
	for (let i = 1; i <= 5; i++)
		for (let r = 1; r <= 5; r++)
			for (const e of EFFORTS) for (const c of [50, 80, 100]) all.push(s(i, r, e, c));

	it('is positive for every complete combination', () => {
		for (const x of all) expect(computeScore(x)).toBeGreaterThan(0);
	});

	it('never goes down when impact, reach or confidence goes up, and never goes up with effort', () => {
		for (const x of all) {
			const base = computeScore(x);
			if (x.impact! < 5)
				expect(computeScore({ ...x, impact: x.impact! + 1 })).toBeGreaterThanOrEqual(base);
			if (x.reach! < 5)
				expect(computeScore({ ...x, reach: x.reach! + 1 })).toBeGreaterThanOrEqual(base);
			if (x.confidence! < 100) {
				const up = x.confidence === 50 ? 80 : 100;
				expect(computeScore({ ...x, confidence: up })).toBeGreaterThanOrEqual(base);
			}
			const bigger = EFFORTS[EFFORTS.indexOf(x.effort as any) + 1];
			if (bigger) expect(computeScore({ ...x, effort: bigger })).toBeLessThanOrEqual(base);
		}
	});

	it('is complete exactly when all four numbers are valid', () => {
		for (const x of all) expect(isScored(x)).toBe(true);
		expect(isScored(none)).toBe(false);
	});
});

describe('rankOf', () => {
	it("prefers the superadmin's score, then the AI draft, then nothing", () => {
		const final = s(2, 2, 'S', 100);
		const draft = s(5, 5, 'XS', 100);
		expect(rankOf(final, draft)).toEqual({ score: 4, source: 'admin' });
		expect(rankOf(none, draft)).toEqual({ score: 50, source: 'ai' });
		expect(rankOf(none, none)).toEqual({ score: 0, source: null });
	});

	it('ignores a half-filled final score and falls back to the draft', () => {
		expect(rankOf({ ...none, impact: 3 }, s(1, 1, 'S', 100)).source).toBe('ai');
	});
});

describe('validateIdea', () => {
	const ok = 'Please add a command that shows server boosts.';

	it('accepts a normal idea and tidies it', () => {
		const r: any = validateIdea({
			body: `  ${ok}\r\n\r\n\r\n\r\nSecond   paragraph  `,
			area: 'commands',
		});
		expect(r.ok).toBe(true);
		expect(r.idea.body).toBe(`${ok}\n\nSecond paragraph`);
		expect(r.idea.area).toBe('commands');
	});

	it('refuses too short and too long', () => {
		expect(validateIdea({ body: 'x'.repeat(MIN_BODY - 1) }).ok).toBe(false);
		expect(validateIdea({ body: 'x'.repeat(MAX_BODY + 1) }).ok).toBe(false);
		expect(validateIdea({ body: 'x'.repeat(MAX_BODY) }).ok).toBe(true);
	});

	it('falls back to "other" for an unknown area', () => {
		expect((validateIdea({ body: ok, area: 'billing' }) as any).idea.area).toBe('other');
		for (const a of AREAS)
			expect((validateIdea({ body: ok, area: a }) as any).idea.area).toBe(a);
	});

	it('strips control characters and keeps HTML and links as plain text', () => {
		const r: any = validateIdea({ body: `${ok} <b>hi</b> https://x.test \u0000\u0007` });
		expect(r.idea.body).toBe(`${ok} <b>hi</b> https://x.test`);
	});
});

describe('makeTitle', () => {
	it('uses the given title, else the first line, cut at 100 characters', () => {
		expect(makeTitle('  My   title ', 'body')).toBe('My title');
		expect(makeTitle('', 'First line\nsecond')).toBe('First line');
		const t = makeTitle('', 'y'.repeat(300));
		expect(t.length).toBe(100);
		expect(t.endsWith('…')).toBe(true);
	});
});
