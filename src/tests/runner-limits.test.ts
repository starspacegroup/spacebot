import { describe, expect, it } from 'vitest';
import { createSqliteD1 } from './helpers/sqlite-d1.js';
import {
	MAX_ARTIFACTS_PER_RESULT,
	MAX_ARTIFACT_BASE64_CHARS,
	MAX_EVENT_DETAILS_CHARS,
	MAX_ARTIFACTS_PER_JOB,
	boundArtifactRefs,
	boundEventDetails,
	jobArtifactQuotaAllows,
	jobIsActiveForRunner,
} from '../lib/server/runner-limits.js';

const SCHEMA = `
CREATE TABLE local_runner_jobs (id INTEGER PRIMARY KEY, runner_token_id INTEGER, status TEXT, claimed_by_instance_id INTEGER);
CREATE TABLE local_runner_artifacts (id INTEGER PRIMARY KEY, job_id INTEGER, blob_base64 TEXT);
`;

describe('runner storage bounds', () => {
	it('drops oversized event details', () => {
		expect(boundEventDetails({ a: 1 })).toEqual({ a: 1 });
		const big = { blob: 'x'.repeat(MAX_EVENT_DETAILS_CHARS + 1) };
		expect(boundEventDetails(big)).toMatchObject({ dropped: 'too_large' });
	});

	it('caps artifact count, per-item size and metadata', () => {
		const many = Array.from({ length: 100 }, () => ({ blobBase64: 'AAAA' }));
		expect(boundArtifactRefs(many)).toHaveLength(MAX_ARTIFACTS_PER_RESULT);
		expect(
			boundArtifactRefs([{ blobBase64: 'A'.repeat(MAX_ARTIFACT_BASE64_CHARS + 1) }])
		).toHaveLength(0);
		expect(boundArtifactRefs([{ blobBase64: 'AA', junk: 'x'.repeat(10_000) }])).toHaveLength(0);
		expect(boundArtifactRefs('nope')).toEqual([]);
	});

	it('only a running job held by this runner accepts writes', async () => {
		const db = createSqliteD1(SCHEMA);
		db.exec(`INSERT INTO local_runner_jobs VALUES
			(1, 7, 'running', 3), (2, 7, 'completed', 3), (3, 7, 'pending', NULL), (4, 8, 'running', 3), (5, 7, 'running', 9)`);
		expect(await jobIsActiveForRunner(db, 7, 3, 1)).toBe(true);
		expect(await jobIsActiveForRunner(db, 7, 3, 2)).toBe(false);
		expect(await jobIsActiveForRunner(db, 7, 3, 3)).toBe(false);
		expect(await jobIsActiveForRunner(db, 7, 3, 4)).toBe(false);
		expect(await jobIsActiveForRunner(db, 7, 3, 5)).toBe(false);
	});

	it('enforces the per-job artifact quota', async () => {
		const db = createSqliteD1(SCHEMA);
		expect(await jobArtifactQuotaAllows(db, 1, 10)).toBe(true);
		for (let i = 0; i < MAX_ARTIFACTS_PER_JOB; i++) {
			db.exec(`INSERT INTO local_runner_artifacts (job_id, blob_base64) VALUES (1, 'AA')`);
		}
		expect(await jobArtifactQuotaAllows(db, 1, 10)).toBe(false);
	});
});
