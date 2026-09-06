/**
 * API endpoint for managing cron jobs
 *
 * GET /api/cron - Get cron job history and definitions
 * POST /api/cron - Manually trigger a cron job
 *
 * Only accessible by superadmins.
 */

import { json } from '@sveltejs/kit';
import {
	runHourlyAggregation,
	runDailyRefresh,
	runCacheRefresh,
	runRebuildStats,
} from '$lib/server/cron-jobs.js';
import { processScheduledMessages } from '$lib/db/scheduled-messages.js';
import { reapManagedChannels } from '$lib/server/managed-channel-reaper.js';
import { sweepAllTimedOutRunnerJobs } from '$lib/db/local-runners.js';
import { syncWorkersAICatalog } from '$lib/server/workers-ai-models.js';
import { log } from '$lib/log.js';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';

const STALE_RUNNING_JOB_TIMEOUT_MINUTES = 30;

/**
 * Check if the request has a valid cron secret or internal API key
 */
function checkBearerAuth(request, platform) {
	const authHeader = request.headers.get('Authorization');
	if (!authHeader) return false;

	const cronSecret = platform?.env?.CRON_SECRET || process.env.CRON_SECRET;
	if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;

	const internalKey = platform?.env?.INTERNAL_API_KEY || process.env.INTERNAL_API_KEY;
	if (internalKey && authHeader === `Bearer ${internalKey}`) return true;

	return false;
}

/**
 * Get the list of available cron jobs
 */
function getCronJobDefinitions() {
	return [
		{
			name: 'hourly_aggregation',
			displayName: 'Hourly Stats Aggregation',
			description: 'Aggregates event logs into hourly and daily statistics',
			cronPattern: '0 * * * *',
			schedule: 'Every hour at :00',
		},
		{
			name: 'daily_refresh',
			displayName: 'Daily Discord Refresh',
			description:
				'Refreshes server stats, member cache, and role cache from Discord API. Also cleans up old data.',
			cronPattern: '0 0 * * *',
			schedule: 'Daily at midnight UTC',
		},
		{
			name: 'refresh_cache',
			displayName: 'Refresh Member/Role Cache',
			description:
				'Refreshes only the member and role cache for all guilds. Useful for getting latest user/role data.',
			cronPattern: null,
			schedule: 'Manual only',
		},
		{
			name: 'rebuild_stats',
			displayName: 'Rebuild All Stats',
			description:
				'Deletes all aggregated stats and rebuilds from event logs. Use after schema changes.',
			cronPattern: null,
			schedule: 'Manual only',
			dangerous: true,
		},
		{
			name: 'send_scheduled_messages',
			displayName: 'Send Scheduled Messages',
			description: 'Processes and sends messages that were scheduled for later delivery.',
			cronPattern: '* * * * *',
			schedule: 'Every minute',
		},
		{
			name: 'reap_managed_channels',
			displayName: 'Reap Member Rooms',
			description:
				'Deletes member-owned rooms that have expired or sat empty past their idle window.',
			cronPattern: '* * * * *',
			schedule: 'Every minute',
		},
		{
			name: 'sync_workers_ai_models',
			displayName: 'Sync Workers AI Models',
			description:
				'Refreshes the Workers AI model catalog from Cloudflare and stores it in the database cache.',
			cronPattern: '0 */6 * * *',
			schedule: 'Every 6 hours',
		},
	];
}

/**
 * Get cron job execution history from the database
 */
async function getCronJobHistory(db, limit = 50) {
	if (!db) return [];

	try {
		// First check if the table exists
		const tableCheck = await db
			.prepare(
				`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='cron_job_history'
    `
			)
			.first();

		if (!tableCheck) {
			return [];
		}

		const result = await db
			.prepare(
				`
      SELECT *
      FROM cron_job_history
      ORDER BY started_at DESC
      LIMIT ?
    `
			)
			.bind(limit)
			.all();

		return result.results || [];
	} catch (error) {
		log.error('[Cron API] Failed to get cron job history:', error);
		return [];
	}
}

