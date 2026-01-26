/** @type {import('./$types').PageServerLoad} */
export async function load({ platform }) {
	const BOT_TOKEN = platform?.env?.DISCORD_BOT_TOKEN ||
		process.env.DISCORD_BOT_TOKEN;

	if (!BOT_TOKEN) {
		return {
			guilds: [],
			error: "Bot token not configured",
		};
	}

	try {
		// Fetch guilds the bot is in
		const response = await fetch(
			"https://discord.com/api/v10/users/@me/guilds",
			{
				headers: {
					Authorization: `Bot ${BOT_TOKEN}`,
				},
			},
		);

		if (!response.ok) {
			const errorText = await response.text();
			console.error("Failed to fetch guilds:", response.status, errorText);
			return {
				guilds: [],
				error: "Failed to fetch servers",
			};
		}

		const guilds = await response.json();

		// Transform guild data to include icon URLs
		const guildsWithIcons = guilds.map((guild) => ({
			id: guild.id,
			name: guild.name,
			icon: guild.icon
				? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.${
					guild.icon.startsWith("a_") ? "gif" : "png"
				}?size=128`
				: null,
			memberCount: guild.approximate_member_count || null,
			owner: guild.owner || false,
		}));

		return {
			guilds: guildsWithIcons,
			error: null,
		};
	} catch (error) {
		console.error("Error fetching guilds:", error);
		return {
			guilds: [],
			error: "Failed to connect to Discord",
		};
	}
}
