/**
 * GitHub Webhook Endpoint
 *
 * Receives webhook events from GitHub and fires them into the automation
 * engine for all guilds that have the GitHub integration enabled.
 *
 * URL: POST /api/v1/integrations/github/webhook/[guildId]
 *
 * Each guild gets a unique webhook URL. The guild configures this URL in
 * their GitHub repository settings along with the webhook secret shown
 * on the integrations page.
 */

import { json } from "@sveltejs/kit";
import { log, logEvent } from "$lib/db/logger.js";
import { getIntegrationBySlug, getGuildsWithIntegrationConfig } from "$lib/db/integrations.js";
import { verifyGitHubSignature, parseGitHubEvent } from "$lib/integrations/github.js";
import { seedBuiltInIntegrations } from "$lib/integrations/registry.js";
import { processAutomations } from "$lib/automation/engine.js";
import { createDiscordRestClient } from "$lib/discord/rest-client.js";
import { getLatestServerStats } from "$lib/db/server-stats.js";
import { getGuildMetadata } from "$lib/db/guild-metadata.js";

/** @type {import('./$types').RequestHandler} */
export async function POST({ params, request, platform }) {
  const { guildId } = params;

  if (!guildId || !/^\d{17,20}$/.test(guildId)) {
    return json({ error: "Invalid guild ID" }, { status: 400 });
  }

  const db = platform?.env?.DB;
  if (!db) {
    return json({ error: "Service unavailable" }, { status: 503 });
  }

  // Ensure built-in integrations are present before lookup.
  // This keeps webhook handling working even if no admin page has been visited.
  try {
    await seedBuiltInIntegrations(db);
  } catch (err) {
    log.warn(`[GitHub] Failed to seed built-in integrations: ${err.message}`);
  }

  // Read the raw body for signature verification
  const rawBody = await request.text();

  // Get the GitHub integration record
  const integration = await getIntegrationBySlug(db, "github");
  if (!integration) {
    log.warn(`[GitHub] Webhook rejected: github integration row missing (guild: ${guildId})`);
    return json({ error: "GitHub integration not found" }, { status: 404 });
  }

  // Get all guilds with the GitHub integration enabled and their configs
  const guilds = await getGuildsWithIntegrationConfig(db, integration.id);
  const guildConfig = guilds.find((g) => g.guild_id === guildId);

  if (!guildConfig) {
    log.info(`[GitHub] Webhook rejected: integration not enabled for guild ${guildId}`);
    return json(
      { error: "GitHub integration not enabled for this server" },
      { status: 404 },
    );
  }

  // Verify the webhook signature if a secret is configured
  const webhookSecret = guildConfig.config?.webhook_secret;
  if (webhookSecret) {
    const signature = request.headers.get("X-Hub-Signature-256");
    const valid = await verifyGitHubSignature(rawBody, signature, webhookSecret);
    if (!valid) {
      log.warn(`[GitHub] Webhook rejected: invalid signature (guild: ${guildId})`);
      return json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  // Parse the GitHub event
  const githubEvent = request.headers.get("X-GitHub-Event");
  if (!githubEvent) {
    return json({ error: "Missing X-GitHub-Event header" }, { status: 400 });
  }

  // Handle ping event (sent when webhook is first configured)
  if (githubEvent === "ping") {
    log.info(`[GitHub] Received ping for guild ${guildId}`);
    return json({ success: true, message: "Pong! GitHub webhook connected." });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseGitHubEvent(githubEvent, payload, guildId);
  if (!parsed) {
    // Unsupported event type — acknowledge but ignore
    return json({ success: true, message: `Event "${githubEvent}" ignored` });
  }

  const { event, summary } = parsed;

  log.info(`[GitHub] ${summary} (guild: ${guildId})`);

  // Log the event
  try {
    await logEvent(db, event);
  } catch (err) {
    log.warn(`[GitHub] Failed to log event: ${err.message}`);
  }

  // Process automations for this event
  try {
    const botToken = platform?.env?.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;
    event._widget_signing_secret = platform?.env?.DISCORD_PUBLIC_KEY || process.env.DISCORD_PUBLIC_KEY;
    event._widget_origin = platform?.env?.APP_URL || process.env.APP_URL || process.env.API_BASE || "http://localhost:4269";
    const discord = botToken ? createDiscordRestClient(botToken) : null;
    const [guildMeta, guildStats] = await Promise.all([
      getGuildMetadata(db, guildId).catch(() => null),
      getLatestServerStats(db, guildId).catch(() => null),
    ]);
    const guildInfo = {
      name: guildMeta?.name || "Unknown Server",
      member_count: guildStats?.member_count ?? guildMeta?.approximate_member_count ?? null,
      human_count: guildStats?.human_count ?? null,
      bot_count: guildStats?.bot_count ?? null,
      boost_count: guildStats?.boost_count ?? guildMeta?.premium_subscription_count ?? null,
      boost_level: guildStats?.boost_level ?? guildMeta?.premium_tier ?? null,
    };
    const result = await processAutomations(event, db, discord, guildInfo, {});
    log.debug(
      `[GitHub] Automations processed: ${result.executed} executed, ${result.errors} errors`,
    );
  } catch (err) {
    log.error(`[GitHub] Automation processing error: ${err.message}`);
  }

  return json({
    success: true,
    event_type: event.event_type,
    summary,
  });
}