async function markStaleRunningJobs(db) {
	if (!db) return;

	try {
		await db
			.prepare(
				`
      UPDATE cron_job_history
      SET status = 'failed',
          error_message = COALESCE(error_message, 'Job did not report completion before timeout'),
          completed_at = datetime('now'),
          duration_ms = CAST((julianday(datetime('now')) - julianday(started_at)) * 86400000 AS INTEGER)
      WHERE status = 'running'
        AND completed_at IS NULL
        AND started_at < datetime('now', ?)
    `
			)
			.bind(`-${STALE_RUNNING_JOB_TIMEOUT_MINUTES} minutes`)
			.run();
	} catch (error) {
		log.error('[Cron API] Failed to mark stale running jobs:', error);
	}
}

/**
 * Get the last run time for each job
 */
async function getLastRunTimes(db) {
	if (!db) return {};

	try {
		const tableCheck = await db
			.prepare(
				`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='cron_job_history'
    `
			)
			.first();

		if (!tableCheck) {
			return {};
		}

		const result = await db
			.prepare(
				`
      SELECT job_name, 
             MAX(started_at) as last_run,
             (SELECT status FROM cron_job_history c2 
              WHERE c2.job_name = cron_job_history.job_name 
              ORDER BY started_at DESC LIMIT 1) as last_status
      FROM cron_job_history
      GROUP BY job_name
    `
			)
			.all();

		const lastRuns = {};
		for (const row of result.results || []) {
			lastRuns[row.job_name] = {
				lastRun: row.last_run,
				lastStatus: row.last_status,
			};
		}

		return lastRuns;
	} catch (error) {
		log.error('[Cron API] Failed to get last run times:', error);
		return {};
	}
}

/**
 * Record a cron job execution start
 */
async function recordJobStart(db, jobName, triggeredBy, userId = null) {
	if (!db) return null;

	try {
		const startedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
		const result = await db
			.prepare(
				`
      INSERT INTO cron_job_history (job_name, cron_pattern, triggered_by, triggered_by_user_id, status, started_at)
      VALUES (?, ?, ?, ?, 'running', ?)
    `
			)
			.bind(
				jobName,
				getCronJobDefinitions().find((j) => j.name === jobName)?.cronPattern || null,
				triggeredBy,
				userId,
				startedAt
			)
			.run();

		if (result.meta?.last_row_id) {
			return result.meta.last_row_id;
		}

		const insertedRow = await db
			.prepare(
				`
      SELECT id
      FROM cron_job_history
      WHERE job_name = ?
        AND triggered_by = ?
        AND status = 'running'
        AND started_at = ?
        AND ((triggered_by_user_id IS NULL AND ? IS NULL) OR triggered_by_user_id = ?)
      ORDER BY id DESC
      LIMIT 1
    `
			)
			.bind(jobName, triggeredBy, startedAt, userId, userId)
			.first();

		return insertedRow?.id || null;
	} catch (error) {
		log.error('[Cron API] Failed to record job start:', error);
		return null;
	}
}

/**
 * Record a cron job completion
 */
async function recordJobComplete(
	db,
	jobId,
	success,
	resultData,
	errorMessage = null,
	durationMs = null
) {
	if (!db || !jobId) return;

	try {
		await db
			.prepare(
				`
      UPDATE cron_job_history
      SET status = ?,
          result_data = ?,
          error_message = ?,
          completed_at = datetime('now'),
          duration_ms = ?
      WHERE id = ?
    `
			)
			.bind(
				success ? 'success' : 'failed',
				JSON.stringify(resultData),
				errorMessage,
				durationMs,
				jobId
			)
			.run();
	} catch (error) {
		log.error('[Cron API] Failed to record job completion:', error);
	}
}

/**
 * GET /api/cron - Get cron job definitions and history
 */
