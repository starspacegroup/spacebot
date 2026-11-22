/**
 * POST /api/status/record — one round of status checks, called once a minute by the
 * orchestrator worker (Bearer CRON_SECRET). The body carries what the outside probe saw
 * of the website: { website: { ok: boolean, ms: number | null, httpStatus?: number } }.
 */
import { json } from '@sveltejs/kit';
import { recordStatus } from '$lib/db/status.js';
import { log } from '$lib/log.js';
import { checkBearerAuth } from '$lib/server/superadmin-guard.js';

export async function POST({ request, platform }) {
	if (!checkBearerAuth(request, platform)) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	const db = (platform as any)?.env?.DB;
	if (!db) return json({ error: 'Database not available' }, { status: 503 });

	const body: any = await request.json().catch(() => null);
	const w = body?.website;
	const website =
		w && typeof w === 'object'
			? {
					ok: w.ok === true,
					ms:
						Number.isFinite(Number(w.ms)) && w.ms !== null
							? Math.round(Number(w.ms))
							: null,
					httpStatus: Number.isFinite(Number(w.httpStatus)) ? Number(w.httpStatus) : null,
				}
			: null;

	try {
		const result = await recordStatus(db, { website });
		return json({ ok: true, ...result });
	} catch (error: any) {
		log.error(`[Status] Could not record checks: ${error?.message}`);
		return json({ error: 'Could not record checks' }, { status: 500 });
	}
}
