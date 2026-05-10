/**
 * Database Migration Runner
 * Automatically runs all SQL migration files in the migrations folder
 * Tracks applied migrations in a _migrations table to avoid re-running them.
 *
 * Usage:
 *   node scripts/migrate.js         # Run against remote D1
 *   node scripts/migrate.js --local # Run against local D1
 */

try {
  // Optional in CI/build images; local runs can still use dotenv when installed.
  await import("dotenv/config");
} catch {
  // No .env loader available; continue with existing process environment.
}
import { execFileSync, execSync } from "child_process";
import { existsSync, readdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "..", "migrations");

// Check for --local flag
const isLocal = process.argv.includes("--local");
const dbName = "spacebot-logs";
const locationFlag = isLocal ? "--local" : "--remote";

function commandExists(command) {
  try {
    const probe = process.platform === "win32" ? `where ${command}` : `command -v ${command}`;
    execSync(probe, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function resolveWranglerCommand() {
  const localWrangler = join(
    __dirname,
    "..",
    "node_modules",
    ".bin",
    process.platform === "win32" ? "wrangler.cmd" : "wrangler",
  );

  if (existsSync(localWrangler)) {
    return {
      command: localWrangler,
      prefixArgs: [],
      display: localWrangler,
    };
  }
  if (commandExists("bunx")) {
    return {
      command: "bunx",
      prefixArgs: ["wrangler"],
      display: "bunx wrangler",
    };
  }
  if (commandExists("npx")) {
    return {
      command: "npx",
      prefixArgs: ["wrangler"],
      display: "npx wrangler",
    };
  }

  throw new Error(
    "Wrangler CLI not found. Install wrangler or make bunx/npx available in PATH.",
  );
}

const wranglerCommand = resolveWranglerCommand();

console.log(`🗄️  Running migrations ${isLocal ? "(local)" : "(remote)"}...\n`);
console.log(`Using Wrangler command: ${wranglerCommand.display}`);

function d1CliExecute(args) {
  return execFileSync(
    wranglerCommand.command,
    [
      ...wranglerCommand.prefixArgs,
      "d1",
      "execute",
      dbName,
      locationFlag,
      ...args,
    ],
    { stdio: "pipe", encoding: "utf8" },
  );
}

/**
 * Execute a SQL command string against D1 and return stdout
 */
function d1Execute(sql) {
  return d1CliExecute(["--command", sql]);
}

// Ensure the _migrations tracking table exists
d1Execute(
  "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))",
);

// Get the set of already-applied migrations
let appliedMigrations = new Set();
try {
  const output = d1Execute("SELECT name FROM _migrations");
  // Parse migration names from wrangler output
  const matches = output.matchAll(/"name":\s*"([^"]+)"/g);
  for (const match of matches) {
    appliedMigrations.add(match[1]);
  }
} catch {
  // Table may be empty or output parsing failed — treat as no applied migrations
}

// Get all .sql files sorted alphabetically (ensures order like 0001, 0002, etc.)
const migrationFiles = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort();

if (migrationFiles.length === 0) {
  console.log("No migration files found.");
  process.exit(0);
}

console.log(`Found ${migrationFiles.length} migration file(s):\n`);

let successCount = 0;
let skippedCount = 0;
let errorCount = 0;

for (const file of migrationFiles) {
  console.log(`  📄 ${file}`);

  // Skip if already applied
  if (appliedMigrations.has(file)) {
    console.log(`     ⏭️  Already applied (skipped)\n`);
    skippedCount++;
    continue;
  }

  const filePath = join(migrationsDir, file);

  try {
    d1CliExecute(["--file", filePath]);

    // Record successful migration
    try {
      d1Execute(`INSERT INTO _migrations (name) VALUES ('${file}')`);
    } catch {
      // Non-fatal: migration ran but tracking insert failed
      console.log(`     ⚠️  Migration ran but failed to record in tracking table\n`);
    }

    console.log(`     ✅ Success\n`);
    successCount++;
  } catch (error) {
    const errorOutput = error.stderr?.toString() || error.stdout?.toString() || "";

    if (
      errorOutput.includes("already exists") ||
      errorOutput.includes("duplicate")
    ) {
      // Migration was already applied before tracking existed — record it now
      try {
        d1Execute(`INSERT OR IGNORE INTO _migrations (name) VALUES ('${file}')`);
      } catch {
        // Non-fatal
      }
      console.log(`     ⏭️  Already applied (skipped)\n`);
      skippedCount++;
    } else {
      console.error(`     ❌ Error: ${errorOutput || error.message}\n`);
      errorCount++;
    }
  }
}

console.log(`\n📊 Migration Summary:`);
console.log(`   ✅ ${successCount} succeeded`);
if (skippedCount > 0) {
  console.log(`   ⏭️  ${skippedCount} already applied`);
}
if (errorCount > 0) {
  console.log(`   ❌ ${errorCount} failed`);
  process.exit(1);
}

console.log(`\n✨ All migrations complete!`);
