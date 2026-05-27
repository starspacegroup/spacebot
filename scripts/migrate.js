/**
 * Database Migration Runner
 * Automatically runs all SQL migration files in the migrations folder
 * Tracks applied migrations in a _migrations table to avoid re-running them.
 *
 * Usage:
 *   bun scripts/migrate.js         # Run against remote D1
 *   bun scripts/migrate.js --local # Run against local D1
 */

try {
  // Optional in CI/build images; local runs can still use dotenv when installed.
  await import("dotenv/config");
} catch {
  // No .env loader available; continue with existing process environment.
}
import { execFileSync, execSync } from "child_process";
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "..", "migrations");

// Check for --local flag
const isLocal = process.argv.includes("--local");
const dbName = "spacebot-logs";
const locationFlag = isLocal ? "--local" : "--remote";
const maxD1Retries = isLocal ? 1 : 3;

function sleepMs(ms) {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function extractErrorOutput(error) {
  return error?.stderr?.toString() || error?.stdout?.toString() || error?.message || "";
}

function isTransientD1Error(output) {
  const normalized = output.toLowerCase();
  return (
    normalized.includes("upstream service unavailable") ||
    normalized.includes("[code: 7009]") ||
    normalized.includes("internal error") ||
    normalized.includes("timed out") ||
    normalized.includes("econnreset") ||
    normalized.includes("etimedout") ||
    normalized.includes("too many requests") ||
    normalized.includes(" code: 429")
  );
}

function isAlreadyAppliedError(output) {
  const normalized = output.toLowerCase();
  return (
    normalized.includes("already exists") ||
    normalized.includes("duplicate") ||
    normalized.includes("duplicate column name") ||
    normalized.includes("no such column")
  );
}

function shouldFallbackToCommandExecution(output) {
  const normalized = output.toLowerCase();
  return (
    normalized.includes("d1_reset_do") ||
    normalized.includes("reset before execute completed")
  );
}

function parseAppliedMigrations(output, migrationFiles) {
  const applied = new Set();

  // Wrangler output format can vary (table/json/plain). Handle all known variants.
  const jsonMatches = output.matchAll(/"name":\s*"([^"]+)"/g);
  for (const match of jsonMatches) {
    applied.add(match[1]);
  }

  const singleQuotedMatches = output.matchAll(/'name':\s*'([^']+)'/g);
  for (const match of singleQuotedMatches) {
    applied.add(match[1]);
  }

  // Final fallback: detect known migration filenames directly in output.
  for (const file of migrationFiles) {
    if (output.includes(file)) {
      applied.add(file);
    }
  }

  return applied;
}

function splitSqlStatements(sql) {
  const statements = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = i + 1 < sql.length ? sql[i + 1] : "";

    if (inLineComment) {
      current += ch;
      if (ch === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      current += ch;
      if (ch === "*" && next === "/") {
        current += next;
        i++;
        inBlockComment = false;
      }
      continue;
    }

    if (!inSingle && !inDouble) {
      if (ch === "-" && next === "-") {
        current += ch + next;
        i++;
        inLineComment = true;
        continue;
      }
      if (ch === "/" && next === "*") {
        current += ch + next;
        i++;
        inBlockComment = true;
        continue;
      }
    }

    if (ch === "'" && !inDouble) {
      if (inSingle && next === "'") {
        current += ch + next;
        i++;
        continue;
      }
      inSingle = !inSingle;
      current += ch;
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
      continue;
    }

    if (ch === ";" && !inSingle && !inDouble) {
      const stmt = current.trim();
      if (stmt.length > 0) {
        statements.push(stmt);
      }
      current = "";
      continue;
    }

    current += ch;
  }

  const tail = current.trim();
  if (tail.length > 0) {
    statements.push(tail);
  }

  return statements;
}

function executeSqlFileViaCommand(filePath) {
  const sql = readFileSync(filePath, "utf8");
  const statements = splitSqlStatements(sql);
  for (const statement of statements) {
    d1CliExecute(["--command", statement]);
  }
}

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

  throw new Error(
    "Wrangler CLI not found. Install wrangler or make bunx available in PATH.",
  );
}

