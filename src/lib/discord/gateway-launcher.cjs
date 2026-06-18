/**
 * CJS launcher for the gateway bot.
 *
 * PM2's Bun fork container uses require() to load the entry script.
 * gateway.js uses top-level await (await loadSecrets()), which makes it
 * an async ESM module — incompatible with require().
 *
 * This thin wrapper uses dynamic import() to load the real gateway module,
 * sidestepping the require() limitation.
 */
import("./gateway.ts").catch((err) => {
  console.error("Failed to start gateway:", err);
  process.exit(1);
});
