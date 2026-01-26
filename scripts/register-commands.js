import { registerCommands } from '../src/lib/discord/commands.js';

const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!CLIENT_ID || !BOT_TOKEN) {
	console.error('Missing required environment variables:');
	console.error('- DISCORD_CLIENT_ID');
	console.error('- DISCORD_BOT_TOKEN');
	process.exit(1);
}

console.log('Registering Discord commands...');
registerCommands(CLIENT_ID, BOT_TOKEN)
	.then(() => {
		console.log('✅ Commands registered successfully!');
		process.exit(0);
	})
	.catch((error) => {
		console.error('❌ Failed to register commands:', error);
		process.exit(1);
	});
