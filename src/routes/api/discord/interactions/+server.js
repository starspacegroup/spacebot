import { json } from '@sveltejs/kit';
import { verifyKey } from 'discord-interactions';

/** @type {import('./$types').RequestHandler} */
export async function POST({ request, platform }) {
	const signature = request.headers.get('x-signature-ed25519');
	const timestamp = request.headers.get('x-signature-timestamp');
	const rawBody = await request.text();
	
	// Verify the request is from Discord
	const PUBLIC_KEY = platform?.env?.DISCORD_PUBLIC_KEY || process.env.DISCORD_PUBLIC_KEY;
	
	if (!PUBLIC_KEY) {
		console.error('DISCORD_PUBLIC_KEY not configured');
		return json({ error: 'Server configuration error' }, { status: 500 });
	}
	
	const isValidRequest = signature && timestamp && verifyKey(rawBody, signature, timestamp, PUBLIC_KEY);
	
	if (!isValidRequest) {
		return json({ error: 'Invalid request signature' }, { status: 401 });
	}
	
	const body = JSON.parse(rawBody);
	
	// Handle Discord interaction types
	// Type 1: PING - Discord sends this to verify the endpoint
	if (body.type === 1) {
		return json({ type: 1 });
	}
	
	// Type 2: APPLICATION_COMMAND - Slash commands
	if (body.type === 2) {
		const { data } = body;
		
		switch (data.name) {
			case 'ping':
				return json({
					type: 4,
					data: {
						content: 'Pong! 🏓'
					}
				});
			
			case 'stats':
				return json({
					type: 4,
					data: {
						content: 'Stats command - coming soon!'
					}
				});
			
			default:
				return json({
					type: 4,
					data: {
						content: 'Unknown command'
					}
				});
		}
	}
	
	// Type 3: MESSAGE_COMPONENT - Button clicks, select menus
	if (body.type === 3) {
		return json({
			type: 4,
			data: {
				content: 'Button interaction received!'
			}
		});
	}
	
	return json({ error: 'Unknown interaction type' }, { status: 400 });
}