export async function GET({ cookies, platform }) {
	const userId = cookies.get('discord_user_id');

	if (!checkIsSuperAdmin(userId, platform)) {
		return json({ error: 'Unauthorized' }, { status: 403 });
	}

	const db = (platform as any)?.env?.DB;

	await markStaleRunningJobs(db);

	const [history, lastRuns] = await Promise.all([
		getCronJobHistory(db, 100),
		getLastRunTimes(db),
	]);

	const definitions = getCronJobDefinitions().map((job) => ({
		...job,
		lastRun: lastRuns[job.name]?.lastRun || null,
		lastStatus: lastRuns[job.name]?.lastStatus || null,
	}));

	return json({
		jobs: definitions,
		history: history.map((h) => ({
			...h,
			result_data: h.result_data ? JSON.parse(h.result_data) : null,
		})),
	});
}

/**
 * POST /api/cron - Manually trigger a cron job
 */
export async function POST({ request, cookies, platform }) {
	// Accept either superadmin cookie auth or bearer token auth (for cron scheduler)
	const userId = cookies.get('discord_user_id');
	const isBearerAuth = checkBearerAuth(request, platform);

	if (!isBearerAuth && !checkIsSuperAdmin(userId, platform)) {
		return json({ error: 'Unauthorized' }, { status: 403 });
	}

	const body = await request.json();
	const { jobName } = body;

	if (!jobName) {
		return json({ error: 'Job name is required' }, { status: 400 });
	}

	const jobDef = getCronJobDefinitions().find((j) => j.name === jobName);
	if (!jobDef) {
		return json({ error: 'Unknown job name' }, { status: 400 });
	}

	const db = (platform as any)?.env?.DB;
	const botToken = (platform as any)?.env?.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;

	if (!db) {
		return json({ error: 'Database not available' }, { status: 503 });
	}

	// Proactively clean up any stale running jobs
	await markStaleRunningJobs(db);

	// Check if this job is already running (skip for send_scheduled_messages since it runs every minute)
	if (jobName !== 'send_scheduled_messages') {
		try {
			const alreadyRunning = await db
				.prepare(
					`
        SELECT id, started_at FROM cron_job_history
        WHERE job_name = ? AND status = 'running' AND completed_at IS NULL
        LIMIT 1
      `
				)
				.bind(jobName)
				.first();

			if (alreadyRunning) {
				return json(
					{
						error: `Job "${jobName}" is already running (started at ${alreadyRunning.started_at})`,
						alreadyRunning: true,
					},
					{ status: 409 }
				);
			}
		} catch (error) {
			log.warn('[Cron API] Failed to check for duplicate running jobs:', error);
		}
	}

	const startTime = Date.now();
	const triggeredBy = isBearerAuth ? 'cron_scheduler' : 'manual';
	const jobId = await recordJobStart(db, jobName, triggeredBy, isBearerAuth ? null : userId);

	// Rebuild can be very long-running. Queue it in the background when waitUntil is available
	// so the request returns immediately and the superadmin UI can keep polling status.
	if (jobName === 'rebuild_stats' && (platform as any)?.context?.waitUntil) {
		(platform as any).context.waitUntil(
			(async () => {
				let result;
				let jobError = null;

				try {
					result = await runRebuildStats(db);
				} catch (error) {
					jobError = error;
				}

				const duration = Date.now() - startTime;
				await recordJobComplete(
					db,
					jobId,
					!jobError,
					jobError ? null : result,
					jobError?.message || null,
					duration
				);

				if (jobError) {
					log.error(`[Cron API] Background job ${jobName} failed:`, jobError);
				} else {
					log.info(
						`[Cron API] Background job ${jobName} completed successfully in ${duration}ms`
					);
				}
			})()
		);

		return json({
			success: true,
			queued: true,
			jobId,
			message: 'Rebuild started in background. Refresh status to monitor progress.',
		});
	}

	let result;
	let jobError = null;

	try {
		if (jobName === 'hourly_aggregation') {
			result = await runHourlyAggregation(db);
			// Also sweep any runner jobs that timed out since the last poll cycle.
			const runnerSweep = await sweepAllTimedOutRunnerJobs(db);
			result = { ...result, runnerSweep };
		} else if (jobName === 'daily_refresh') {
			if (!botToken) {
				throw new Error('Bot token not configured');
			}
			// Also run aggregation first
			const aggregationResult = await runHourlyAggregation(db);
			const refreshResult = await runDailyRefresh(db, botToken);
			result = { aggregation: aggregationResult, refresh: refreshResult };
		} else if (jobName === 'refresh_cache') {
			if (!botToken) {
				throw new Error('Bot token not configured');
			}
			result = await runCacheRefresh(db, botToken);
		} else if (jobName === 'rebuild_stats') {
			result = await runRebuildStats(db);
		} else if (jobName === 'send_scheduled_messages') {
			if (!botToken) {
				throw new Error('Bot token not configured');
			}
			result = await processScheduledMessages(db, botToken);
		} else if (jobName === 'reap_managed_channels') {
			if (!botToken) {
				throw new Error('Bot token not configured');
			}
			result = await reapManagedChannels(db, botToken);
		} else if (jobName === 'sync_workers_ai_models') {
			const synced = await syncWorkersAICatalog(db, platform);
			result = {
				syncedAt: synced.syncedAt,
				modelCount: Array.isArray(synced.models) ? synced.models.length : 0,
			};
		}
	} catch (error) {
		jobError = error;
	}

	// Always record completion, even if the job failed
	const duration = Date.now() - startTime;
	const completionPromise = recordJobComplete(
		db,
		jobId,
		!jobError,
		jobError ? null : result,
		jobError?.message || null,
		duration
	);

	// Use waitUntil to ensure DB write survives even if the worker is shutting down
	if ((platform as any)?.context?.waitUntil) {
		(platform as any).context.waitUntil(completionPromise);
	} else {
		await completionPromise;
	}

	if (jobError) {
		log.error(`[Cron API] Manual job ${jobName} failed:`, jobError);

		return json(
			{
				success: false,
				error: jobError.message,
				duration,
			},
			{ status: 500 }
		);
	}

	log.info(`[Cron API] Manual job ${jobName} completed successfully in ${duration}ms`);

	return json({
		success: true,
		result,
		duration,
	});
}

