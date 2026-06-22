/**
 * Seeds the LOCAL D1 database with several fake Discord guilds so
 * DEV_AUTH_BYPASS logins (see src/hooks.server.ts, /dev-login) have more than
 * one empty server to look at. src/routes/+layout.server.ts reads
 * `guild_metadata` to build the dev-mode guild switcher, so this is the only
 * thing you need to run to get a realistic-looking multi-server dashboard.
 *
 * Always targets local D1 — there is no --remote option, on purpose.
 *
 * Usage:
 *   bun run scripts/seed-dev-data.ts
 */

import { execFileSync, execSync } from "child_process";
import { existsSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_NAME = "spacebot-logs";
const FAKE_OWNER_ID = "90000000000000099";

type SeedGuild = {
  id: string;
  name: string;
  plan: "free" | "pro" | "ultimate";
  members: number;
  bots: number;
  empty?: boolean; // mirrors the zero-data guild from the original dashboard bug
  logChannel?: boolean;
  integrationSlugs?: string[];
};

const GUILDS: SeedGuild[] = [
  { id: "90000000000000001", name: "Nebula Lounge", plan: "free", members: 42, bots: 2 },
  { id: "90000000000000002", name: "Voidwalkers Guild", plan: "pro", members: 268, bots: 6, logChannel: true, integrationSlugs: ["github"] },
  { id: "90000000000000003", name: "Star Citizens HQ", plan: "ultimate", members: 1340, bots: 18, logChannel: true, integrationSlugs: ["github", "webhook-relay"] },
  { id: "90000000000000004", name: "Test Outpost", plan: "free", members: 0, bots: 0, empty: true },
];

const FAKE_GUILD_IDS = GUILDS.map((g) => g.id);

function sql(value: string | number | null): string {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${value.replace(/'/g, "''")}'`;
}

function isoMinutesAgo(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString().slice(0, 19).replace("T", " ");
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const statements: string[] = [];

// Idempotent re-runs: wipe anything previously seeded for these exact fake
// guilds before re-inserting, so running this twice doesn't duplicate rows.
for (const table of ["event_logs", "aggregated_stats", "automations", "commands", "guild_integrations", "server_stats"]) {
  statements.push(`DELETE FROM ${table} WHERE guild_id IN (${FAKE_GUILD_IDS.map(sql).join(",")});`);
}

statements.push(
  `INSERT OR IGNORE INTO integrations (slug, name, description, category, is_official) VALUES ` +
  `('github', 'GitHub', 'Sync issues and PRs into Discord', 'dev', 1), ` +
  `('webhook-relay', 'Webhook Relay', 'Forward inbound webhooks to a channel', 'utility', 1);`,
);

for (const guild of GUILDS) {
  const humans = guild.members - guild.bots;

  statements.push(
    `INSERT OR REPLACE INTO guild_metadata (guild_id, name, owner_id, premium_tier, approximate_member_count, features) ` +
    `VALUES (${sql(guild.id)}, ${sql(guild.name)}, ${sql(FAKE_OWNER_ID)}, 0, ${guild.members}, '[]');`,
  );
  statements.push(
    `INSERT OR REPLACE INTO server_plans (guild_id, plan) VALUES (${sql(guild.id)}, ${sql(guild.plan)});`,
  );

  if (guild.empty) continue; // leave everything else blank — regression case for the empty-guild dashboard bug

  statements.push(
    `INSERT OR REPLACE INTO guild_settings (guild_id, logging_enabled, log_channel_id) ` +
    `VALUES (${sql(guild.id)}, 1, ${guild.logChannel ? sql(`${guild.id.slice(0, 10)}1`) : "NULL"});`,
  );
  statements.push(
    `INSERT INTO server_stats (guild_id, member_count, bot_count, human_count, recorded_at) ` +
    `VALUES (${sql(guild.id)}, ${guild.members}, ${guild.bots}, ${humans}, ${sql(isoMinutesAgo(0))});`,
  );

  // Member growth: spread joins/leaves over the last 30 days.
  const dailyJoins = Math.max(1, Math.round(guild.members / 60));
  for (let day = 29; day >= 0; day--) {
    const joinsToday = randInt(0, dailyJoins * 2);
    const leavesToday = randInt(0, Math.max(1, Math.floor(dailyJoins / 2)));
    for (let i = 0; i < joinsToday; i++) {
      const minutesAgo = day * 1440 + randInt(0, 1439);
      const isBot = Math.random() < 0.05 ? 1 : 0;
      statements.push(
        `INSERT INTO event_logs (guild_id, event_type, event_category, actor_id, actor_name, actor_is_bot, created_at) ` +
        `VALUES (${sql(guild.id)}, 'MEMBER_JOIN', 'member', ${sql(String(randInt(10_000_000, 99_999_999)))}, ${sql("FakeUser" + randInt(1, 9999))}, ${isBot}, ${sql(isoMinutesAgo(minutesAgo))});`,
      );
    }
    for (let i = 0; i < leavesToday; i++) {
      const minutesAgo = day * 1440 + randInt(0, 1439);
      statements.push(
        `INSERT INTO event_logs (guild_id, event_type, event_category, actor_id, actor_name, actor_is_bot, created_at) ` +
        `VALUES (${sql(guild.id)}, 'MEMBER_LEAVE', 'member', ${sql(String(randInt(10_000_000, 99_999_999)))}, ${sql("FakeUser" + randInt(1, 9999))}, 0, ${sql(isoMinutesAgo(minutesAgo))});`,
      );
    }
  }

  // Voice activity: one synthetic "hourly" bucket per day is enough to drive
  // the chart, which just sums/maxes whatever hourly rows exist per day.
  const voiceScale = Math.max(1, Math.round(guild.members / 30));
  for (let day = 13; day >= 0; day--) {
    const periodStart = isoMinutesAgo(day * 1440 + 60);
    const periodEnd = isoMinutesAgo(day * 1440);
    const uniqueUsers = randInt(1, voiceScale);
    statements.push(
      `INSERT INTO aggregated_stats (guild_id, period_type, period_start, period_end, voice_total_seconds, voice_unique_users, voice_peak_concurrent) ` +
      `VALUES (${sql(guild.id)}, 'hourly', ${sql(periodStart)}, ${sql(periodEnd)}, ${randInt(600, 7200) * voiceScale}, ${uniqueUsers}, ${randInt(1, uniqueUsers)});`,
    );
  }

  const automationTemplates = [
    { name: "Welcome Message", trigger: "MEMBER_JOIN", action: "SEND_MESSAGE", config: { channel_id: "1", content: "Welcome {user.mention} to {guild.name}!" }, enabled: 1 },
    { name: "Goodbye Note", trigger: "MEMBER_LEAVE", action: "SEND_MESSAGE", config: { channel_id: "1", content: "{user.name} left the server." }, enabled: guild.plan !== "free" ? 1 : 0 },
    { name: "Auto Role", trigger: "MEMBER_JOIN", action: "ADD_ROLE", config: { role_ids: ["2"] }, enabled: 1 },
  ];
  for (const tpl of automationTemplates) {
    statements.push(
      `INSERT INTO automations (guild_id, name, enabled, trigger_event, trigger_events, action_type, action_config, created_by) ` +
      `VALUES (${sql(guild.id)}, ${sql(tpl.name)}, ${tpl.enabled}, ${sql(tpl.trigger)}, ${sql(JSON.stringify([tpl.trigger]))}, ${sql(tpl.action)}, ${sql(JSON.stringify(tpl.config))}, ${sql(FAKE_OWNER_ID)});`,
    );
  }

  const commandTemplates = [
    { name: "greet", description: "Send a friendly greeting", config: { channel_id: "1", content: "Hi {user.mention}!" } },
    { name: "rules", description: "Post the server rules", config: { channel_id: "1", content: "Please read #rules." } },
  ];
  for (const tpl of commandTemplates) {
    statements.push(
      `INSERT OR REPLACE INTO commands (guild_id, name, description, action_type, action_config, enabled, created_by) ` +
      `VALUES (${sql(guild.id)}, ${sql(tpl.name)}, ${sql(tpl.description)}, 'SEND_MESSAGE', ${sql(JSON.stringify(tpl.config))}, 1, ${sql(FAKE_OWNER_ID)});`,
    );
  }

  for (const slug of guild.integrationSlugs || []) {
    statements.push(
      `INSERT OR REPLACE INTO guild_integrations (guild_id, integration_id, enabled, config, enabled_by) ` +
      `SELECT ${sql(guild.id)}, id, 1, '{}', ${sql(FAKE_OWNER_ID)} FROM integrations WHERE slug = ${sql(slug)};`,
    );
  }
}

const tmpDir = mkdtempSync(join(tmpdir(), "spacebot-seed-"));
const sqlPath = join(tmpDir, "seed-dev-data.sql");
writeFileSync(sqlPath, statements.join("\n") + "\n");

function commandExists(command: string): boolean {
  try {
    execSync(process.platform === "win32" ? `where ${command}` : `command -v ${command}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function resolveWranglerCommand() {
  const localWrangler = join(__dirname, "..", "node_modules", ".bin", process.platform === "win32" ? "wrangler.cmd" : "wrangler");
  if (existsSync(localWrangler)) return { command: localWrangler, prefixArgs: [] as string[] };
  if (commandExists("bunx")) return { command: "bunx", prefixArgs: ["wrangler"] };
  throw new Error("Wrangler CLI not found. Install wrangler or make bunx available in PATH.");
}

const wrangler = resolveWranglerCommand();

console.log(`🌱 Seeding ${GUILDS.length} fake guilds into local D1 (${statements.length} statements)...`);
for (const guild of GUILDS) {
  console.log(`   - ${guild.name} (${guild.id})${guild.empty ? " — intentionally empty, regression case" : ""}`);
}

execFileSync(
  wrangler.command,
  [...wrangler.prefixArgs, "d1", "execute", DB_NAME, "--local", "--file", sqlPath],
  { stdio: "inherit" },
);

console.log("\n✅ Done. Log in via /dev-login?role=superadmin and your guild switcher will show all of the above.");
