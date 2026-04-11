import { redirect } from "@sveltejs/kit";
import { getAllGuildMetadata } from "$lib/db/guild-metadata.js";
import { log } from "$lib/db/logger.js";

function checkIsSuperAdmin(userId, platform) {
	if (!userId) return false;
	const adminUserIds = platform?.env?.ADMIN_USER_IDS || process.env.ADMIN_USER_IDS || "";
	return adminUserIds.split(",").map((id) => id.trim()).filter(Boolean).includes(userId);
}

async function getBotGuilds(botToken) {
	if (!botToken) return [];

	try {
		const response = await fetch("https://discord.com/api/v10/users/@me/guilds?with_counts=true", {
			headers: { Authorization: `Bot ${botToken}` },
		});

		if (!response.ok) {
			log.warn(`[Superadmin Stats Import] Failed to fetch bot guilds: ${response.status}`);
			return [];
		}

		return await response.json();
	} catch (error) {
		log.error("[Superadmin Stats Import] Failed to fetch bot guilds:", error);
		return [];
	}
}

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform }) {
	const userId = cookies.get("discord_user_id");
	if (!checkIsSuperAdmin(userId, platform)) {
		throw redirect(302, "/admin");
	}

	const db = platform?.env?.DB;
	const botToken = platform?.env?.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;

	const [botGuilds, metadata] = await Promise.all([
		getBotGuilds(botToken),
		db ? getAllGuildMetadata(db) : [],
	]);

	const metadataMap = new Map((metadata || []).map((guild) => [guild.guild_id, guild]));
	const seenGuildIds = new Set();
	const servers = [];

	for (const guild of botGuilds) {
		seenGuildIds.add(guild.id);
		const stored = metadataMap.get(guild.id);
		servers.push({
			guild_id: guild.id,
			name: stored?.name || guild.name,
		});
	}

	for (const guild of metadata || []) {
		if (seenGuildIds.has(guild.guild_id)) continue;
		servers.push({
			guild_id: guild.guild_id,
			name: guild.name || guild.guild_id,
		});
	}

	servers.sort((left, right) => {
		const leftName = (left.name || "").toLowerCase();
		const rightName = (right.name || "").toLowerCase();
		return leftName.localeCompare(rightName) || left.guild_id.localeCompare(right.guild_id);
	});

	return {
		servers,
	};
}