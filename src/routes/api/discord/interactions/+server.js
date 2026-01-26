import { json } from "@sveltejs/kit";
import {
	InteractionResponseType,
	InteractionType,
	verifyKey,
} from "discord-interactions";
import { commands } from "$lib/discord/commands.js";

// Track bot start time for uptime calculation
const BOT_START_TIME = Date.now();
const BOT_VERSION = "1.0.0";

/**
 * Convert hex string to Uint8Array
 */
function hexToUint8Array(hex) {
	const matches = hex.match(/.{1,2}/g);
	if (!matches) return new Uint8Array();
	return new Uint8Array(matches.map((byte) => parseInt(byte, 16)));
}

/**
 * Verify Discord request signature using Web Crypto API (for Cloudflare Workers)
 */
async function verifyWithWebCrypto(body, signature, timestamp, publicKey) {
	try {
		const encoder = new TextEncoder();
		const key = await crypto.subtle.importKey(
			"raw",
			hexToUint8Array(publicKey),
			{ name: "Ed25519", namedCurve: "Ed25519" },
			false,
			["verify"],
		);

		return await crypto.subtle.verify(
			"Ed25519",
			key,
			hexToUint8Array(signature),
			encoder.encode(timestamp + body),
		);
	} catch (error) {
		// Ed25519 not supported, fall back to discord-interactions library
		return null;
	}
}

/**
 * Verify Discord request signature
 */
async function verifyDiscordRequest(request, publicKey) {
	const signature = request.headers.get("x-signature-ed25519");
	const timestamp = request.headers.get("x-signature-timestamp");
	const body = await request.text();

	if (!signature || !timestamp) {
		return { isValid: false, body: null };
	}

	// Try Web Crypto first (for Cloudflare Workers)
	const webCryptoResult = await verifyWithWebCrypto(
		body,
		signature,
		timestamp,
		publicKey,
	);

	if (webCryptoResult !== null) {
		return { isValid: webCryptoResult, body };
	}

	// Fall back to discord-interactions library (for Node.js environments)
	try {
		const isValid = verifyKey(body, signature, timestamp, publicKey);
		return { isValid, body };
	} catch (error) {
		console.error("Signature verification error:", error);
		return { isValid: false, body: null };
	}
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ request, platform }) {
	console.log("=== Discord Interaction Request Received ===");

	// Get the public key from environment
	const PUBLIC_KEY = platform?.env?.DISCORD_PUBLIC_KEY ||
		process.env.DISCORD_PUBLIC_KEY;

	if (!PUBLIC_KEY) {
		console.error("DISCORD_PUBLIC_KEY not configured");
		return json({ error: "Server configuration error" }, { status: 500 });
	}

	console.log("Public key loaded, length:", PUBLIC_KEY.length);

	// Verify the request is from Discord
	const { isValid, body: rawBody } = await verifyDiscordRequest(
		request,
		PUBLIC_KEY,
	);

	console.log("Verification result:", isValid);

	if (!isValid) {
		console.error("Invalid request signature");
		return json({ error: "Invalid request signature" }, { status: 401 });
	}

	let body;
	try {
		body = JSON.parse(rawBody);
		console.log("Parsed body type:", body.type);
	} catch (error) {
		console.error("Failed to parse request body:", error);
		return json({ error: "Invalid JSON" }, { status: 400 });
	}

	// Handle Discord interaction types
	// Type 1: PING - Discord sends this to verify the endpoint
	if (body.type === InteractionType.PING) {
		return json({ type: InteractionResponseType.PONG });
	}

	// Type 2: APPLICATION_COMMAND - Slash commands
	if (body.type === InteractionType.APPLICATION_COMMAND) {
		const { data } = body;

		switch (data.name) {
			case "ping":
				return json({
					type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
					data: {
						content: "Pong! 🏓",
					},
				});

			case "info": {
				const uptime = Date.now() - BOT_START_TIME;
				const days = Math.floor(uptime / (1000 * 60 * 60 * 24));
				const hours = Math.floor(
					(uptime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
				);
				const minutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
				const seconds = Math.floor((uptime % (1000 * 60)) / 1000);

				let uptimeStr = "";
				if (days > 0) uptimeStr += `${days}d `;
				if (hours > 0) uptimeStr += `${hours}h `;
				if (minutes > 0) uptimeStr += `${minutes}m `;
				uptimeStr += `${seconds}s`;

				return json({
					type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
					data: {
						embeds: [{
							title: "📊 SpaceBot Info",
							color: 0x5865F2, // Discord Blurple
							fields: [
								{
									name: "⏱️ Uptime",
									value: uptimeStr,
									inline: true,
								},
								{
									name: "🤖 Version",
									value: `v${BOT_VERSION}`,
									inline: true,
								},
								{
									name: "⚡ Platform",
									value: "Cloudflare Workers",
									inline: true,
								},
								{
									name: "📝 Commands",
									value: `${commands.length} available`,
									inline: true,
								},
								{
									name: "🔧 Framework",
									value: "SvelteKit",
									inline: true,
								},
								{
									name: "🌐 API Version",
									value: "Discord API v10",
									inline: true,
								},
							],
							footer: {
								text: "SpaceBot • Powered by Starspace",
							},
							timestamp: new Date().toISOString(),
						}],
					},
				});
			}

			case "help": {
				const commandList = commands.map((cmd) =>
					`**/${cmd.name}** - ${cmd.description}`
				).join("\n");

				return json({
					type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
					data: {
						embeds: [{
							title: "🚀 SpaceBot Help",
							description:
								"Welcome to SpaceBot! Here are all the available commands:",
							color: 0x57F287, // Discord Green
							fields: [
								{
									name: "📋 Commands",
									value: commandList,
									inline: false,
								},
								{
									name: "🔗 Links",
									value: "[GitHub](https://github.com/starspacegroup/spacebot)",
									inline: false,
								},
							],
							footer: {
								text: "Use /command to run a command",
							},
							thumbnail: {
								url: "https://cdn.discordapp.com/embed/avatars/0.png",
							},
						}],
					},
				});
			}

			default:
				return json({
					type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
					data: {
						content: "Unknown command",
					},
				});
		}
	}

	// Type 3: MESSAGE_COMPONENT - Button clicks, select menus
	if (body.type === InteractionType.MESSAGE_COMPONENT) {
		return json({
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: {
				content: "Button interaction received!",
			},
		});
	}

	return json({ error: "Unknown interaction type" }, { status: 400 });
}
