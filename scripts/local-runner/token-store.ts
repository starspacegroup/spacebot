import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getAutostartPaths } from './service-manager';

/**
 * Persistent store for runner tokens negotiated via the browser flow, so a
 * token minted once (e.g. after the old one was revoked) survives restarts
 * without the user having to update .env or shell profiles by hand.
 */
export interface PersistedRunnerToken {
	token: string;
	negotiatedAt: string;
	/**
	 * The env-provided token this negotiated token superseded (e.g. a revoked
	 * one still sitting in .env). While that exact token keeps appearing in the
	 * environment, the negotiated token wins; a *different* env token is a
	 * deliberate user change and takes precedence again.
	 */
	replacedToken?: string;
}

export interface TokenStoreOptions {
	platform?: NodeJS.Platform;
	homeDir?: string;
	env?: NodeJS.ProcessEnv;
}

export function getRunnerTokenFile(options: TokenStoreOptions = {}): string {
	return join(getAutostartPaths(options).configDir, 'runner-token.json');
}

export function readPersistedRunnerToken(
	options: TokenStoreOptions = {}
): PersistedRunnerToken | null {
	try {
		const file = getRunnerTokenFile(options);
		if (!existsSync(file)) return null;
		const parsed = JSON.parse(readFileSync(file, 'utf8'));
		if (typeof parsed?.token !== 'string' || !parsed.token.startsWith('sbr_')) return null;
		return {
			token: parsed.token,
			negotiatedAt:
				typeof parsed.negotiatedAt === 'string'
					? parsed.negotiatedAt
					: new Date(0).toISOString(),
			replacedToken:
				typeof parsed.replacedToken === 'string' && parsed.replacedToken.length > 0
					? parsed.replacedToken
					: undefined,
		};
	} catch {
		return null;
	}
}

export function writePersistedRunnerToken(
	token: string,
	options: TokenStoreOptions = {}
): { ok: boolean; error?: string } {
	try {
		const paths = getAutostartPaths(options);
		mkdirSync(paths.configDir, { recursive: true });
		const env = options.env ?? process.env;
		const envToken = (env.SPACEBOT_RUNNER_TOKEN ?? '').trim();
		const previous = readPersistedRunnerToken(options);
		// Keep pointing at the env token being superseded across repeated
		// negotiations, so a stale .env entry never wins again.
		const replacedToken = envToken && envToken !== token ? envToken : previous?.replacedToken;
		const record: PersistedRunnerToken = {
			token,
			negotiatedAt: new Date().toISOString(),
			...(replacedToken ? { replacedToken } : {}),
		};
		writeFileSync(getRunnerTokenFile(options), JSON.stringify(record, null, 2) + '\n', {
			mode: 0o600,
		});
		return { ok: true };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

/**
 * Resolve the token the runner should use.
 * Precedence:
 *   1. SPACEBOT_RUNNER_TOKEN env var — unless it is exactly the token a later
 *      browser negotiation replaced (then the negotiated token wins).
 *   2. Persisted negotiated token.
 *   3. None.
 */
export function resolveRunnerToken(options: TokenStoreOptions = {}): {
	token: string;
	source: 'env' | 'negotiated' | 'none';
} {
	const env = options.env ?? process.env;
	const envToken = (env.SPACEBOT_RUNNER_TOKEN ?? '').trim();
	const persisted = readPersistedRunnerToken(options);

	if (envToken.startsWith('sbr_')) {
		if (persisted && persisted.replacedToken === envToken) {
			return { token: persisted.token, source: 'negotiated' };
		}
		return { token: envToken, source: 'env' };
	}

	if (persisted) return { token: persisted.token, source: 'negotiated' };
	return { token: '', source: 'none' };
}
