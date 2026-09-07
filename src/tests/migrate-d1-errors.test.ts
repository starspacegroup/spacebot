/**
 * A production deploy failed on 0033_drop_welcome_messages.sql. The database
 * had already dropped those three columns, but the tracking table no longer
 * said so, so the runner re-ran the file. Its whole-file path knows that a
 * "no such column" from a DROP COLUMN means the work is done — but the
 * statement-by-statement fallback, which is where that run ended up, had no
 * such check and turned a finished migration into a failed build.
 *
 * That fallback only runs after a transient D1 error, which is why the gap sat
 * latent. It is the second deploy it has cost.
 */
import { describe, expect, it } from 'vitest';
import {
	isAlreadyAppliedError,
	isTransientD1Error,
	shouldFallbackToCommandExecution,
} from '../../scripts/lib/d1-errors';

describe('isAlreadyAppliedError', () => {
	it('recognises a re-run of every shape of migration', () => {
		// Verbatim from Wrangler 4.126.0, re-running the three statements of
		// 0033_drop_welcome_messages.sql against a database that has them gone.
		expect(
			isAlreadyAppliedError('✘ [ERROR] no such column: "welcome_enabled" at offset 91')
		).toBe(true);
		expect(isAlreadyAppliedError('✘ [ERROR] table guild_settings already exists')).toBe(true);
		expect(isAlreadyAppliedError('✘ [ERROR] duplicate column name: welcome_message')).toBe(
			true
		);
	});

	it('does not swallow a migration that is genuinely broken', () => {
		expect(isAlreadyAppliedError('✘ [ERROR] no such table: guild_settings')).toBe(false);
		expect(isAlreadyAppliedError('✘ [ERROR] near "ALTR": syntax error')).toBe(false);
		expect(isAlreadyAppliedError('')).toBe(false);
	});
});

describe('shouldFallbackToCommandExecution', () => {
	it('only retries a file import that died inside D1, not one the SQL failed', () => {
		expect(shouldFallbackToCommandExecution('D1_RESET_DO reset before execute completed')).toBe(
			true
		);
		expect(shouldFallbackToCommandExecution('✘ [ERROR] near "ALTR": syntax error')).toBe(false);
	});
});

describe('isTransientD1Error', () => {
	it('separates an unavailable API from a rejected statement', () => {
		expect(isTransientD1Error('Upstream service unavailable [code: 7009]')).toBe(true);
		expect(isTransientD1Error('ETIMEDOUT')).toBe(true);
		expect(isTransientD1Error('no such column: "welcome_enabled"')).toBe(false);
	});
});
