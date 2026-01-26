/** @type {import('./$types').PageServerLoad} */
export async function load({ locals, cookies }) {
	// TODO: Implement actual authentication check
	// Check if user is logged in via cookie
	const userId = cookies.get('discord_user_id');
	
	// TODO: Check if user ID is in ADMIN_USER_IDS environment variable
	// For now, return false to maintain security until auth is fully implemented
	const isAdmin = false;
	
	return {
		isAdmin,
		uptime: '0h 0m',
		latency: 0,
		stats: {
			servers: 0,
			users: 0,
			commandsUsed: 0
		}
	};
}
