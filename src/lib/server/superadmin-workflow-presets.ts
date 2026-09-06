/**
 * Built-in superadmin workflow presets.
 *
 * These mirror the legacy gateway cron jobs one-to-one so the workflow system
 * can fully replace scripts/cron.js hardcoded schedules, plus examples for
 * newer capabilities (local runner steps).
 *
 * The dispatcher auto-seeds the cron presets on first run when the database
 * has no templates, guaranteeing scheduling continuity during the migration.
 */

import {
	createSuperadminWorkflowTemplate,
	listSuperadminWorkflowTemplates,
} from '$lib/db/superadmin-workflows.js';
import { log } from '$lib/log.js';

export const OPERATION_TEMPLATES = [
	{
		name: 'Hourly Server Activity Rollup',
		slug: 'hourly-server-activity-rollup',
		description:
			'Runs the current hourly gateway operations path for event-to-stats aggregation and queue hygiene.',
		category: 'operations',
		execution_backend: 'cloudflare_workflows',
		legacy_job_name: 'hourly_aggregation',
		schedule_type: 'cron',
		cron_expression: '0 * * * *',
		canvas_json: {
			nodes: [
				{
					id: 'start',
					type: 'trigger',
					title: 'Hourly Trigger',
					position: { x: 0, y: 0 },
					data: { schedule: '0 * * * *', source: 'gateway-cron' },
				},
				{
					id: 'discover',
					type: 'task',
					title: 'Discover Active Guilds',
					position: { x: 0, y: 140 },
					data: { operation: 'getGuildsWithLogs', queue_key: 'ops.stats.discovery' },
				},
				{
					id: 'aggregate',
					type: 'task',
					title: 'Aggregate Hourly + Daily Stats',
					position: { x: 0, y: 280 },
					data: { operation: 'runStatsAggregation', queue_key: 'ops.stats.aggregate' },
				},
				{
					id: 'runnerSweep',
					type: 'task',
					title: 'Sweep Timed-Out Runner Jobs',
					position: { x: 0, y: 420 },
					data: {
						operation: 'sweepAllTimedOutRunnerJobs',
						queue_key: 'ops.runners.sweep',
					},
				},
			],
			edges: [
				{ id: 'e1', source: 'start', target: 'discover', label: 'start' },
				{ id: 'e2', source: 'discover', target: 'aggregate', label: 'guilds_found' },
				{ id: 'e3', source: 'aggregate', target: 'runnerSweep', label: 'success' },
			],
		},
	},
	{
		name: 'Daily Server Intelligence Refresh',
		slug: 'daily-server-intelligence-refresh',
		description:
			'Runs the current daily gateway operations sequence: refresh stats/metadata/cache, prune stale data, and close orphaned sessions.',
		category: 'operations',
		execution_backend: 'cloudflare_workflows',
		legacy_job_name: 'daily_refresh',
		schedule_type: 'cron',
		cron_expression: '0 0 * * *',
		canvas_json: {
			nodes: [
				{
					id: 'start',
					type: 'trigger',
					title: 'Daily Trigger',
					position: { x: 0, y: 0 },
					data: { schedule: '0 0 * * *', source: 'gateway-cron' },
				},
				{
					id: 'aggregate',
					type: 'task',
					title: 'Run Aggregation First',
					position: { x: 0, y: 140 },
					data: { operation: 'runHourlyAggregation', queue_key: 'ops.stats.aggregate' },
				},
				{
					id: 'fetch',
					type: 'task',
					title: 'Fetch Guild Data from Discord',
					position: { x: 0, y: 280 },
					data: {
						operation: 'fetchGuildStatsFromDiscord',
						queue_key: 'ops.discord.fetch',
					},
				},
				{
					id: 'cache',
					type: 'task',
					title: 'Refresh Member + Role Cache',
					position: { x: 0, y: 420 },
					data: { operation: 'refreshGuildCache', queue_key: 'ops.discord.cache' },
				},
				{
					id: 'cleanup',
					type: 'task',
					title: 'Prune + Cleanup Old Operational Data',
					position: { x: 0, y: 560 },
					data: { operation: 'cleanupOldData', queue_key: 'ops.maintenance.cleanup' },
				},
			],
			edges: [
				{ id: 'e1', source: 'start', target: 'aggregate', label: 'start' },
				{ id: 'e2', source: 'aggregate', target: 'fetch', label: 'success' },
				{ id: 'e3', source: 'fetch', target: 'cache', label: 'success' },
				{ id: 'e4', source: 'cache', target: 'cleanup', label: 'success' },
			],
		},
	},
	{
		name: 'Minute Scheduled Message Dispatch',
		slug: 'minute-scheduled-message-dispatch',
		description:
			'Dispatches due scheduled messages every minute with a queue-friendly claim-and-deliver flow.',
		category: 'operations',
		execution_backend: 'cloudflare_workflows',
		legacy_job_name: 'send_scheduled_messages',
		schedule_type: 'cron',
		cron_expression: '* * * * *',
		canvas_json: {
			nodes: [
				{
					id: 'start',
					type: 'trigger',
					title: 'Minute Trigger',
					position: { x: 0, y: 0 },
					data: { schedule: '* * * * *', source: 'gateway-cron' },
				},
				{
					id: 'claim',
					type: 'task',
					title: 'Claim Due Messages',
					position: { x: 0, y: 140 },
					data: {
						operation: 'claimScheduledMessages',
						queue_key: 'ops.messages.claim',
						batch_size: 100,
					},
				},
				{
					id: 'deliver',
					type: 'task',
					title: 'Deliver Messages',
					position: { x: 0, y: 280 },
					data: {
						operation: 'processScheduledMessages',
						queue_key: 'ops.messages.deliver',
					},
				},
			],
			edges: [
				{ id: 'e1', source: 'start', target: 'claim', label: 'start' },
				{ id: 'e2', source: 'claim', target: 'deliver', label: 'messages_found' },
			],
		},
	},
	{
		name: 'Minute Member Room Reap',
		slug: 'minute-member-room-reap',
		description:
			'Closes member-owned rooms that hit their deadline or sat empty past their idle window.',
		category: 'operations',
		execution_backend: 'cloudflare_workflows',
		legacy_job_name: 'reap_managed_channels',
		schedule_type: 'cron',
		cron_expression: '* * * * *',
		canvas_json: {
			nodes: [
				{
					id: 'start',
					type: 'trigger',
					title: 'Minute Trigger',
					position: { x: 0, y: 0 },
					data: { schedule: '* * * * *', source: 'gateway-cron' },
				},
				{
					id: 'scan',
					type: 'task',
					title: 'Scan Open Rooms',
					position: { x: 0, y: 140 },
					data: {
						operation: 'listRoomsForReaping',
						queue_key: 'ops.rooms.scan',
						notes: 'No open rooms means no further work this tick.',
					},
				},
				{
					id: 'reap',
					type: 'task',
					title: 'Delete Expired Rooms',
					position: { x: 0, y: 280 },
					data: {
						operation: 'reapManagedChannels',
						queue_key: 'ops.rooms.reap',
					},
				},
			],
			edges: [
				{ id: 'e1', source: 'start', target: 'scan', label: 'start' },
				{ id: 'e2', source: 'scan', target: 'reap', label: 'rooms_found' },
			],
		},
	},
	{
		name: 'Workers AI Catalog Sync',
		slug: 'workers-ai-catalog-sync',
		description:
			'Keeps the cached Workers AI model catalog fresh in the database for superadmin model selection.',
		category: 'operations',
		execution_backend: 'cloudflare_workflows',
		legacy_job_name: 'sync_workers_ai_models',
		schedule_type: 'cron',
		cron_expression: '0 */6 * * *',
		canvas_json: {
			nodes: [
				{
					id: 'start',
					type: 'trigger',
					title: '6-Hour Trigger',
					position: { x: 0, y: 0 },
					data: { schedule: '0 */6 * * *', source: 'gateway-cron' },
				},
				{
					id: 'sync',
					type: 'task',
					title: 'Sync Workers AI Catalog',
					position: { x: 0, y: 140 },
					data: { operation: 'syncWorkersAICatalog', queue_key: 'ops.ai.catalog' },
				},
			],
			edges: [{ id: 'e1', source: 'start', target: 'sync', label: 'start' }],
		},
	},
	{
		name: 'Rebuild Stats Recovery Run',
		slug: 'rebuild-stats-recovery-run',
		description: 'Manual recovery path for rebuilding all aggregates from source event logs.',
		category: 'recovery',
		execution_backend: 'cloudflare_workflows',
		legacy_job_name: 'rebuild_stats',
		schedule_type: 'manual',
		cron_expression: null,
		canvas_json: {
			nodes: [
				{
					id: 'review',
					type: 'approval',
					title: 'Dangerous Action Review',
					position: { x: 0, y: 0 },
					data: { requiresConfirmation: true },
				},
				{
					id: 'wipe',
					type: 'task',
					title: 'Wipe Existing Aggregates',
					position: { x: 0, y: 140 },
					data: {
						operation: 'deleteAggregatedStats',
						destructive: true,
						queue_key: 'ops.recovery.prepare',
					},
				},
				{
					id: 'rebuild',
					type: 'task',
					title: 'Rebuild Historical Stats',
					position: { x: 0, y: 280 },
					data: {
						operation: 'runRebuildStats',
						legacyJob: 'rebuild_stats',
						queue_key: 'ops.recovery.rebuild',
					},
				},
				{
					id: 'verify',
					type: 'task',
					title: 'Verify Rebuild Totals',
					position: { x: 0, y: 420 },
					data: {
						operation: 'verifyAggregateIntegrity',
						queue_key: 'ops.recovery.verify',
					},
				},
			],
			edges: [
				{ id: 'e1', source: 'review', target: 'wipe', label: 'approved' },
				{ id: 'e2', source: 'wipe', target: 'rebuild', label: 'prepared' },
				{ id: 'e3', source: 'rebuild', target: 'verify', label: 'success' },
			],
		},
	},
	{
		name: 'Manual Member and Role Cache Refresh',
		slug: 'manual-member-role-cache-refresh',
		description:
			'Manual operations template to refresh member and role caches without running full daily refresh.',
		category: 'operations',
		execution_backend: 'cloudflare_workflows',
		legacy_job_name: 'refresh_cache',
		schedule_type: 'manual',
		cron_expression: null,
		canvas_json: {
			nodes: [
				{
					id: 'start',
					type: 'trigger',
					title: 'Manual Trigger',
					position: { x: 0, y: 0 },
					data: { source: 'operator' },
				},
				{
					id: 'guilds',
					type: 'task',
					title: 'Fetch Bot Guilds',
					position: { x: 0, y: 140 },
					data: { operation: 'getBotGuilds', queue_key: 'ops.discord.guilds' },
				},
				{
					id: 'refresh',
					type: 'task',
					title: 'Refresh Cache for Each Guild',
					position: { x: 0, y: 280 },
					data: { operation: 'refreshGuildCache', queue_key: 'ops.discord.cache' },
				},
			],
			edges: [
				{ id: 'e1', source: 'start', target: 'guilds', label: 'start' },
				{ id: 'e2', source: 'guilds', target: 'refresh', label: 'guilds_found' },
			],
		},
	},
	{
		name: 'Local Runner Health Check',
		slug: 'local-runner-health-check',
		description:
			'Example workflow that talks to a local runner: collects a system profile and runs a shell command, waiting for results. Set runner_token_id on both task nodes before enabling.',
		category: 'runners',
		execution_backend: 'cloudflare_workflows',
		legacy_job_name: null,
		schedule_type: 'manual',
		cron_expression: null,
		enabled: false,
		canvas_json: {
			nodes: [
				{
					id: 'start',
					type: 'trigger',
					title: 'Manual Trigger',
					position: { x: 0, y: 0 },
					data: { source: 'operator' },
				},
				{
					id: 'profile',
					type: 'task',
					title: 'Collect System Profile',
					position: { x: 0, y: 140 },
					data: {
						operation: 'local_runner_job',
						runner_token_id: 0,
						job_type: 'system_profile',
						wait_for_result: true,
						wait_timeout_seconds: 60,
						queue_key: 'ops.runners.profile',
					},
				},
				{
					id: 'echo',
					type: 'task',
					title: 'Run Health Command',
					position: { x: 0, y: 280 },
					data: {
						operation: 'local_runner_job',
						runner_token_id: 0,
						job_type: 'shell_command',
						command: 'uptime && df -h / | tail -1',
						wait_for_result: true,
						wait_timeout_seconds: 60,
						queue_key: 'ops.runners.health',
					},
				},
			],
			edges: [
				{ id: 'e1', source: 'start', target: 'profile', label: 'start' },
				{ id: 'e2', source: 'profile', target: 'echo', label: 'success' },
			],
		},
	},
];

/**
 * Create any presets that don't already exist (matched by slug). Returns the
 * list of created slugs. The dispatcher tops these up on every tick so the
 * built-ins always exist; also used by the UI's "install presets" path.
 * Pass `existing` to reuse an already-fetched template list.
 */
export async function seedSuperadminWorkflowPresets(
	db,
	userId = 'system',
	{ existing = null }: { existing?: Array<{ slug: string }> | null } = {}
) {
	const templates =
		existing ||
		(await listSuperadminWorkflowTemplates(db, { includeArchived: true, limit: 200 }));
	const existingSlugs = new Set(templates.map((t) => t.slug));
	const created = [];

	for (const preset of OPERATION_TEMPLATES) {
		if (existingSlugs.has(preset.slug)) continue;
		const result = await createSuperadminWorkflowTemplate(db, userId, {
			...preset,
			is_builtin: true,
			change_note: 'Seeded built-in preset',
		});
		if (result.success) {
			created.push(preset.slug);
		} else {
			log.warn(`[Workflows] Failed to seed preset ${preset.slug}: ${result.error}`);
		}
	}

	if (created.length > 0) {
		log.info(`[Workflows] Seeded ${created.length} workflow preset(s): ${created.join(', ')}`);
	}
	return created;
}
