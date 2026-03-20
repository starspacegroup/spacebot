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
			let fromEnv = 0;
			for (const result of results) {
				if (result.status === 'fulfilled' && result.value.value !== null) {
					_secrets.set(result.value.name, result.value.value);
					// Also put into process.env so existing code (dotenv, libraries) works
					process.env[result.value.name] = result.value.value;
					loaded++;
				} else {
					// Fall back to process.env for secrets not in GCP
					const envVal = process.env[result.value?.name || ''];
					if (envVal) fromEnv++;
				}
			}
			console.log(`  ✅ ${loaded} secrets from GCP, ${fromEnv} from environment`);
		} catch (err) {
			console.log(`  ⚠️  GCP Secret Manager error: ${err.message}`);
			console.log('  ↩️  Falling back to environment variables.');
		}
	} else {
		console.log('🔐 Using environment variables (not on GCP).');
	}

	_loaded = true;
}

/**
 * Get a secret value. Checks the GCP cache first, then process.env.
 */
export function getSecret(name) {
	return _secrets.get(name) ?? process.env[name];
}