/**
 * DELETE /api/cron - Force-cancel a stuck running job
 */
export async function DELETE({ request, cookies, platform }) {
	const userId = cookies.get('discord_user_id');

	if (!checkIsSuperAdmin(userId, platform)) {
		return json({ error: 'Unauthorized' }, { status: 403 });
	}

	const body = await request.json();
	const { jobId } = body;

	if (!jobId) {
		return json({ error: 'Job ID is required' }, { status: 400 });
	}

	const db = (platform as any)?.env?.DB;
	if (!db) {
		return json({ error: 'Database not available' }, { status: 503 });
	}

	try {
		const job = await db
			.prepare(
				`
      SELECT id, job_name, status FROM cron_job_history WHERE id = ?
    `
			)
			.bind(jobId)
			.first();

		if (!job) {
			return json({ error: 'Job not found' }, { status: 404 });
		}

		if (job.status !== 'running') {
			return json({ error: 'Job is not running' }, { status: 400 });
		}

		await db
			.prepare(
				`
      UPDATE cron_job_history
      SET status = 'failed',
          error_message = 'Manually cancelled by admin',
          completed_at = datetime('now'),
          duration_ms = CAST((julianday(datetime('now')) - julianday(started_at)) * 86400000 AS INTEGER)
      WHERE id = ?
    `
			)
			.bind(jobId)
			.run();

		log.info(
			`[Cron API] Job ${job.job_name} (ID: ${jobId}) manually cancelled by user ${userId}`
		);

		return json({ success: true });
	} catch (error) {
		log.error('[Cron API] Failed to cancel job:', error);
		return json({ error: error.message }, { status: 500 });
	}
}
