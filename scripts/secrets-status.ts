/**
 * What is actually configured, without revealing anything.
 *
 * Run it anywhere — laptop or the VM — to see which managed secrets resolve,
 * where from, and which are still placeholders. Values are never printed; only
 * presence, source and length. The point is that "why is the bot degraded?"
 * should be answerable in one command instead of by reading loader source and
 * guessing.
 *
 *   bun run secrets:status
 */

import {
	loadSecrets,
	getSecret,
	isPlaceholderSecret,
	REQUIRED_SECRETS,
} from '../src/lib/secrets.js';

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

// Snapshot what came from the environment before the loader can overwrite it,
// so "GCP" and "env" can be told apart afterwards.
const fromEnvBefore = new Set(
	MANAGED_SECRETS.filter((name) => String(process.env[name] ?? '').trim() !== '')
);

await loadSecrets();

const rows = MANAGED_SECRETS.map((name) => {
	const value = getSecret(name);
	const present = String(value ?? '').trim() !== '';
	const placeholder = present && isPlaceholderSecret(value);

	return {
		name,
		state: !present ? 'MISSING' : placeholder ? 'PLACEHOLDER' : 'set',
		source: !present ? '—' : fromEnvBefore.has(name) ? 'env' : 'gcp',
		// Length alone is a useful sanity check (a truncated paste is visible)
		// and reveals nothing about the value.
		length: present ? String(value).length : 0,
		required: REQUIRED_SECRETS.includes(name),
	};
});

const width = Math.max(...rows.map((row) => row.name.length));
const mark = { set: '✅', MISSING: '❌', PLACEHOLDER: '🟡' };

console.log('');
for (const row of rows) {
	const flag = row.required ? ' (required)' : '';
	console.log(
		`${mark[row.state]}  ${row.name.padEnd(width)}  ${row.state.padEnd(11)}` +
			`  ${row.source.padEnd(4)}  ${row.length ? `${row.length} chars` : ''}${flag}`
	);
}

const broken = rows.filter((row) => row.required && row.state !== 'set');
console.log('');
if (broken.length) {
	console.log(
		`🔴 ${broken.length} required secret(s) not usable: ${broken.map((r) => r.name).join(', ')}`
	);
	console.log('   See docs/secrets.md for how to set them without writing them to disk.\n');
	process.exit(1);
}
console.log('✅ All required secrets are set.\n');
