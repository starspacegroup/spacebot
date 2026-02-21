/**
 * Integration Registry
 *
 * Maintains the catalog of known integrations and seeds them into the DB.
 * Each integration declares a manifest that tells SpaceBot what commands,
 * webhooks, and configuration the integration needs.
 *
 * Third-party integrations can also publish a `spacebot-integration.json`
 * at a remote URL that SpaceBot can fetch and register.
 */

import { log } from "../log.js";
import { upsertIntegration } from "../db/integrations.js";

// ---------------------------------------------------------------------------
// Manifest schema (what an integration declares)
// ---------------------------------------------------------------------------
//
// {
//   "name": "My Integration",
//   "slug": "my-integration",
//   "version": "1.0.0",
//   "description": "Short description",
//   "author": "Author Name",
//   "icon": "🎮",                          // emoji or URL
//   "category": "gaming" | "ai" | "moderation" | "utility" | "general",
//   "homepage": "https://...",
//   "manifest_url": "https://...spacebot-integration.json",
//
//   "commands": [
//     {
//       "name": "play",
//       "description": "Start a game",
//       "type": 1,                           // CHAT_INPUT
//       "options": [ ... ]                    // Discord command options
//     }
//   ],
//
//   "webhooks": {
//     "on_enable":  "https://game.example.com/api/spacebot/on-enable",
//     "on_disable": "https://game.example.com/api/spacebot/on-disable",
//     "command_handler": "https://game.example.com/api/spacebot/command"
//   },
//
//   "config_schema": [
//     { "key": "api_key",  "label": "Game API Key",  "type": "string", "required": false },
//     { "key": "channel",  "label": "Game Channel",  "type": "channel", "required": false }
//   ]
// }
//
// ---------------------------------------------------------------------------

/**
 * Built-in integrations that ship with SpaceBot.
 * These are always available in the catalog.
 */
export const BUILT_IN_INTEGRATIONS = [
  {
    slug: "starspace-game",
    name: "*Space Game",
    description:
      "Connect the *Space multiplayer game to your Discord server. Adds commands for checking player stats, leaderboards, and linking Discord accounts to game profiles.",
    icon: "🎮",
    author: "StarSpace Group",
    version: "1.0.0",
    category: "gaming",
    is_official: true,
    manifest_url:
      "https://raw.githubusercontent.com/starspacegroup/game/main/spacebot-integration.json",
    manifest_json: {
      name: "*Space Game",
      slug: "starspace-game",
      version: "1.0.0",
      description:
        "Connect the *Space multiplayer game to your Discord server.",
      author: "StarSpace Group",
      icon: "🎮",
      category: "gaming",
      homepage: "https://game.starspace.group/",

      commands: [
        {
          name: "game",
          description: "StarSpace Game commands",
          type: 1,
          options: [
            {
              name: "stats",
              description: "View your game stats or another player's stats",
              type: 1, // SUB_COMMAND
              options: [
                {
                  name: "player",
                  description: "Player to look up (defaults to yourself)",
                  type: 6, // USER
                  required: false,
                },
              ],
            },
            {
              name: "leaderboard",
              description: "View the server leaderboard",
              type: 1,
              options: [
                {
                  name: "category",
                  description: "Leaderboard category",
                  type: 3, // STRING
                  required: false,
                  choices: [
                    { name: "Score", value: "score" },
                    { name: "Wins", value: "wins" },
                    { name: "Play Time", value: "playtime" },
                  ],
                },
              ],
            },
            {
              name: "play",
              description: "Get the link to play StarSpace Game",
              type: 1, // SUB_COMMAND
            },

          ],
        },
      ],

      webhooks: {
        on_enable: null,
        on_disable: null,
        command_handler: null,
      },

      config_schema: [],
    },
  },
];

/**
 * Seed the built-in integrations into the database.
 * Safe to call multiple times — uses upsert.
 */
export async function seedBuiltInIntegrations(db) {
  if (!db) {
    log.warn("[IntegrationRegistry] No database, skipping seed");
    return;
  }

  for (const integration of BUILT_IN_INTEGRATIONS) {
    const result = await upsertIntegration(db, integration);
    if (result.success) {
      log.debug(`[IntegrationRegistry] Seeded integration: ${integration.slug}`);
    } else {
      log.error(`[IntegrationRegistry] Failed to seed ${integration.slug}:`, result.error);
    }
  }
}

/**
 * Fetch a remote integration manifest from a URL.
 * Returns the parsed manifest or null on failure.
 */
export async function fetchRemoteManifest(url) {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      log.warn(`[IntegrationRegistry] Failed to fetch manifest from ${url}: ${response.status}`);
      return null;
    }

    const manifest = await response.json();

    // Basic validation
    if (!manifest.slug || !manifest.name) {
      log.warn(`[IntegrationRegistry] Invalid manifest from ${url}: missing slug or name`);
      return null;
    }

    return manifest;
  } catch (error) {
    log.error(`[IntegrationRegistry] Error fetching manifest from ${url}:`, error);
    return null;
  }
}

/**
 * Given an integration's manifest, return the Discord command payloads
 * that should be registered when the integration is enabled for a guild.
 */
export function getIntegrationCommands(integration) {
  const manifest = integration.manifest || integration.manifest_json;
  if (!manifest?.commands || !Array.isArray(manifest.commands)) return [];
  return manifest.commands;
}
