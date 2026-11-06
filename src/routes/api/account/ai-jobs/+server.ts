import { json } from '@sveltejs/kit';
import { listAIJobsForUser } from '$lib/db/ai-orchestration.js';
import { intParam } from '$lib/server/query-params.js';

export async function GET({ cookies, platform, url }) {
	const userId = cookies.get('discord_user_id');
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const db = (platform as any)?.env?.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	const limit = intParam(url, 'limit', 50, 1, 200);
	const offset = intParam(url, 'offset', 0, 0);
	const status = url.searchParams.get('status') || null;

	const jobs = await listAIJobsForUser(db, userId, { limit, offset, status });

	return json({
		jobs: jobs.map((job) => ({
			id: job.id,
			correlation_id: job.correlation_id,
			source: job.source,
			status: job.status,
			request_text: job.request_text,
			max_attempts: job.max_attempts,
			attempt_count: job.attempt_count,
			next_retry_at: job.next_retry_at,
			last_error: job.last_error,
			created_at: job.created_at,
			started_at: job.started_at,
			completed_at: job.completed_at,
			updated_at: job.updated_at,
		})),
		pagination: {
			limit,
			offset,
			returned: jobs.length,
		},
	});
}
