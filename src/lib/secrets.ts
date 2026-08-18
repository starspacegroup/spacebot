/**
 * Secrets Manager
 *
 * Loads secrets from GCP Secret Manager in production, falls back to .env / process.env.
 * This module provides a unified way to access secrets regardless of environment.
 *
 * Usage:
 *   import { loadSecrets, getSecret } from './secrets.js';
 *   await loadSecrets(); // call once at startup
 *   const token = getSecret('DISCORD_BOT_TOKEN');
 *
 * GCP Secret Manager setup:
 *   1. Enable the Secret Manager API on your GCP project
 *   2. Ensure the VM's service account has `roles/secretmanager.secretAccessor`
 *   3. Create secrets: gcloud secrets create DISCORD_BOT_TOKEN --data-file=-
 *   4. Set GCP_PROJECT_ID env var (or it will be auto-detected on GCP)
 *
 * When running locally or if GCP is unavailable, falls back to process.env (dotenv).
 */

const GCP_METADATA_URL = 'http://metadata.google.internal/computeMetadata/v1';
const SECRET_MANAGER_API = 'https://secretmanager.googleapis.com/v1';

// In-memory secret cache
const _secrets = new Map();
let _loaded = false;

/**
 * Secrets whose absence silently degrades the bot rather than crashing it.
 *
 * A missing bot token fails loudly on its own — the gateway cannot connect. But
 * a missing `CLOUDFLARE_API_TOKEN` just turns the MCP client off, and the DM
 * assistant carries on as a chatbot with no tools and no explanation. That is
 * how a config gap became "Sure, here's the text you requested:" in a user's
 * DMs. These are checked and reported by name at startup.
 */
export const REQUIRED_SECRETS = [
	'DISCORD_BOT_TOKEN',
	'CLOUDFLARE_ACCOUNT_ID',
	'CLOUDFLARE_API_TOKEN',
];

/**
 * A value that is present but obviously not a real secret.
 *
 * This matters more than it looks: a placeholder is *worse* than a missing
 * value. Missing fails a truthiness check and can be reported; `your_api_token`
 * sails through every `if (token)` in the codebase and fails later at the API
 * boundary, where the error is about authentication rather than configuration.
 * `.env.example` is copied to `.env` as the first step of any setup, so these
 * end up in real environments routinely.
 */
export function isPlaceholderSecret(value) {
	const text = String(value ?? '').trim();
	if (!text) return true;
	return (
		/^(your[_-]|xxx+$|changeme|placeholder|todo|example|<.*>$)/i.test(text) ||
		/^(your_.*|.*_here)$/i.test(text)
	);
}

/**
 * List of secrets to load from GCP Secret Manager.
 * Only these will be fetched — everything else stays in process.env.
 */
const MANAGED_SECRETS = [
	'DISCORD_BOT_TOKEN',
	'DISCORD_CLIENT_SECRET',
	'DISCORD_PUBLIC_KEY',
	'DISCORD_CLIENT_ID',
	'ADMIN_USER_IDS',
	'CLOUDFLARE_ACCOUNT_ID',
	'CLOUDFLARE_AI_TOKEN',
	'CLOUDFLARE_AI_GATEWAY_ID',
	'CLOUDFLARE_API_TOKEN',
	'D1_DATABASE_ID',
	'STRIPE_SECRET_KEY',
	'STRIPE_WEBHOOK_SECRET',
	'STRIPE_PRO_MONTHLY_PRICE_ID',
	'STRIPE_PRO_YEARLY_PRICE_ID',
	'DEPLOY_WEBHOOK_SECRET',
	'GITHUB_TOKEN',
	'CRON_SECRET',
	'INTERNAL_API_KEY',
];

/**
 * Get an access token from the GCP metadata server (works on GCE/GKE).
 */
async function getGCPAccessToken() {
	const res = await fetch(`${GCP_METADATA_URL}/instance/service-accounts/default/token`, {
		headers: { 'Metadata-Flavor': 'Google' },
	});
	if (!res.ok) throw new Error(`Metadata token request failed: ${res.status}`);
	const data = await res.json();
	return data.access_token;
}

/**
 * Auto-detect the GCP project ID from the metadata server.
 */
async function getGCPProjectId() {
	if (process.env.GCP_PROJECT_ID) return process.env.GCP_PROJECT_ID;
	const res = await fetch(`${GCP_METADATA_URL}/project/project-id`, {
		headers: { 'Metadata-Flavor': 'Google' },
	});
	if (!res.ok) throw new Error(`Could not detect GCP project ID: ${res.status}`);
	return (await res.text()).trim();
}

/**
 * Fetch a single secret value from GCP Secret Manager.
 */
