import { getStatusSnapshot } from '$lib/db/status.js';
import { log } from '$lib/log.js';

/**
 * The public status page. No sign-in. If the snapshot cannot be read, the page says so
 * rather than show a green all-clear.
 */
export async function load({ platform }) {
	const db = (platform as any)?.env?.DB;
	if (!db) return { snapshot: null };
	try {
		return { snapshot: await getStatusSnapshot(db) };
	} catch (error: any) {
		log.error(`[Status] Could not load the status page: ${error?.message}`);
		return { snapshot: null };
	}
}
