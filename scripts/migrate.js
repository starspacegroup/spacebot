/**
 * Database Migration Runner
 * Automatically runs all SQL migration files in the migrations folder
 *
 * Usage:
 *   node scripts/migrate.js         # Run against remote D1
 *   node scripts/migrate.js --local # Run against local D1
 */

import { execSync } from "child_process";
import { readdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "..", "migrations");

// Check for --local flag
const isLocal = process.argv.includes("--local");
const dbName = "spacebot-logs";

console.log(`🗄️  Running migrations ${isLocal ? "(local)" : "(remote)"}...\n`);

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
let errorCount = 0;

for (const file of migrationFiles) {
  const filePath = join(migrationsDir, file);
  const localFlag = isLocal ? "--local" : "";

  console.log(`  📄 ${file}`);

  try {
    execSync(
      `wrangler d1 execute ${dbName} ${localFlag} --file="${filePath}"`,
      { stdio: "pipe" },
    );
    console.log(`     ✅ Success\n`);
    successCount++;
  } catch (error) {
    // Check if it's just a "table already exists" type error (which is fine)
    const errorOutput = error.stderr?.toString() || error.stdout?.toString() ||
      "";

    if (
      errorOutput.includes("already exists") ||
      errorOutput.includes("duplicate")
    ) {
      console.log(`     ⏭️  Already applied (skipped)\n`);
      successCount++;
    } else {
      console.error(`     ❌ Error: ${errorOutput || error.message}\n`);
      errorCount++;
    }
  }
}

console.log(`\n📊 Migration Summary:`);
console.log(`   ✅ ${successCount} succeeded`);
if (errorCount > 0) {
  console.log(`   ❌ ${errorCount} failed`);
  process.exit(1);
}

console.log(`\n✨ All migrations complete!`);