async function fetchSecret(projectId, accessToken, secretName) {
	const url = `${SECRET_MANAGER_API}/projects/${encodeURIComponent(projectId)}/secrets/${encodeURIComponent(secretName)}/versions/latest:access`;
	const res = await fetch(url, {
		headers: { Authorization: `Bearer ${accessToken}` },
	});
	if (!res.ok) {
		if (res.status === 404) return null; // Secret doesn't exist in GCP
		throw new Error(`Failed to fetch secret "${secretName}": ${res.status}`);
	}
	const data = await res.json();
	// Secret Manager returns base64-encoded payload
	return Buffer.from(data.payload.data, 'base64').toString('utf-8');
}

/**
 * Load all managed secrets from GCP Secret Manager.
 * Falls back to process.env if GCP is unavailable.
 */
export async function loadSecrets() {
	if (_loaded) return;

	let useGCP = false;

	try {
		// Try to detect if we're on GCP by hitting the metadata server
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 2000);
		await fetch(`${GCP_METADATA_URL}/`, {
			headers: { 'Metadata-Flavor': 'Google' },
			signal: controller.signal,
		});
		clearTimeout(timeout);
		useGCP = true;
	} catch {
		// Not on GCP or metadata server unavailable
	}

	if (useGCP) {
		console.log('🔐 Loading secrets from GCP Secret Manager...');
		try {
			const [projectId, accessToken] = await Promise.all([
				getGCPProjectId(),
				getGCPAccessToken(),
			]);

			// Fetch all secrets in parallel
			const results = await Promise.allSettled(
				MANAGED_SECRETS.map(async (name) => {
					const value = await fetchSecret(projectId, accessToken, name);
					return { name, value };
				})
			);

			let loaded = 0;
			let unavailable = 0;
			for (let i = 0; i < results.length; i++) {
				const result = results[i];
				const name = MANAGED_SECRETS[i];

				if (result.status === 'fulfilled' && result.value.value !== null) {
					_secrets.set(name, result.value.value);
					// Also put into process.env so existing code (dotenv, libraries) works
					process.env[name] = result.value.value;
					loaded++;
					continue;
				}

				// A rejection is NOT the same as "not stored here". 404 means the
				// secret genuinely isn't in Secret Manager and env is the right
				// fallback; anything else means we could not ask — the API is
				// disabled, the instance lacks the cloud-platform scope, or IAM says
				// no. That distinction used to be swallowed, so a project where
				// Secret Manager had never been enabled reported "✅ 0 secrets from
				// GCP" and looked like a working configuration.
				if (result.status === 'rejected') unavailable++;
			}

			if (unavailable === MANAGED_SECRETS.length) {
				console.warn(
					'  ⚠️  Secret Manager is unreachable for EVERY managed secret — it is not ' +
						'actually provisioned for this instance.\n' +
						'      Likely: the API is not enabled on the project, or the VM lacks the\n' +
						'      cloud-platform scope (which cannot be changed while it is running).\n' +
						'      Falling back entirely to environment variables.'
				);
			} else if (unavailable > 0) {
				console.warn(
					`  ⚠️  ${unavailable} secret(s) could not be read from Secret Manager.`
				);
			}
			console.log(`  ✅ ${loaded} secret(s) loaded from GCP Secret Manager`);
		} catch (err) {
			console.warn(`  ⚠️  GCP Secret Manager error: ${err.message}`);
			console.warn('  ↩️  Falling back to environment variables.');
		}
	} else {
		console.log('🔐 Using environment variables (not on GCP).');
	}

	_loaded = true;
	reportSecretHealth();
}

/**
 * Say plainly which required secrets resolved and which did not.
 *
 * Deliberately at startup and by name. The alternative — discovering it from a
 * user's confused DM three days later — is what this replaces. Values are never
 * printed, only whether each one is present.
 */
export function reportSecretHealth() {
	const missing = [];
	const placeholder = [];

	for (const name of REQUIRED_SECRETS) {
		const value = getSecret(name);
		if (value === undefined || value === null || String(value).trim() === '') {
			missing.push(name);
		} else if (isPlaceholderSecret(value)) {
			placeholder.push(name);
		}
	}

	if (!missing.length && !placeholder.length) return { ok: true, missing, placeholder };

	console.error('\n🔴 Required secrets are not configured:');
	for (const name of missing) console.error(`   • ${name} — missing`);
	for (const name of placeholder) {
		console.error(`   • ${name} — still set to a placeholder value`);
	}
	console.error(
		'\n   The bot will start, but anything depending on these is silently disabled.\n' +
			'   A missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN means the DM\n' +
			'   assistant has NO tools: it cannot create events, read logs or answer\n' +
			'   anything about a server. See docs/secrets.md\n'
	);

	return { ok: false, missing, placeholder };
}

/**
 * Get a secret value. Checks the GCP cache first, then process.env.
 */
export function getSecret(name) {
	return _secrets.get(name) ?? process.env[name];
}
