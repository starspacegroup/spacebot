/**
 * Universal logging utility
 * Works in both SvelteKit server-side, standalone Node.js, and browser contexts
 * Respects LOG_LEVEL environment variable
 */

/**
 * Log levels in order of verbosity (lower = less verbose)
 * @enum {number}
 */
const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

/**
 * Get the current log level from environment
 * Handles both process.env (Node.js) and browser environments
 * @returns {number} -1 if not set (no logging), otherwise the level value
 */
function getLogLevel() {
  // Check if we're in a browser environment
  if (typeof window !== "undefined") {
    // In browser, check localStorage or default to "info" for development
    const logLevel = localStorage?.getItem?.("LOG_LEVEL") || "info";
    const level = logLevel.toLowerCase();
    return LOG_LEVELS[level] ?? -1;
  }

  // Server-side: check process.env
  const logLevel = typeof process !== "undefined" ? process.env?.LOG_LEVEL : undefined;
  if (!logLevel) return -1;
  const level = logLevel.toLowerCase();
  return LOG_LEVELS[level] ?? -1;
}

/**
 * Log helper functions that respect LOG_LEVEL
 * @type {{error: (...args: any[]) => void, warn: (...args: any[]) => void, info: (...args: any[]) => void, debug: (...args: any[]) => void}}
 */
export const log = {
  error: (...args) => {
    if (getLogLevel() >= LOG_LEVELS.error) console.error(...args);
  },
  warn: (...args) => {
    if (getLogLevel() >= LOG_LEVELS.warn) console.warn(...args);
  },
  info: (...args) => {
    if (getLogLevel() >= LOG_LEVELS.info) console.info(...args);
  },
  debug: (...args) => {
    if (getLogLevel() >= LOG_LEVELS.debug) console.debug(...args);
  },
};

export { LOG_LEVELS, getLogLevel };
