/**
 * Push Local D1 Data to Production
 *
 * Exports all data from the local D1 database and imports it into the
 * remote (production) D1 database using INSERT OR REPLACE to handle conflicts.
 *
 * The _migrations table is always excluded since production tracks its own
 * migration history independently.
 *
 * Usage:
 *   node scripts/push-data.js              # Dry run (shows what would be pushed)
 *   node scripts/push-data.js --confirm    # Actually push data to production
 *   node scripts/push-data.js --table=automations --table=commands  # Push specific tables only
 *   node scripts/push-data.js --exclude=event_logs  # Exclude specific tables
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const exportFile = join(projectRoot, ".wrangler", "dev-export.sql");

const dbName = "spacebot-logs";

// Tables that should never be pushed to production
const ALWAYS_EXCLUDED = ["_migrations", "_cf_KV"];

// Parse arguments
const args = process.argv.slice(2);
const confirm = args.includes("--confirm");
const tableFilters = args
  .filter((a) => a.startsWith("--table="))
  .map((a) => a.split("=")[1]);
const excludeFilters = args
  .filter((a) => a.startsWith("--exclude="))
  .map((a) => a.split("=")[1]);

console.log("📤 Push Local Data → Production\n");

if (!confirm) {
  console.log("⚠️  DRY RUN MODE — no data will be written to production.");
  console.log("   Add --confirm to actually push data.\n");
}

// Step 1: Export local data (no schema)
console.log("1️⃣  Exporting local database data...");

// Ensure .wrangler directory exists
const wranglerDir = join(projectRoot, ".wrangler");
if (!existsSync(wranglerDir)) {
  console.error("❌ No .wrangler directory found. Has the local dev server been run at least once?");
  process.exit(1);
}

try {
  // Build export command with table filters
  let exportCmd = `wrangler d1 export ${dbName} --local --no-schema --output="${exportFile}"`;
  if (tableFilters.length === 1) {
    exportCmd += ` --table=${tableFilters[0]}`;
  }

  execSync(exportCmd, { cwd: projectRoot, stdio: "pipe" });
} catch (error) {
  const msg = error.stderr?.toString() || error.message;
  console.error(`❌ Export failed: ${msg}`);
  process.exit(1);
}

if (!existsSync(exportFile)) {
  console.error("❌ Export file was not created.");
  process.exit(1);
}

// Step 2: Read and transform the export
console.log("2️⃣  Transforming export...");

const rawSql = readFileSync(exportFile, "utf-8");
const lines = rawSql.split("\n");

let currentTable = null;
const tableStatements = {}; // table name -> array of SQL statements
let skippedTables = new Set();

for (const line of lines) {
  const trimmed = line.trim();

  // Detect which table an INSERT belongs to
  const insertMatch = trimmed.match(/^INSERT INTO [`"]?(\w+)[`"]?\s/i);
  if (insertMatch) {
    currentTable = insertMatch[1];

    // Skip excluded tables
    if (
      ALWAYS_EXCLUDED.includes(currentTable) ||
      excludeFilters.includes(currentTable)
    ) {
      skippedTables.add(currentTable);
      continue;
    }

    // If specific tables requested, skip anything not in the list
    if (tableFilters.length > 0 && !tableFilters.includes(currentTable)) {
      skippedTables.add(currentTable);
      continue;
    }

    // Group statements by table
    if (!tableStatements[currentTable]) {
      tableStatements[currentTable] = [];
    }

    // Transform INSERT to INSERT OR REPLACE for conflict handling
    const transformed = trimmed.replace(
      /^INSERT INTO/i,
      "INSERT OR REPLACE INTO",
    );
    tableStatements[currentTable].push(transformed);
    continue;
  }
}

// Summary
const tables = Object.keys(tableStatements);
if (tables.length === 0) {
  console.log("\n📭 No data to push (local database may be empty).");
  cleanup();
  process.exit(0);
}

console.log(`\n📊 Data Summary:`);
for (const [table, stmts] of Object.entries(tableStatements).sort(([a], [b]) => a.localeCompare(b))) {
  console.log(`   ${table}: ${stmts.length} row(s)`);
}
if (skippedTables.size > 0) {
  console.log(`\n   Skipped: ${[...skippedTables].join(", ")}`);
}

const totalRows = Object.values(tableStatements).reduce((a, b) => a + b.length, 0);
console.log(`\n   Total: ${totalRows} row(s) across ${tables.length} table(s)`);

if (!confirm) {
  console.log("\n🔒 Dry run complete. Run with --confirm to push to production.");
  cleanup();
  process.exit(0);
}

// Step 3: Push data to production table-by-table
console.log("\n3️⃣  Pushing data to production...\n");

let successCount = 0;
let failedCount = 0;
const failedTables = [];

for (const [table, stmts] of Object.entries(tableStatements).sort(([a], [b]) => a.localeCompare(b))) {
  const tableFile = join(projectRoot, ".wrangler", `push-${table}.sql`);
  // Disable FK checks for this connection so child tables can be imported
  // before their parent tables. FK checks are connection-scoped in SQLite,
  // so this doesn't affect other connections.
  const sql = `PRAGMA foreign_keys=OFF;\n${stmts.join("\n")}`;
  writeFileSync(tableFile, sql, "utf-8");

  try {
    execSync(
      `wrangler d1 execute ${dbName} --remote --file="${tableFile}"`,
      { cwd: projectRoot, stdio: "pipe" },
    );
    console.log(`   ✅ ${table}: ${stmts.length} row(s)`);
    successCount++;
  } catch (error) {
    const msg = error.stderr?.toString() || error.stdout?.toString() || error.message;
    // Extract the core error message
    const sqlError = msg.match(/\[ERROR\]\s*(.+?)(?::\s*SQLITE_ERROR)?/)?.[1]?.trim() || msg.split("\n")[0];
    console.log(`   ❌ ${table}: ${sqlError}`);
    failedCount++;
    failedTables.push({ table, error: sqlError, file: tableFile });
  }

  // Clean up per-table file on success
  try { if (!failedTables.some(f => f.table === table)) unlinkSync(tableFile); } catch {}
}

// Final summary
console.log(`\n📊 Push Summary:`);
console.log(`   ✅ ${successCount} table(s) pushed successfully`);
if (failedCount > 0) {
  console.log(`   ❌ ${failedCount} table(s) failed:`);
  for (const { table, error } of failedTables) {
    console.log(`      - ${table}: ${error}`);
  }
  console.log(`\n   💡 Schema mismatch? Run migrations on production first:`);
  console.log(`      bun run db:migrate`);
}

cleanup();

function cleanup() {
  try {
    if (existsSync(exportFile)) unlinkSync(exportFile);
  } catch {
    // Non-fatal cleanup failure
  }
}
