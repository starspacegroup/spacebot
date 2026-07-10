import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Register Linked Role Connection Metadata with Discord
 *
 * This script registers the metadata schema that Discord uses to evaluate
 * linked role requirements. Run this once (or whenever you change metadata fields).
 *
 * Usage: bun scripts/register-linked-role-metadata.ts
 */

// Load .env file manually
try {
	const envPath = resolve(process.cwd(), '.env');
	const envContent = readFileSync(envPath, 'utf-8');
	for (const line of envContent.split('\n')) {
		const trimmed = line.trim();
		if (trimmed && !trimmed.startsWith('#')) {
			const [key, ...valueParts] = trimmed.split('=');
			if (key && valueParts.length > 0) {
				const value = valueParts.join('=').replace(/^["']|["']$/g, '');
				process.env[key.trim()] = value;
			}
		}
	}
} catch {
	// .env file not found, rely on environment variables
}

const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!CLIENT_ID || !BOT_TOKEN) {
	console.error('Missing required environment variables:');
	console.error('- DISCORD_CLIENT_ID');
	console.error('- DISCORD_BOT_TOKEN');
	console.error('');
	console.error('Either set them in your environment or create a .env file');
	process.exit(1);
}

/**
 * Role connection metadata fields.
 * See: https://discord.com/developers/docs/resources/application-role-connection-metadata
 *
 * Types:
 *   1 = INTEGER_LESS_THAN_OR_EQUAL
 *   2 = INTEGER_GREATER_THAN_OR_EQUAL
 *   3 = INTEGER_EQUAL
 *   4 = INTEGER_NOT_EQUAL
 *   5 = DATETIME_LESS_THAN_OR_EQUAL
 *   6 = DATETIME_GREATER_THAN_OR_EQUAL
 *   7 = BOOLEAN_EQUAL
 *   8 = BOOLEAN_NOT_EQUAL
 */
const metadata = [
	{
		key: 'verified',
		name: 'Verified',
		description: 'User has verified through SpaceBot',
		type: 7, // BOOLEAN_EQUAL
	},
];

async function registerMetadata() {
	console.log('Registering linked role metadata...');
	console.log('Metadata:', JSON.stringify(metadata, null, 2));

	const response = await fetch(
		`https://discord.com/api/v10/applications/${CLIENT_ID}/role-connections/metadata`,
		{
			method: 'PUT',
			headers: {
				Authorization: `Bot ${BOT_TOKEN}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(metadata),
		}
	);

	if (!response.ok) {
		const errorData = await response.text();
		console.error(`❌ Failed to register metadata (${response.status}):`, errorData);
		process.exit(1);
	}

	const result = await response.json();
	console.log('✅ Linked role metadata registered successfully!');
	console.log('Result:', JSON.stringify(result, null, 2));
}

registerMetadata();
