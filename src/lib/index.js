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
