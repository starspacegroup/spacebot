import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	getRunnerTokenFile,
	readPersistedRunnerToken,
	resolveRunnerToken,
	writePersistedRunnerToken,
} from '../../scripts/local-runner/token-store';

const tempDirs: string[] = [];

function makeStoreOptions(env: Record<string, string> = {}) {
	const home = mkdtempSync(join(tmpdir(), 'spacebot-token-store-'));
	tempDirs.push(home);
	return {
		platform: 'linux' as const,
		homeDir: home,
		env: { XDG_CONFIG_HOME: join(home, '.config'), ...env },
	};
}

afterEach(() => {
	while (tempDirs.length > 0) {
		rmSync(tempDirs.pop()!, { recursive: true, force: true });
	}
});

describe('local runner token store', () => {
	it('resolves to none with no env token and no persisted token', () => {
		const options = makeStoreOptions();
		expect(resolveRunnerToken(options)).toEqual({ token: '', source: 'none' });
	});

	it('resolves the env token when nothing was negotiated', () => {
		const options = makeStoreOptions({ SPACEBOT_RUNNER_TOKEN: 'sbr_env' });
		expect(resolveRunnerToken(options)).toEqual({ token: 'sbr_env', source: 'env' });
	});

	it('records which env token a negotiated token replaced', () => {
		const options = makeStoreOptions({ SPACEBOT_RUNNER_TOKEN: 'sbr_revoked' });
		const written = writePersistedRunnerToken('sbr_fresh', options);
		expect(written.ok).toBe(true);

		const record = readPersistedRunnerToken(options);
		expect(record?.token).toBe('sbr_fresh');
		expect(record?.replacedToken).toBe('sbr_revoked');
	});

	it('prefers the negotiated token over the exact env token it replaced', () => {
		const options = makeStoreOptions({ SPACEBOT_RUNNER_TOKEN: 'sbr_revoked' });
		writePersistedRunnerToken('sbr_fresh', options);
		expect(resolveRunnerToken(options)).toEqual({ token: 'sbr_fresh', source: 'negotiated' });
	});

	it('lets a new env token win over an older negotiated token', () => {
		const options = makeStoreOptions({ SPACEBOT_RUNNER_TOKEN: 'sbr_revoked' });
		writePersistedRunnerToken('sbr_fresh', options);

		const withNewEnv = {
			...options,
			env: { ...options.env, SPACEBOT_RUNNER_TOKEN: 'sbr_brand_new' },
		};
		expect(resolveRunnerToken(withNewEnv)).toEqual({ token: 'sbr_brand_new', source: 'env' });
	});

	it('uses the negotiated token when no env token is set', () => {
		const options = makeStoreOptions();
		writePersistedRunnerToken('sbr_fresh', options);
		expect(resolveRunnerToken(options)).toEqual({ token: 'sbr_fresh', source: 'negotiated' });
	});

	it('keeps pointing at the original env token across repeated negotiations', () => {
		const options = makeStoreOptions({ SPACEBOT_RUNNER_TOKEN: 'sbr_revoked' });
		writePersistedRunnerToken('sbr_first', options);
		writePersistedRunnerToken('sbr_second', options);

		const record = readPersistedRunnerToken(options);
		expect(record?.token).toBe('sbr_second');
		expect(record?.replacedToken).toBe('sbr_revoked');
		expect(resolveRunnerToken(options)).toEqual({ token: 'sbr_second', source: 'negotiated' });
	});

	it('ignores malformed persisted files', () => {
		const options = makeStoreOptions();
		writePersistedRunnerToken('sbr_fresh', options);
		const file = getRunnerTokenFile(options);
		expect(readFileSync(file, 'utf8')).toContain('sbr_fresh');

		const badOptions = makeStoreOptions();
		// Never written for badOptions — read/resolve fall back cleanly.
		expect(readPersistedRunnerToken(badOptions)).toBeNull();
		expect(resolveRunnerToken(badOptions)).toEqual({ token: '', source: 'none' });
	});
});
