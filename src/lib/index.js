// place files you want to import through the `$lib` alias in this folder.

// Theme utilities
export {
  getPreference,
  getResolved,
  setTheme,
  theme,
  toggleTheme,
} from "./theme.svelte.js";

// Components
export { default as ThemeToggle } from "./components/ThemeToggle.svelte";
export { default as ThemeSelector } from "./components/ThemeSelector.svelte";

/**
 * Generate a random URL-safe hash ID
 * Uses crypto.getRandomValues for cryptographic randomness
 * @param {number} length - Length of the ID (default: 12)
 * @returns {string} - Random alphanumeric ID
 */
export function generateHashId(length = 12) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const randomValues = new Uint8Array(length);
  
  // Use crypto.getRandomValues if available (browser + Node 19+)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(randomValues);
  } else {
    // Fallback for older Node.js
    for (let i = 0; i < length; i++) {
      randomValues[i] = Math.floor(Math.random() * 256);
    }
  }
  
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[randomValues[i] % chars.length];
  }
  return result;
}
