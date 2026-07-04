import { describe, expect, it } from 'vitest';
import {
	archiveSuperadminWorkflowTemplate,
	createSuperadminWorkflowTemplate,
	updateSuperadminWorkflowTemplate,
} from '../lib/db/superadmin-workflows.js';
import {
	definitionChanged,
	getTemplateVersion,
	listTemplateVersions,
} from '../lib/db/superadmin-workflow-versions.js';
import { FakeWorkflowDb } from './helpers/fake-workflow-db.js';

const CANVAS = {
	nodes: [
		{ id: 'start', type: 'trigger', title: 'Start', position: { x: 0, y: 0 }, data: {} },
		{
			id: 'work',
			type: 'task',
			title: 'Work',
			position: { x: 0, y: 140 },
			data: { operation: 'noop' },
		},
	],
	edges: [{ id: 'e1', source: 'start', target: 'work', label: 'start' }],
};

async function makeTemplate(db, overrides = {}) {
	const result = await createSuperadminWorkflowTemplate(db, 'admin-1', {
		name: 'Test Flow',
		canvas_json: CANVAS,
		schedule_type: 'manual',
		...overrides,
	});
	expect(result.success).toBe(true);
	return result.template;
}

describe('superadmin workflow versioning', () => {
	it('writes version 1 on create', async () => {
		const db = new FakeWorkflowDb();
		const template = await makeTemplate(db);

		expect(template.published_version).toBe(1);
		const versions = await listTemplateVersions(db, template.id);
		expect(versions).toHaveLength(1);
		expect(versions[0].version).toBe(1);
		expect(versions[0].change_note).toBe('Created');
		expect(versions[0].node_count).toBe(2);
	});

	it('bumps the version and snapshots on definition change', async () => {
		const db = new FakeWorkflowDb();
		const template = await makeTemplate(db);

		const updated = await updateSuperadminWorkflowTemplate(
			db,
			template.id,
			'admin-2',
			{ name: 'Renamed Flow' },
			{ changeNote: 'Renamed it' }
		);
		expect(updated.success).toBe(true);
		expect(updated.template.published_version).toBe(2);

		const versions = await listTemplateVersions(db, template.id);
		expect(versions.map((v) => v.version)).toEqual([2, 1]);
		expect(versions[0].name).toBe('Renamed Flow');
		expect(versions[0].change_note).toBe('Renamed it');
		expect(versions[0].created_by_user_id).toBe('admin-2');
	});

	it('does NOT bump the version for enable/disable toggles', async () => {
		const db = new FakeWorkflowDb();
		const template = await makeTemplate(db);

		const toggled = await updateSuperadminWorkflowTemplate(db, template.id, 'admin-1', {
			enabled: false,
		});
		expect(toggled.success).toBe(true);
		expect(toggled.template.published_version).toBe(1);
		expect(toggled.template.enabled).toBe(false);
		expect(await listTemplateVersions(db, template.id)).toHaveLength(1);
	});

	it('ignores client-supplied published_version', async () => {
		const db = new FakeWorkflowDb();
		const template = await makeTemplate(db);

		const updated = await updateSuperadminWorkflowTemplate(db, template.id, 'admin-1', {
			published_version: 99,
			description: 'new description',
		});
		expect(updated.template.published_version).toBe(2);
	});

	it('reverts by applying an old snapshot as a NEW version', async () => {
		const db = new FakeWorkflowDb();
		const template = await makeTemplate(db);

		await updateSuperadminWorkflowTemplate(db, template.id, 'admin-1', {
			name: 'Changed Name',
			cron_expression: '0 * * * *',
			schedule_type: 'cron',
		});

		const v1 = await getTemplateVersion(db, template.id, 1);
		expect(v1.name).toBe('Test Flow');

		const reverted = await updateSuperadminWorkflowTemplate(
			db,
			template.id,
			'admin-1',
			{
				name: v1.name,
				description: v1.description,
				category: v1.category,
				schedule_type: v1.schedule_type,
				cron_expression: v1.cron_expression,
				canvas_json: v1.canvas_json,
				config_json: v1.config_json,
			},
			{ changeNote: 'Revert to v1' }
		);

		expect(reverted.template.published_version).toBe(3);
		expect(reverted.template.name).toBe('Test Flow');
		expect(reverted.template.schedule_type).toBe('manual');

		const versions = await listTemplateVersions(db, template.id);
		expect(versions.map((v) => v.version)).toEqual([3, 2, 1]);
		expect(versions[0].change_note).toBe('Revert to v1');
	});

	it('blocks archiving and slug changes for built-ins', async () => {
		const db = new FakeWorkflowDb();
		const template = await makeTemplate(db, { is_builtin: true });
		expect(template.is_builtin).toBe(true);

		const archived = await archiveSuperadminWorkflowTemplate(db, template.id, 'admin-1');
		expect(archived.success).toBe(false);
		expect(archived.error).toContain('Built-in');

		const renamedSlug = await updateSuperadminWorkflowTemplate(db, template.id, 'admin-1', {
			slug: 'different-slug',
		});
		expect(renamedSlug.success).toBe(false);
		expect(renamedSlug.error).toContain('slug');

		// Disabling stays allowed.
		const disabled = await updateSuperadminWorkflowTemplate(db, template.id, 'admin-1', {
			enabled: false,
		});
		expect(disabled.success).toBe(true);
	});

	it('definitionChanged compares only versioned fields', () => {
		const a = {
			name: 'A',
			slug: 'a',
			description: null,
			category: 'operations',
			execution_backend: 'cloudflare_workflows',
			legacy_job_name: null,
			schedule_type: 'manual',
			cron_expression: null,
			canvas_json: CANVAS,
			config_json: null,
		};

		expect(definitionChanged(a, { ...a })).toBe(false);
		expect(definitionChanged(a, { ...a, enabled: false, archived: true })).toBe(false);
		expect(definitionChanged(a, { ...a, description: '' })).toBe(false);
		expect(definitionChanged(a, { ...a, name: 'B' })).toBe(true);
		expect(definitionChanged(a, { ...a, cron_expression: '0 * * * *' })).toBe(true);
		expect(definitionChanged(a, { ...a, canvas_json: { nodes: [], edges: [] } })).toBe(true);
		expect(definitionChanged(a, { ...a, config_json: { theme: 'x' } })).toBe(true);
	});
});
