/**
 * Smart migration runner
 *
 * Runs migrations only when SQL files under migrations/ changed in HEAD.
 *
 * Safety controls:
 * - Set DB_MIGRATE_FORCE=1 to force migrations regardless of git diff.
 * - Pass through CLI args (for example: --local).
 */

import { execFileSync, execSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrateScriptPath = join(__dirname, "migrate.js");
const passthroughArgs = process.argv.slice(2);

function hasTruthyEnv(name) {
  const value = process.env[name];
  if (!value) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function runMigrations() {
  execFileSync(process.execPath, [migrateScriptPath, ...passthroughArgs], {
    stdio: "inherit",
  });
}

function getChangedMigrationFilesInHead() {
  const output = execSync("git show --name-only --pretty=format: HEAD -- migrations", {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".sql") && line.startsWith("migrations/"));
}

if (hasTruthyEnv("DB_MIGRATE_FORCE")) {
  console.log("DB_MIGRATE_FORCE is set; running migrations.");
  runMigrations();
  process.exit(0);
}

try {
  const changedMigrationFiles = getChangedMigrationFilesInHead();
  if (changedMigrationFiles.length === 0) {
    console.log("No migration changes in HEAD commit; skipping db:migrate.");
    process.exit(0);
  }

  console.log(`Detected ${changedMigrationFiles.length} migration change(s) in HEAD; running db:migrate.`);
  runMigrations();
} catch (error) {
  // If git metadata is unavailable in CI for any reason, fail open and run migrations.
  const reason = error?.message ? String(error.message).trim() : "unknown git error";
  console.log(`Could not determine migration changes from git (${reason}); running db:migrate.`);
  runMigrations();
}
