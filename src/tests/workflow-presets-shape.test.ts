import { describe, expect, it } from 'vitest';
import { OPERATION_TEMPLATES } from '../lib/server/superadmin-workflow-presets.js';

// A preset inserted a level too deep once became a stray node inside another
// preset's canvas, and its schedule never ran. Every node must be a node, and
// every legacy job a preset names must be a real cron job.
describe('workflow presets', () => {
	it('keeps every canvas node shaped like a node', () => {
		for (const t of OPERATION_TEMPLATES as any[]) {
			for (const node of t.canvas_json.nodes) {
				expect(node.id, `${t.slug} has a node with no id`).toBeTruthy();
				expect(node.type, `${t.slug}:${node.id}`).toBeTruthy();
				expect(
					node.name,
					`${t.slug}:${node.id} looks like a nested preset`
				).toBeUndefined();
			}
		}
	});

	it('has unique slugs and one preset per legacy job', () => {
		const slugs = OPERATION_TEMPLATES.map((t: any) => t.slug);
		expect(new Set(slugs).size).toBe(slugs.length);
		const jobs = OPERATION_TEMPLATES.map((t: any) => t.legacy_job_name).filter(Boolean);
		expect(new Set(jobs).size).toBe(jobs.length);
	});

	it('has a preset for each sweep', () => {
		const slugs = OPERATION_TEMPLATES.map((t: any) => t.slug);
		for (const slug of [
			'minute-command-sync',
			'minute-game-sweep',
			'minute-timebox-sweep',
			'minute-quorum-sweep',
		]) {
			expect(slugs).toContain(slug);
		}
	});
});
