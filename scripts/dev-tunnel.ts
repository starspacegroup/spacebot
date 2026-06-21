/**
 * Per-developer Cloudflare Tunnel manager for local SpaceBot testing.
 *
 * Unlike the shared `spacebot` / `spacebot-dev` tunnels (which run on the
 * production box and whose credentials only live there), this creates one
 * tunnel *per machine*, named uniquely so multiple devs never collide, and
 * lets you expose any number of local ports as subdomains under it:
 *
 *   spacebot-<hostname>-<hash>-<label>.starspace.group  ->  localhost:<port>
 *
 * The default label is "dev" pointing at :4269 (the SvelteKit dev server),
 * but you can add more, e.g. for testing a webhook receiver on another port.
 *
 * Usage:
 *   bun run scripts/dev-tunnel.ts up [label] [--port <port>]
 *   bun run scripts/dev-tunnel.ts down
 *   bun run scripts/dev-tunnel.ts status
 *
 * Examples:
 *   bun run scripts/dev-tunnel.ts up                  # spacebot-<host>-<hash>-dev.starspace.group -> :4269
 *   bun run scripts/dev-tunnel.ts up webhooks --port 9090
 *   bun run scripts/dev-tunnel.ts down
 */

import { execSync, spawn } from "child_process";
import { randomBytes } from "crypto";
import { hostname } from "os";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const CLOUDFLARED_DIR = join(homedir(), ".cloudflared");
const STATE_PATH = join(CLOUDFLARED_DIR, "spacebot-dev-tunnel.json");
const CONFIG_PATH = join(CLOUDFLARED_DIR, "spacebot-dev-tunnel.config.yml");
const PID_PATH = join(CLOUDFLARED_DIR, "spacebot-dev-tunnel.pid");
const LOG_PATH = join(CLOUDFLARED_DIR, "spacebot-dev-tunnel.log");
const ZONE = "starspace.group";
const DEFAULT_PORT = 4269;

type IngressRule = { label: string; hostname: string; port: number };
type TunnelState = {
  tunnelId: string;
  tunnelName: string;
  hostnameSlug: string;
  hash: string;
  ingress: IngressRule[];
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "host";
}

