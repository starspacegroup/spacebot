/**
 * In-memory D1 stand-in for the superadmin workflow tables, matched to the
 * exact SQL used by src/lib/db/superadmin-workflows.ts,
 * superadmin-workflow-versions.ts, and the dispatch endpoint's watchdog.
 */

class FakeStatement {
	db: FakeWorkflowDb;
	sql: string;
	args: any[];

	constructor(db: FakeWorkflowDb, sql: string) {
		this.db = db;
		this.sql = sql;
		this.args = [];
	}

	bind(...args: any[]) {
		this.args = args;
		return this;
	}

	async first() {
		return this.db.execute(this.sql, this.args, 'first');
	}

	async all() {
		return { results: this.db.execute(this.sql, this.args, 'all') };
	}

	async run() {
		return this.db.execute(this.sql, this.args, 'run');
	}
}

export class FakeWorkflowDb {
	templates: any[] = [];
	runs: any[] = [];
	steps: any[] = [];
	versions: any[] = [];
	nextTemplateId = 1;
	nextRunId = 1;
	nextStepId = 1;
	nextVersionId = 1;

	prepare(sql: string) {
		return new FakeStatement(this, sql.replace(/\s+/g, ' ').trim());
	}

	execute(sql: string, args: any[], mode: string) {
		// --- templates ---
		if (sql.startsWith('INSERT INTO superadmin_workflow_templates')) {
			if (this.templates.some((t) => t.slug === args[1])) {
				throw new Error('UNIQUE constraint failed: superadmin_workflow_templates.slug');
			}
			const row = {
				id: this.nextTemplateId++,
				name: args[0],
				slug: args[1],
				description: args[2],
				category: args[3],
				enabled: args[4],
				archived: 0,
				is_builtin: args[5],
				execution_backend: args[6],
				legacy_job_name: args[7],
				schedule_type: args[8],
				cron_expression: args[9],
				canvas_json: args[10],
				config_json: args[11],
				published_version: 1,
				created_by_user_id: args[12],
				updated_by_user_id: args[13],
				created_at: args[14],
				updated_at: args[15],
			};
			this.templates.push(row);
			return { success: true, meta: { last_row_id: row.id } };
		}
		if (sql.startsWith('UPDATE superadmin_workflow_templates SET name')) {
			const id = Number(args[15]);
			const row = this.templates.find((t) => t.id === id);
			if (!row) return { success: true };
			const dupe = this.templates.find((t) => t.slug === args[1] && t.id !== id);
			if (dupe)
				throw new Error('UNIQUE constraint failed: superadmin_workflow_templates.slug');
			Object.assign(row, {
				name: args[0],
				slug: args[1],
				description: args[2],
				category: args[3],
				enabled: args[4],
				archived: args[5],
				execution_backend: args[6],
				legacy_job_name: args[7],
				schedule_type: args[8],
				cron_expression: args[9],
				canvas_json: args[10],
				config_json: args[11],
				published_version: args[12],
				updated_by_user_id: args[13],
				updated_at: args[14],
			});
			return { success: true };
		}
		if (sql.includes('FROM superadmin_workflow_templates WHERE id = ?')) {
			return this.templates.find((t) => t.id === Number(args[0])) || null;
		}
		if (sql.includes('FROM superadmin_workflow_templates WHERE slug = ?')) {
			const matches = this.templates.filter((t) => t.slug === args[0]);
			return matches.length ? matches[matches.length - 1] : null;
		}
		if (sql.includes('FROM superadmin_workflow_templates ORDER BY archived ASC')) {
			return this.templates.slice(0, Number(args[0]) || 200);
		}
		if (sql.includes('FROM superadmin_workflow_templates WHERE archived = 0')) {
			return this.templates.filter((t) => !t.archived).slice(0, Number(args[0]) || 200);
		}

		// --- runs ---
		if (sql.startsWith('INSERT INTO superadmin_workflow_runs')) {
			const row = {
				id: this.nextRunId++,
				template_id: args[0],
				template_version: args[1],
				status: args[2],
				trigger_source: args[3],
				requested_by_user_id: args[4],
				workflow_instance_id: args[5],
				legacy_history_id: args[6],
				input_json: args[7],
				state_json: args[8],
				result_json: null,
				error_message: null,
				started_at: null,
				completed_at: null,
				duration_ms: null,
				created_at: args[9],
				updated_at: args[10],
			};
			this.runs.push(row);
			return { success: true, meta: { last_row_id: row.id } };
		}
		if (sql.startsWith('UPDATE superadmin_workflow_runs SET status')) {
			const row = this.runs.find((r) => r.id === Number(args[13]));
			if (!row) return { success: true };
			Object.assign(row, {
				status: args[0],
				trigger_source: args[1],
				requested_by_user_id: args[2],
				workflow_instance_id: args[3],
				legacy_history_id: args[4],
				input_json: args[5],
				state_json: args[6],
				result_json: args[7],
				error_message: args[8],
				started_at: args[9],
				completed_at: args[10],
				duration_ms: args[11],
				updated_at: args[12],
			});
			return { success: true };
		}
		if (sql.includes('FROM superadmin_workflow_runs WHERE id = ?')) {
			return this.runs.find((r) => r.id === Number(args[0])) || null;
		}
		if (sql.includes("trigger_source = 'cron' AND created_at >= ?")) {
			return (
				this.runs.find(
					(r) =>
						r.template_id === Number(args[0]) &&
						r.trigger_source === 'cron' &&
						String(r.created_at) >= String(args[1])
				) || null
			);
		}
		if (sql.includes("WHERE status = 'queued' AND created_at <= ?")) {
			return this.runs
				.filter((r) => r.status === 'queued' && String(r.created_at) <= String(args[0]))
				.slice(0, 20)
				.map((r) => ({ id: r.id }));
		}
		if (
			sql.includes(
				"status IN ('sleeping', 'waiting_approval', 'running') AND updated_at <= ?"
			)
		) {
			return this.runs
				.filter(
					(r) =>
						['sleeping', 'waiting_approval', 'running'].includes(r.status) &&
						String(r.updated_at) <= String(args[0])
				)
				.slice(0, 20)
				.map((r) => ({
					id: r.id,
					status: r.status,
					state_json: r.state_json,
					updated_at: r.updated_at,
				}));
		}
		if (sql.includes('FROM superadmin_workflow_runs WHERE template_id = ?')) {
			return this.runs
				.filter((r) => r.template_id === Number(args[0]))
				.slice(0, Number(args[1]) || 50);
		}
		if (sql.includes('FROM superadmin_workflow_runs ORDER BY created_at DESC')) {
			return this.runs.slice(0, Number(args[0]) || 50);
		}

		// --- run steps ---
		if (sql.startsWith('INSERT INTO superadmin_workflow_run_steps')) {
			const row = {
				id: this.nextStepId++,
				run_id: args[0],
				step_key: args[1],
				step_type: args[2],
				title: args[3],
				position: args[4],
				status: 'pending',
				input_json: args[5],
				output_json: null,
				error_message: null,
				started_at: null,
				completed_at: null,
				duration_ms: null,
				created_at: args[6],
				updated_at: args[7],
			};
			this.steps.push(row);
			return { success: true, meta: { last_row_id: row.id } };
		}
		if (sql.startsWith('UPDATE superadmin_workflow_run_steps SET status')) {
			const row = this.steps.find(
				(s) => s.run_id === Number(args[8]) && s.step_key === String(args[9])
			);
			if (!row) return { success: true };
			Object.assign(row, {
				status: args[0],
				input_json: args[1],
				output_json: args[2],
				error_message: args[3],
				started_at: args[4],
				completed_at: args[5],
				duration_ms: args[6],
				updated_at: args[7],
			});
			return { success: true };
		}
		if (sql.includes('FROM superadmin_workflow_run_steps WHERE run_id = ? AND step_key = ?')) {
			return (
				this.steps.find(
					(s) => s.run_id === Number(args[0]) && s.step_key === String(args[1])
				) || null
			);
		}
		if (sql.includes('FROM superadmin_workflow_run_steps WHERE run_id = ?')) {
			return this.steps
				.filter((s) => s.run_id === Number(args[0]))
				.sort((a, b) => a.position - b.position);
		}

		// --- template versions ---
		if (sql.startsWith('INSERT INTO superadmin_workflow_template_versions')) {
			if (
				this.versions.some(
					(v) => v.template_id === Number(args[0]) && v.version === Number(args[1])
				)
			) {
				throw new Error('UNIQUE constraint failed: superadmin_workflow_template_versions');
			}
			const row = {
				id: this.nextVersionId++,
				template_id: args[0],
				version: args[1],
				name: args[2],
				slug: args[3],
				description: args[4],
				category: args[5],
				execution_backend: args[6],
				legacy_job_name: args[7],
				schedule_type: args[8],
				cron_expression: args[9],
				canvas_json: args[10],
				config_json: args[11],
				change_note: args[12],
				created_by_user_id: args[13],
				created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
			};
			this.versions.push(row);
			return { success: true, meta: { last_row_id: row.id } };
		}
		if (
			sql.includes(
				'FROM superadmin_workflow_template_versions WHERE template_id = ? AND version = ?'
			)
		) {
			return (
				this.versions.find(
					(v) => v.template_id === Number(args[0]) && v.version === Number(args[1])
				) || null
			);
		}
		if (sql.includes('FROM superadmin_workflow_template_versions WHERE template_id = ?')) {
			return this.versions
				.filter((v) => v.template_id === Number(args[0]))
				.sort((a, b) => b.version - a.version)
				.slice(0, Number(args[1]) || 50);
		}

		throw new Error(`Unhandled SQL in FakeWorkflowDb (${mode}): ${sql}`);
	}
}
