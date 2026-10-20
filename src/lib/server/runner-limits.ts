/**
 * Storage bounds for what a runner can write (security review 2026-10-20, #8).
 *
 * A runner token could stream unbounded event details and artifact arrays into
 * D1, and inline artifacts were inserted before anyone checked that the job
 * was running and claimed by that runner. Shared by both runner WebSocket
 * implementations and the HTTP artifact upload.
 */

export const MAX_ARTIFACTS_PER_RESULT = 20;
export const MAX_ARTIFACT_BASE64_CHARS = 8_000_000;
export const MAX_RESULT_ARTIFACT_BASE64_CHARS = 16_000_000;
export const MAX_ARTIFACT_METADATA_CHARS = 4_000;
export const MAX_EVENT_DETAILS_CHARS = 8_000;
export const MAX_ARTIFACTS_PER_JOB = 50;
export const MAX_JOB_ARTIFACT_BASE64_CHARS = 32_000_000;

export function boundEventDetails(details: unknown): unknown {
	if (details === undefined || details === null) return null;
	let text: string;
	try {
		text = JSON.stringify(details);
	} catch {
		return { dropped: 'unserializable' };
	}
	if (text.length > MAX_EVENT_DETAILS_CHARS) return { dropped: 'too_large', chars: text.length };
	return details;
}

/** Keep at most MAX_ARTIFACTS_PER_RESULT artifacts inside the per-item and per-result byte budgets. */
export function boundArtifactRefs(refs: unknown): any[] {
	if (!Array.isArray(refs)) return [];
	const kept: any[] = [];
	let total = 0;
	for (const ref of refs.slice(0, MAX_ARTIFACTS_PER_RESULT)) {
		if (!ref || typeof ref !== 'object') continue;
		const blobLength = typeof ref.blobBase64 === 'string' ? ref.blobBase64.length : 0;
		if (blobLength > MAX_ARTIFACT_BASE64_CHARS) continue;
		if (total + blobLength > MAX_RESULT_ARTIFACT_BASE64_CHARS) break;
		const { blobBase64: _blob, ...metadata } = ref as Record<string, unknown>;
		let metadataText = '';
		try {
			metadataText = JSON.stringify(metadata);
		} catch {
			continue;
		}
		if (metadataText.length > MAX_ARTIFACT_METADATA_CHARS) continue;
		total += blobLength;
		kept.push(ref);
	}
	return kept;
}

/** The job is running and claimed by this runner token (and instance, when claimed). */
export async function jobIsActiveForRunner(db, tokenId, instanceId, jobId): Promise<boolean> {
	const row = await db
		.prepare(
			`SELECT id FROM local_runner_jobs
       WHERE id = ?
         AND runner_token_id = ?
         AND status = 'running'
         AND (claimed_by_instance_id IS NULL OR claimed_by_instance_id = ?)`
		)
		.bind(jobId, tokenId, instanceId ?? null)
		.first();
	return Boolean(row);
}

/** Per-job artifact quota for the HTTP upload path. */
export async function jobArtifactQuotaAllows(
	db,
	jobId,
	incomingBase64Chars: number
): Promise<boolean> {
	const row = await db
		.prepare(
			`SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(blob_base64)), 0) AS chars
       FROM local_runner_artifacts WHERE job_id = ?`
		)
		.bind(jobId)
		.first();
	const count = Number(row?.n ?? 0);
	const chars = Number(row?.chars ?? 0);
	return (
		count < MAX_ARTIFACTS_PER_JOB &&
		chars + incomingBase64Chars <= MAX_JOB_ARTIFACT_BASE64_CHARS
	);
}