function commandExists(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function run(cmd: string): string {
  return execSync(cmd, { stdio: "pipe" }).toString().trim();
}

function runInherit(cmd: string) {
  execSync(cmd, { stdio: "inherit" });
}

function ensureCloudflaredReady() {
  if (!commandExists("cloudflared")) {
    console.error("❌ cloudflared is not installed. See https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/");
    process.exit(1);
  }
  if (!existsSync(join(CLOUDFLARED_DIR, "cert.pem"))) {
    console.error("❌ Not authenticated with Cloudflare yet. Run `cloudflared tunnel login` first (opens a browser), then re-run this script.");
    process.exit(1);
  }
}

function loadState(): TunnelState | null {
  if (!existsSync(STATE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf-8"));
  } catch {
    return null;
  }
}

function saveState(state: TunnelState) {
  mkdirSync(CLOUDFLARED_DIR, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function listTunnels(): Array<{ id: string; name: string; deleted_at: string }> {
  try {
    return JSON.parse(run("cloudflared tunnel list -o json"));
  } catch {
    return [];
  }
}

const NOT_DELETED = "0001-01-01T00:00:00Z";

/**
 * Finds this machine's tunnel (by saved state, falling back to a name-prefix
 * scan if the state file was lost), creating a new one only if neither exist.
 */
function ensureTunnel(): TunnelState {
  const existing = loadState();
  if (existing) {
    const tunnels = listTunnels();
    const stillExists = tunnels.some((t) => t.id === existing.tunnelId && t.deleted_at === NOT_DELETED);
    if (stillExists) return existing;
    console.warn(`⚠️  Saved tunnel ${existing.tunnelName} (${existing.tunnelId}) no longer exists in your account — recreating.`);
  }

  const hostnameSlug = slugify(hostname());
  const tunnels = listTunnels();
  const reusable = tunnels.find(
    (t) => t.name.startsWith(`spacebot-${hostnameSlug}-`) && t.deleted_at === NOT_DELETED,
  );

  if (reusable) {
    console.log(`↻  Reusing existing tunnel ${reusable.name} found in your account.`);
    const hash = reusable.name.slice(`spacebot-${hostnameSlug}-`.length);
    const state: TunnelState = { tunnelId: reusable.id, tunnelName: reusable.name, hostnameSlug, hash, ingress: existing?.ingress ?? [] };
    saveState(state);
    return state;
  }

  const hash = randomBytes(3).toString("hex");
  const tunnelName = `spacebot-${hostnameSlug}-${hash}`;
  console.log(`🛠️  Creating new tunnel: ${tunnelName}`);
  runInherit(`cloudflared tunnel create ${tunnelName}`);

  const created = listTunnels().find((t) => t.name === tunnelName);
  if (!created) {
    console.error(`❌ Created tunnel ${tunnelName} but couldn't find it in \`cloudflared tunnel list\` afterwards.`);
    process.exit(1);
  }

  const state: TunnelState = { tunnelId: created.id, tunnelName, hostnameSlug, hash, ingress: [] };
  saveState(state);
  return state;
}

function writeConfig(state: TunnelState) {
  const credentialsFile = join(CLOUDFLARED_DIR, `${state.tunnelId}.json`);
  const lines = [
    `tunnel: ${state.tunnelId}`,
    `credentials-file: ${credentialsFile}`,
    `ingress:`,
    ...state.ingress.map((rule) => `  - hostname: ${rule.hostname}\n    service: http://localhost:${rule.port}`),
    `  - service: http_status:404`,
  ];
  writeFileSync(CONFIG_PATH, lines.join("\n") + "\n");
}

// DNS routing goes through the Cloudflare API directly (not `cloudflared
// tunnel route dns`), which infers the zone from whatever your local
// cloudflared login cert happens to be scoped to — if that's a different
// project's zone, it silently creates the record there instead of erroring.
let zoneIdCache: string | null = null;

async function cfFetch(path: string, init?: RequestInit) {
  const token = process.env.CLOUDFLARE_DNS_API_TOKEN;
  if (!token) {
    console.error(
      "❌ CLOUDFLARE_DNS_API_TOKEN is not set. Create a token at https://dash.cloudflare.com/profile/api-tokens\n" +
      `   with permission Zone / DNS / Edit, scoped to the ${ZONE} zone, and add it to .env.`,
    );
    process.exit(1);
  }
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const body = await res.json();
  if (!body.success) {
    console.error(`❌ Cloudflare API error on ${path}:`, JSON.stringify(body.errors));
    process.exit(1);
  }
  return body.result;
}

async function getZoneId(): Promise<string> {
  if (zoneIdCache) return zoneIdCache;
  const zones = await cfFetch(`/zones?name=${ZONE}`);
  if (!zones[0]) {
    console.error(`❌ Zone ${ZONE} not found for this API token's account.`);
    process.exit(1);
  }
  zoneIdCache = zones[0].id;
  return zoneIdCache!;
}

async function routeDns(tunnelId: string, hostname: string) {
  const zoneId = await getZoneId();
  const target = `${tunnelId}.cfargotunnel.com`;
  const existing = await cfFetch(`/zones/${zoneId}/dns_records?name=${hostname}`);

  if (existing[0]) {
    if (existing[0].content === target) return; // already correct
    await cfFetch(`/zones/${zoneId}/dns_records/${existing[0].id}`, {
      method: "PUT",
      body: JSON.stringify({ type: "CNAME", name: hostname, content: target, proxied: true }),
    });
    console.log(`🔄 Updated DNS record ${hostname} -> ${target}`);
    return;
  }

  await cfFetch(`/zones/${zoneId}/dns_records`, {
    method: "POST",
    body: JSON.stringify({ type: "CNAME", name: hostname, content: target, proxied: true }),
  });
  console.log(`✅ Created DNS record ${hostname} -> ${target}`);
}

function stopRunningDaemon() {
  if (!existsSync(PID_PATH)) return;
  const pid = parseInt(readFileSync(PID_PATH, "utf-8").trim(), 10);
  if (Number.isFinite(pid)) {
    try {
      process.kill(pid, "SIGTERM");
      console.log(`🛑 Stopped previous tunnel process (pid ${pid}).`);
    } catch {
      // already dead
    }
  }
  rmSync(PID_PATH, { force: true });
}

function startDaemon(state: TunnelState) {
  mkdirSync(CLOUDFLARED_DIR, { recursive: true });
  const logFd = openSync(LOG_PATH, "a");
  const child = spawn(
    "cloudflared",
    ["tunnel", "--config", CONFIG_PATH, "run", state.tunnelName],
    { detached: true, stdio: ["ignore", logFd, logFd] },
  );
  child.unref();
  writeFileSync(PID_PATH, String(child.pid));
  console.log(`🚀 Started tunnel daemon (pid ${child.pid}). Logs: ${LOG_PATH}`);
}

function isRunning(): number | null {
  if (!existsSync(PID_PATH)) return null;
  const pid = parseInt(readFileSync(PID_PATH, "utf-8").trim(), 10);
  if (!Number.isFinite(pid)) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

function printUrls(state: TunnelState) {
  console.log("\n🔗 Active routes:");
  for (const rule of state.ingress) {
    console.log(`   https://${rule.hostname}  ->  http://localhost:${rule.port}`);
  }
  console.log("");
}

async function cmdUp(label: string, port: number) {
  ensureCloudflaredReady();
  const state = ensureTunnel();

  const safeLabel = slugify(label);
  const ruleHostname = `${state.tunnelName}-${safeLabel}.${ZONE}`;
  const existingRule = state.ingress.find((r) => r.label === safeLabel);
  if (existingRule) {
    existingRule.port = port;
  } else {
    state.ingress.push({ label: safeLabel, hostname: ruleHostname, port });
  }
  saveState(state);
  writeConfig(state);

  await routeDns(state.tunnelId, ruleHostname);

  stopRunningDaemon();
  startDaemon(state);
  printUrls(state);
}

function cmdDown() {
  if (isRunning() === null) {
    console.log("Tunnel daemon is not running.");
    return;
  }
  stopRunningDaemon();
  console.log("Tunnel daemon stopped. DNS routes and the tunnel itself are left in place — run `up` again to reconnect.");
}

function cmdStatus() {
  const state = loadState();
  if (!state) {
    console.log("No dev tunnel configured on this machine yet. Run: bun run scripts/dev-tunnel.ts up");
    return;
  }
  const pid = isRunning();
  console.log(`Tunnel: ${state.tunnelName} (${state.tunnelId})`);
  console.log(`Daemon: ${pid ? `running (pid ${pid})` : "not running"}`);
  printUrls(state);
  if (existsSync(LOG_PATH)) {
    console.log(`Last log lines (${LOG_PATH}):`);
    console.log(run(`tail -n 10 ${LOG_PATH}`));
  }
}

const [, , command, ...rest] = process.argv;

if (command === "up") {
  const portFlagIndex = rest.findIndex((a) => a === "--port");
  const port = portFlagIndex >= 0 ? parseInt(rest[portFlagIndex + 1], 10) : DEFAULT_PORT;
  const label = rest.find((a, i) => !a.startsWith("--") && rest[i - 1] !== "--port") || "dev";
  await cmdUp(label, Number.isFinite(port) ? port : DEFAULT_PORT);
} else if (command === "down") {
  cmdDown();
} else if (command === "status") {
  cmdStatus();
} else {
  console.log(`Usage:
  bun run scripts/dev-tunnel.ts up [label] [--port <port>]   # default label "dev", default port ${DEFAULT_PORT}
  bun run scripts/dev-tunnel.ts down                          # stop the local daemon (routes stay configured)
  bun run scripts/dev-tunnel.ts status                        # show configured routes + daemon state`);
  process.exit(command ? 1 : 0);
}
