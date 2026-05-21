import { json } from "@sveltejs/kit";
import { DEFAULT_MODEL } from "$lib/ai/chat.js";
import { resolveRuntimeModelConfig } from "$lib/server/workers-ai-models.js";

function getEnv(platform, name) {
	return platform?.env?.[name] ?? (typeof process !== "undefined" ? process.env?.[name] : undefined);
}

function checkIsBotRequest(request, platform) {
	const authHeader = request.headers.get("Authorization");
	const botToken = getEnv(platform, "DISCORD_BOT_TOKEN");
	return Boolean(botToken) && authHeader === `Bot ${botToken}`;
}

export async function GET({ request, platform }) {
	if (!checkIsBotRequest(request, platform)) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}

	const db = platform?.env?.DB;
	if (!db) {
		return json({ error: "Database not available" }, { status: 503 });
	}

	const fallbackModel = getEnv(platform, "CLOUDFLARE_AI_MODEL") || DEFAULT_MODEL;
	const modelConfig = await resolveRuntimeModelConfig(db, fallbackModel);

	return json({
		success: true,
		modelConfig,
	});
}