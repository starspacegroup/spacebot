import { describe, expect, it } from 'vitest';
import {
	OPERATION_TEMPLATES,
	seedSuperadminWorkflowPresets,
} from '../lib/server/superadmin-workflow-presets.js';
import {
	archiveSuperadminWorkflowTemplate,
	listSuperadminWorkflowTemplates,
	updateSuperadminWorkflowTemplate,
} from '../lib/db/superadmin-workflows.js';
import { listTemplateVersions } from '../lib/db/superadmin-workflow-versions.js';
import { FakeWorkflowDb } from './helpers/fake-workflow-db.js';

describe('superadmin workflow preset seeding', () => {
	it('seeds all presets as built-ins with version history', async () => {
		const db = new FakeWorkflowDb();
		const created = await seedSuperadminWorkflowPresets(db, 'system');

		expect(created).toHaveLength(OPERATION_TEMPLATES.length);

		const templates = await listSuperadminWorkflowTemplates(db, { includeArchived: true });
		expect(templates).toHaveLength(OPERATION_TEMPLATES.length);
		expect(templates.every((t) => t.is_builtin)).toBe(true);

		for (const template of templates) {
			const versions = await listTemplateVersions(db, template.id);
			expect(versions).toHaveLength(1);
			expect(versions[0].change_note).toBe('Seeded built-in preset');
		}
	});

	it('tops up only the missing presets', async () => {
		const db = new FakeWorkflowDb();
		await seedSuperadminWorkflowPresets(db, 'system');

		// Simulate one preset having been deleted from the DB.
		const removedSlug = OPERATION_TEMPLATES[2].slug;
		db.templates = db.templates.filter((t) => t.slug !== removedSlug);

		const created = await seedSuperadminWorkflowPresets(db, 'system');
		expect(created).toEqual([removedSlug]);

		// Re-running with everything present creates nothing.
		expect(await seedSuperadminWorkflowPresets(db, 'system')).toEqual([]);
	});

	it('respects a pre-fetched template list', async () => {
		const db = new FakeWorkflowDb();
		await seedSuperadminWorkflowPresets(db, 'system');
		const existing = await listSuperadminWorkflowTemplates(db, { includeArchived: true });

		const created = await seedSuperadminWorkflowPresets(db, 'system', { existing });
		expect(created).toEqual([]);
	});

	it('keeps built-ins editable but not archivable, and reset publishes a new version', async () => {
		const db = new FakeWorkflowDb();
		await seedSuperadminWorkflowPresets(db, 'system');
		const templates = await listSuperadminWorkflowTemplates(db, { includeArchived: true });
		const target = templates.find((t) => t.slug === 'workers-ai-catalog-sync');

		const archived = await archiveSuperadminWorkflowTemplate(db, target.id, 'admin-1');
		expect(archived.success).toBe(false);

		// Customize, then reset to the preset definition (as the endpoint does).
		const customized = await updateSuperadminWorkflowTemplate(
			db,
			target.id,
			'admin-1',
			{ cron_expression: '0 */12 * * *' },
			{ changeNote: 'Slow it down' }
		);
		expect(customized.template.published_version).toBe(2);

		const preset = OPERATION_TEMPLATES.find((p) => p.slug === target.slug);
		const reset = await updateSuperadminWorkflowTemplate(
			db,
			target.id,
			'admin-1',
			{
				name: preset.name,
				description: preset.description,
				category: preset.category,
				execution_backend: preset.execution_backend,
				legacy_job_name: preset.legacy_job_name,
				schedule_type: preset.schedule_type,
				cron_expression: preset.cron_expression,
				canvas_json: preset.canvas_json,
				config_json: null,
			},
			{ changeNote: 'Reset to built-in definition' }
		);
		expect(reset.template.published_version).toBe(3);
		expect(reset.template.cron_expression).toBe(preset.cron_expression);

		const versions = await listTemplateVersions(db, target.id);
		expect(versions.map((v) => v.version)).toEqual([3, 2, 1]);
	});
});
