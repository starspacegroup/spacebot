/**
 * Register an application for the Connect handshake.
 *
 * Connect lets a site get an API key without anyone minting and pasting one —
 * but *registering* the site was still a click through the superadmin UI and a
 * copy of two values into a `.dev.vars`. This is that step as one command, and
 * it prints the exact environment lines to paste.
 *
 * Usage:
 *   bun run connect:register -- \
 *     --client-id starspace-website \
 *     --name "*Space" \
 *     --redirect-uri https://starspace.group/admin/spacebot/callback \
 *     --redirect-uri http://localhost:4203/admin/spacebot/callback \
 *     --scope voice:read --scope stats:read \
 *     [--local]
 *
 * `--local` targets the local D1 (the one `db:migrate:local` writes); the
 * default is production.
 *
 * The secret is printed ONCE and stored only as a SHA-256 hash, exactly like an
 * API key. Losing it means registering again.
 */

import { execFileSync } from 'node:child_process';
import {
	generateClientSecret,
	hashToken,
	validateRedirectUri,
	validateScopes,
} from '../src/lib/db/connect-clients.js';

const DATABASE = 'spacebot-logs';

function fail(message: string): never {
	console.error(`\n❌ ${message}\n`);
	process.exit(1);
}

/** Collect repeated `--flag value` pairs plus single-value flags. */
function parseArgs(argv: string[]) {
	const single: Record<string, string> = {};
	const repeated: Record<string, string[]> = { 'redirect-uri': [], scope: [] };
	let local = false;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--local') {
			local = true;
			continue;
		}
		if (!arg.startsWith('--')) continue;

		const key = arg.slice(2);
		const value = argv[i + 1];
		if (!value || value.startsWith('--')) fail(`--${key} needs a value`);
		i++;

		if (key in repeated) repeated[key].push(value);
		else single[key] = value;
	}

	return { single, repeated, local };
}

/** SQLite string literal. Values are validated above; this is belt and braces. */
function quote(value: string): string {
	return `'${String(value).replace(/'/g, "''")}'`;
}

const { single, repeated, local } = parseArgs(process.argv.slice(2));

const clientId = (single['client-id'] || '').trim();
if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(clientId)) {
	fail('--client-id must be 2-64 lowercase letters, digits or dashes');
}

const name = (single.name || '').trim();
if (!name) fail('--name is required — it is what admins see and approve');

const description = (single.description || '').trim();

const redirectUris = repeated['redirect-uri'];
if (redirectUris.length === 0) fail('At least one --redirect-uri is required');
for (const uri of redirectUris) {
	const check = validateRedirectUri(uri);
	if (!check.valid) fail(check.error!);
}

const scopes = repeated.scope;
if (scopes.length === 0) fail('At least one --scope is required');
const scopeCheck = validateScopes(scopes);
if (!scopeCheck.valid) fail(scopeCheck.error!);

const secret = generateClientSecret();
const secretHash = await hashToken(secret);

const sql = `INSERT INTO connect_clients (
  client_id, name, description, client_secret_hash,
  redirect_uris, allowed_scopes, enabled, created_by
) VALUES (
  ${quote(clientId)},
  ${quote(name)},
  ${description ? quote(description) : 'NULL'},
  ${quote(secretHash)},
  ${quote(JSON.stringify(redirectUris))},
  ${quote(JSON.stringify(scopes))},
  1,
  'cli'
)`;

const target = local ? '--local' : '--remote';

try {
	execFileSync('bunx', ['wrangler', 'd1', 'execute', DATABASE, target, '--command', sql], {
		stdio: ['ignore', 'pipe', 'pipe'],
	});
} catch (error: any) {
	const output = `${error?.stdout || ''}${error?.stderr || ''}`;
	if (/UNIQUE constraint/i.test(output)) {
		fail(
			`A client called "${clientId}" is already registered. Delete it under ` +
				`Superadmin → Connect Apps first, or pick another id.`
		);
	}
	fail(`Registration failed:\n${output.trim() || error?.message}`);
}

const where = local ? 'local D1' : 'production D1';

console.log(`\n✅ Registered "${name}" as ${clientId} in ${where}.\n`);
console.log(`   Scopes it may request: ${scopes.join(', ')}`);
console.log(`   Redirect URIs:`);
for (const uri of redirectUris) console.log(`     ${uri}`);

console.log(`\n   Paste these into the site's environment:\n`);
console.log(`SPACEBOT_CONNECT_URL=${single['spacebot-url'] || 'https://spacebot.starspace.group'}`);
console.log(`SPACEBOT_CONNECT_CLIENT_ID=${clientId}`);
console.log(`SPACEBOT_CONNECT_CLIENT_SECRET=${secret}`);
console.log(`\n   The secret is not stored — only its hash. If you lose it, register again.\n`);
