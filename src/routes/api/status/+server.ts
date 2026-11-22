/**
 * GET /api/status — the public status feed. Same data as the /status page: the four
 * components, 90 days of uptime, open incidents and the last 30 days of resolved ones.
 * No sign-in. Nothing in it is private: statuses, plain-language reasons and incident text.
 */
import { json } from '@sveltejs/kit';
import { getStatusSnapshot } from '$lib/db/status.js';
import { log } from '$lib/log.js';

const headers = {
	'access-control-allow-origin': '*',
	'cache-control': 'public, max-age=30',
};

export async function GET({ platform }) {
	const db = (platform as any)?.env?.DB;
	if (!db) {
		return json(
			{ error: 'Status is not available right now.' },
			{ status: 503, headers: { ...headers, 'cache-control': 'no-store' } }
		);
	}
	try {
		const snap = await getStatusSnapshot(db);
		return json(
			{
				...snap,
				components: snap.components.map(({ latencyMs: _latency, ...c }) => c),
			},
			{ headers }
		);
	} catch (error: any) {
		log.error(`[Status] Could not read the snapshot: ${error?.message}`);
		return json(
			{ error: 'Status is not available right now.' },
			{ status: 503, headers: { ...headers, 'cache-control': 'no-store' } }
		);
	}
}