const wranglerCommand = resolveWranglerCommand();

console.log(`🗄️  Running migrations ${isLocal ? "(local)" : "(remote)"}...\n`);
console.log(`Using Wrangler command: ${wranglerCommand.display}`);

function d1CliExecute(args) {
  let lastError;
  for (let attempt = 1; attempt <= maxD1Retries; attempt++) {
    try {
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
    } catch (error) {
      lastError = error;
      const errorOutput = extractErrorOutput(error);
      const canRetry = attempt < maxD1Retries && isTransientD1Error(errorOutput);

      if (!canRetry) {
        throw error;
      }

      console.log(
        `     🔁 Transient D1 API error (attempt ${attempt}/${maxD1Retries}); retrying...`,
      );
      sleepMs(attempt * 1000);
    }
  }

  throw lastError;
}

/**
 * Execute a SQL command string against D1 and return stdout
 */
function d1Execute(sql) {
  const tempSqlPath = join(
    migrationsDir,
    `.__tmp_d1_${process.pid}_${Date.now()}.sql`,
  );

  writeFileSync(tempSqlPath, `${sql.trim()}\n`, "utf8");
  try {
    return d1CliExecute(["--file", tempSqlPath]);
  } finally {
    try {
      unlinkSync(tempSqlPath);
    } catch {
      // Best-effort cleanup.
    }
  }
}

// Ensure the _migrations tracking table exists
d1Execute(
  "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))",
);

// Get all .sql files sorted alphabetically (ensures order like 0001, 0002, etc.)
const migrationFiles = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort();

if (migrationFiles.length === 0) {
  console.log("No migration files found.");
  process.exit(0);
}

// Get the set of already-applied migrations
let appliedMigrations = new Set();
try {
  const output = d1Execute("SELECT name FROM _migrations");
  appliedMigrations = parseAppliedMigrations(output, migrationFiles);
} catch {
  // Table may be empty or output parsing failed — treat as no applied migrations
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
      d1Execute(`INSERT OR IGNORE INTO _migrations (name) VALUES ('${file}')`);
      appliedMigrations.add(file);
    } catch (trackingError) {
      // Non-fatal: migration ran but tracking insert failed
      const trackingOutput = extractErrorOutput(trackingError);
      if (trackingOutput) {
        console.log(`     ⚠️  Migration ran but failed to record in tracking table: ${trackingOutput.trim()}\n`);
      } else {
      console.log(`     ⚠️  Migration ran but failed to record in tracking table\n`);
      }
    }

    console.log(`     ✅ Success\n`);
    successCount++;
  } catch (error) {
    const errorOutput = extractErrorOutput(error);

    if (isAlreadyAppliedError(errorOutput)) {
      // Migration was already applied before tracking existed — record it now
      try {
        d1Execute(`INSERT OR IGNORE INTO _migrations (name) VALUES ('${file}')`);
        appliedMigrations.add(file);
      } catch {
        // Non-fatal
      }
      console.log(`     ⏭️  Already applied (skipped)\n`);
      skippedCount++;
    } else if (!isLocal && shouldFallbackToCommandExecution(errorOutput)) {
      try {
        console.log(
          "     ⚠️  Wrangler file import failed; retrying migration with statement-by-statement execution...",
        );
        executeSqlFileViaCommand(filePath);

        try {
          d1Execute(`INSERT OR IGNORE INTO _migrations (name) VALUES ('${file}')`);
          appliedMigrations.add(file);
        } catch (trackingError) {
          const trackingOutput = extractErrorOutput(trackingError);
          if (trackingOutput) {
            console.log(`     ⚠️  Migration ran but failed to record in tracking table: ${trackingOutput.trim()}\n`);
          } else {
          console.log(`     ⚠️  Migration ran but failed to record in tracking table\n`);
          }
        }

        console.log(`     ✅ Success (fallback)\n`);
        successCount++;
      } catch (fallbackError) {
        const fallbackOutput = extractErrorOutput(fallbackError);
        console.error(`     ❌ Error: ${fallbackOutput || fallbackError.message}\n`);
        errorCount++;
      }
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
