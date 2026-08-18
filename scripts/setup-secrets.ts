#!/usr/bin/env node

/**
 * GCP Secret Manager Setup Script
 *
 * Reads your local .env file and pushes each secret to GCP Secret Manager.
 * Run this once (or after changing secrets) to sync .env -> GCP.
 *
 * Usage:
 *   bun scripts/setup-secrets.ts              # Dry run — shows what would be created
 *   bun scripts/setup-secrets.ts --confirm     # Actually create/update secrets
 *
 * Prerequisites:
 *   - gcloud CLI installed and authenticated
 *   - Secret Manager API enabled: gcloud services enable secretmanager.googleapis.com
 *   - GCP_PROJECT_ID set, or gcloud configured with a default project
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { isPlaceholderSecret } from '../src/lib/secrets.js';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const envPath = resolve(__dirname, '..', '.env');
const confirm = process.argv.includes('--confirm');

// Secrets to push (must match the MANAGED_SECRETS list in src/lib/secrets.js)
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

function parseEnvFile(filePath) {
	const content = readFileSync(filePath, 'utf-8');
	const vars = {};
	for (const line of content.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eqIdx = trimmed.indexOf('=');
		if (eqIdx === -1) continue;
		const key = trimmed.slice(0, eqIdx).trim();
		let value = trimmed.slice(eqIdx + 1).trim();
		// Remove surrounding quotes
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		vars[key] = value;
	}
	return vars;
}

function getProjectId() {
	if (process.env.GCP_PROJECT_ID) return process.env.GCP_PROJECT_ID;
	try {
		return execSync('gcloud config get-value project', { stdio: 'pipe' }).toString().trim();
	} catch {
		console.error(
			'❌ Could not determine GCP project. Set GCP_PROJECT_ID or run: gcloud config set project YOUR_PROJECT'
		);
		process.exit(1);
	}
}

function secretExists(name) {
	try {
		execSync(`gcloud secrets describe ${name} --format=json`, { stdio: 'pipe' });
		return true;
	} catch {
		return false;
	}
}

// --- Main ---
if (!existsSync(envPath)) {
	console.error(`❌ No .env file found at ${envPath}`);
	process.exit(1);
}

const projectId = getProjectId();
const envVars = parseEnvFile(envPath);

console.log(`\n🔐 GCP Secret Manager Setup`);
console.log(`   Project: ${projectId}`);
console.log(`   Source:  .env\n`);

const toCreate = [];
const toUpdate = [];
const skipped = [];

const placeholders = [];

for (const name of MANAGED_SECRETS) {
	const value = envVars[name];
	if (!value) {
		skipped.push(name);
		continue;
	}
	// Refuse to publish junk. `.env` starts life as a copy of `.env.example`, so
	// unfilled placeholders are the normal state of a dev machine — and pushing
	// one here would overwrite a WORKING production secret with `your_api_token`
	// and take the bot down on the next restart. Silently skipping would be
	// nearly as bad, because the run would report success.
	if (isPlaceholderSecret(value)) {
		placeholders.push(name);
		continue;
	}
	if (secretExists(name)) {
		toUpdate.push(name);
	} else {
		toCreate.push(name);
	}
}

if (skipped.length) {
	console.log(`⏭️  Skipped (not in .env): ${skipped.join(', ')}\n`);
}

if (placeholders.length) {
	console.error(`\n🔴 Refusing to run — these are still placeholders in .env:\n`);
	for (const name of placeholders) console.error(`   • ${name}`);
	console.error(
		`\n   Pushing them would replace real production values with dummy ones.\n` +
			`   Fill them in, or remove the lines entirely so they are skipped.\n` +
			`   To set a single secret without putting it in .env at all:\n\n` +
			`     printf %s "<value>" | gcloud secrets versions add NAME --data-file=-\n`
	);
	process.exit(1);
}

if (toCreate.length) {
	console.log(`🆕 To create: ${toCreate.join(', ')}`);
}
if (toUpdate.length) {
	console.log(`🔄 To update: ${toUpdate.join(', ')}`);
}

if (!toCreate.length && !toUpdate.length) {
	console.log('✅ Nothing to do.');
	process.exit(0);
}

if (!confirm) {
	console.log('\n⚠️  Dry run. Run with --confirm to apply.\n');
	process.exit(0);
}

console.log('\n');

for (const name of toCreate) {
	console.log(`  Creating ${name}...`);
	try {
		execSync(`gcloud secrets create ${name} --replication-policy=automatic`, { stdio: 'pipe' });
		execSync(
			`echo -n "${envVars[name].replace(/"/g, '\\"')}" | gcloud secrets versions add ${name} --data-file=-`,
			{
				stdio: 'pipe',
				shell: true,
			}
		);
		console.log(`  ✅ ${name} created`);
	} catch (err) {
		console.error(`  ❌ Failed to create ${name}: ${err.message}`);
	}
}

for (const name of toUpdate) {
	console.log(`  Updating ${name}...`);
	try {
		execSync(
			`echo -n "${envVars[name].replace(/"/g, '\\"')}" | gcloud secrets versions add ${name} --data-file=-`,
			{
				stdio: 'pipe',
				shell: true,
			}
		);
		console.log(`  ✅ ${name} updated (new version)`);
	} catch (err) {
		console.error(`  ❌ Failed to update ${name}: ${err.message}`);
	}
}

console.log('\n✅ Done. Secrets are now in GCP Secret Manager.\n');
