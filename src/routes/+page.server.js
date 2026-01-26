/** @type {import('./$types').PageServerLoad} */
export async function load() {
	// TODO: Fetch real stats from Discord bot or database
	return {
		stats: {
			servers: 0,
			users: 0,
			commands: 0
		}
	};
}
