import { readFileSync } from "fs";
import { resolve } from "path";
import { registerCommands } from "../src/lib/discord/commands.js";

// Load .env file manually (Node.js doesn't do this automatically)
try {
	const envPath = resolve(process.cwd(), ".env");
	const envContent = readFileSync(envPath, "utf-8");
	for (const line of envContent.split("\n")) {
		const trimmed = line.trim();
		if (trimmed && !trimmed.startsWith("#")) {
			const [key, ...valueParts] = trimmed.split("=");
			if (key && valueParts.length > 0) {
				const value = valueParts.join("=").replace(/^["']|["']$/g, "");
				process.env[key.trim()] = value;
			}
		}
	}
} catch {
	// .env file not found, rely on environment variables
}

const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID; // Optional: for instant guild-specific registration

if (!CLIENT_ID || !BOT_TOKEN) {
	console.error("Missing required environment variables:");
	console.error("- DISCORD_CLIENT_ID");
	console.error("- DISCORD_BOT_TOKEN");
	console.error("");
	console.error(
		"Optional: DISCORD_GUILD_ID (for instant guild-specific commands)",
	);
	console.error("");
	console.error("Either set them in your environment or create a .env file");
	process.exit(1);
}

if (GUILD_ID) {
	console.log(`Registering commands to guild ${GUILD_ID} (instant update)...`);
} else {
	console.log(
		"Registering global commands (may take up to 1 hour to propagate)...",
	);
}

registerCommands(CLIENT_ID, BOT_TOKEN, GUILD_ID)
	.then(() => {
		console.log("✅ Commands registered successfully!");
		process.exit(0);
	})
	.catch((error) => {
		console.error("❌ Failed to register commands:", error);
		process.exit(1);
	});
