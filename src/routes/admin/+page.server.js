/** @type {import('./$types').PageServerLoad} */
export async function load({ locals }) {
	// TODO: Implement actual authentication check
	const isAdmin = false; // This should check if the user is authenticated and is an admin
	
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
